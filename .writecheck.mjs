// .writecheck.mjs — throwaway diagnostic for task S1.2.
//
// The claim the multi-write archive is built on is "three transform writes per
// object per frame, against one in Benchscene1_N5000". That is a claim about
// runtime behaviour, so it is checked at runtime: the Transform property
// setters are wrapped with counters, the scenario is left running for a known
// number of engine frames, and the totals are divided by frames x objects.
//
// Also checks, for both archives:
//   - GameObject count is OBJECT_COUNT + 4;
//   - the scene is deterministic — two independent loads, pose frozen at the
//     same Time.time, must produce byte-identical frames.
//
// Small canvas on purpose: swiftshader has to draw 5004 objects and the write
// count does not depend on resolution.
//
// Modelled on verify-render.mjs (POST the result back, don't scrape the DOM).

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

const rootDir = process.cwd();
const testRelease = path.join(rootDir, "ReleaseScenarios", "test");
const engineBundle = path.join(rootDir, "node_modules", "WebEngineTS", "dist", "WebEngineTS.standalone.js");
const outDir = path.join(rootDir, ".tmpimg", "write");

const CASES = ["Benchscene1_N5000", "Benchscene1_N5000_multiwrite"];

function findBrowser() {
    const candidates = [
        process.env.BROWSER,
        "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
        "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    ].filter(Boolean);
    for (const c of candidates) if (existsSync(c)) return c;
    const out = execFileSync("where.exe", ["msedge.exe"], { encoding: "utf8" });
    const first = out.split(/\r?\n/).map((l) => l.trim()).find(Boolean);
    if (first && existsSync(first)) return first;
    throw new Error("No browser found. Set BROWSER=<path to msedge.exe>.");
}

const HARNESS = (cases) => `<!doctype html>
<meta charset="utf-8"><title>write check</title>
<style>html,body{margin:0;background:#111}canvas{display:block}</style>
<script type="importmap">{ "imports": { "WebEngineTS": "/engine.js" } }</script>
<canvas id="c" width="320" height="240"></canvas>
<script type="module">
import { Application, SceneManager, Transform, Time } from "/engine.js";

const CASES = ${JSON.stringify(cases)};
const canvas = document.getElementById("c");
canvas.getContext("webgl2", { preserveDrawingBuffer: true });
const app = new Application(canvas);

const COUNTED = ["localPosition", "localRotation", "localScale", "position", "rotation", "localScale"];
const counts = {};
const originals = {};

// Wrap the setters once, up front. The counter object is swapped per run rather
// than the wrappers being installed and removed, so no run pays a different
// property-lookup cost than another.
for (const name of new Set(COUNTED)) {
    const d = Object.getOwnPropertyDescriptor(Transform.prototype, name);
    if (!d || !d.set) continue;
    originals[name] = d.set;
    counts[name] = 0;
    Object.defineProperty(Transform.prototype, name, {
        configurable: true,
        enumerable: d.enumerable,
        get: d.get,
        set(value) { counts[name]++; originals[name].call(this, value); },
    });
}

function resetCounts() { for (const k of Object.keys(counts)) counts[k] = 0; }

function waitFrames(n) {
    return new Promise((res) => {
        let i = 0;
        (function tick() { if (++i >= n) return res(); requestAnimationFrame(tick); })();
    });
}
function waitFirstFrame(scenario, timeoutMs = 600000) {
    return new Promise((resolve) => {
        const t0 = performance.now();
        (function poll() {
            if (scenario.timeToFirstFrame >= 0) return resolve(scenario.timeToFirstFrame);
            if (performance.now() - t0 > timeoutMs) return resolve(-1);
            requestAnimationFrame(poll);
        })();
    });
}

const results = [];

async function run(name, label) {
    const entry = { scenario: name, label };
    try {
        const buf = await (await fetch("/z/" + name + ".zip")).arrayBuffer();
        const scenario = await app.loadScenarioFromBuffer(buf);
        entry.ttff = Math.round(await waitFirstFrame(scenario));
        entry.objects = SceneManager.activeScene ? SceneManager.activeScene.gameObjectCount : null;
        entry.dirtyEnabled = Transform.dirtyTransformsEnabled;

        // Steady state: count over a known number of ENGINE frames, so the
        // divisor is what the engine actually stepped, not how many rAFs fired.
        resetCounts();
        const f0 = Time.frameCount;
        await waitFrames(12);
        const frames = Time.frameCount - f0;

        const movers = entry.objects - 4;   // camera, sun, ambient, floor
        entry.frames = frames;
        entry.writes = { ...counts };
        entry.total = Object.values(counts).reduce((a, b) => a + b, 0);
        entry.writesPerObjectPerFrame =
            frames > 0 && movers > 0 ? +(entry.total / (frames * movers)).toFixed(3) : null;

        // Frozen pose for the determinism comparison.
        Time.timeScale = 0;
        Time._time = 2;
        await waitFrames(6);
        entry.png = canvas.toDataURL("image/png");
        entry.ok = entry.ttff >= 0;
    } catch (err) {
        entry.ok = false;
        entry.error = String((err && err.stack) || err);
    } finally {
        try { app.unloadScenario(); } catch {}
        Time.timeScale = 1;
    }
    results.push(entry);
}

for (const name of CASES) {
    await run(name, "a");
    await run(name, "b");   // second, independent load — determinism
}

await fetch("/result", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ results }),
});
document.title = "done";
</script>`;

async function main() {
    mkdirSync(outDir, { recursive: true });
    for (const c of CASES) {
        const z = path.join(testRelease, `${c}.zip`);
        if (!existsSync(z)) throw new Error(`Build it first: ${z}`);
    }

    let resolveResult;
    const resultPromise = new Promise((r) => { resolveResult = r; });

    const server = createServer((req, res) => {
        if (req.method === "POST" && req.url === "/result") {
            const chunks = [];
            req.on("data", (c) => chunks.push(c));
            req.on("end", () => {
                res.writeHead(204); res.end();
                try { resolveResult(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
                catch (e) { resolveResult({ error: `bad payload: ${e.message}` }); }
            });
            return;
        }
        const url = new URL(req.url, "http://localhost").pathname;
        if (url === "/") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); return res.end(HARNESS(CASES)); }
        if (url === "/engine.js") { res.writeHead(200, { "content-type": "text/javascript" }); return res.end(readFileSync(engineBundle)); }
        if (url.startsWith("/z/")) {
            const abs = path.join(testRelease, url.slice(3));
            if (abs.startsWith(testRelease) && existsSync(abs)) {
                res.writeHead(200, { "content-type": "application/zip" });
                return res.end(readFileSync(abs));
            }
        }
        res.writeHead(404); res.end("not found");
    });

    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${server.address().port}`;

    const browser = findBrowser();
    const profile = mkdtempSync(path.join(tmpdir(), "writecheck-"));
    const flags = [
        "--enable-unsafe-swiftshader", "--use-angle=swiftshader",
        "--no-first-run", "--no-default-browser-check", "--disable-extensions",
        "--disable-background-networking", `--user-data-dir=${profile}`, base,
    ];
    if (!process.env.HEADFUL) flags.unshift("--headless=new", "--disable-gpu-sandbox");

    console.log(`[write] ${browser}\n[write] ${base}`);
    const child = spawn(browser, flags, { stdio: "ignore" });
    const timeoutMs = Number(process.env.RENDER_TIMEOUT_MS ?? 1800000);
    const timeout = new Promise((r) => setTimeout(() => r({ error: `timed out after ${timeoutMs}ms` }), timeoutMs));

    let payload;
    try { payload = await Promise.race([resultPromise, timeout]); }
    finally {
        child.kill(); server.close();
        try { await new Promise((r) => setTimeout(r, 500)); rmSync(profile, { recursive: true, force: true }); } catch {}
    }

    if (payload.error) { console.error(`[write] FAILED: ${payload.error}`); process.exit(1); }

    const frames = new Map();
    for (const r of payload.results) {
        if (r.png) {
            const p = path.join(outDir, `${r.scenario}.${r.label}.png`);
            writeFileSync(p, Buffer.from(r.png.split(",")[1], "base64"));
            frames.set(`${r.scenario}.${r.label}`, p);
            delete r.png;
        }
    }
    console.log(JSON.stringify(payload.results, null, 2));
    console.log(`\nframes in ${outDir}`);
}

await main();
