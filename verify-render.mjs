// verify-render.mjs — load every scenario both ways in a real browser and
// compare what comes out.
//
// WHY THIS EXISTS
//   docs/PLAN.md P1's done-criterion is that
//   `Application.loadScenarioFromManifest(url)` renders a scenario the same way
//   `loadScenarioFromBuffer` does on its ZIP. Everything else in this repository
//   can be checked without a GPU — `build-manifest.mjs --verify` proves the
//   files exist, `--verify-fetch` proves the engine's own StreamingAssetSource
//   can pull them — but "renders" needs WebGL, and therefore a browser.
//
// HOW IT GETS ITS ANSWER BACK
//   The page POSTs its results to the server that served it, rather than being
//   scraped with --dump-dom. Screen-scraping headless Chrome means pairing
//   --virtual-time-budget with an engine that drives itself off rAF and real
//   timers, and guessing how long is long enough. A POST is exact: the run is
//   over when the result arrives, and a run that dies arrives as a timeout
//   rather than as an empty DOM that looks like a pass.
//
// WHAT IT MEASURES
//   For each scenario, both load paths, in one browser session:
//     - did it load at all, and what did it throw if not;
//     - Scenario.timeToFirstFrame, which is -1 until a frame has actually been
//       drawn, so it doubles as proof that rendering happened;
//     - the scene graph size, as a cheap check that the manifest path built the
//       same content rather than an empty scene that also renders.
//   Numbers from a swiftshader software rasteriser are not performance data.
//   The comparison is about *equivalence between the two paths*, not speed.
//
// USAGE
//   npm run build -- --all --tests && npm run manifest:all -- --tests
//   node verify-render.mjs                  # all scenarios
//   node verify-render.mjs --scenario Molecules
//   BROWSER="C:\\path\\to\\msedge.exe" node verify-render.mjs
//   HEADFUL=1 node verify-render.mjs        # watch it run

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

const rootDir = process.cwd();
const releaseRoot = path.join(rootDir, "ReleaseScenarios");
const testReleaseRoot = path.join(releaseRoot, "test");
const engineBundle = path.join(
    rootDir, "node_modules", "WebEngineTS", "dist", "WebEngineTS.standalone.js"
);

const MIME = {
    ".json": "application/json", ".js": "text/javascript", ".mjs": "text/javascript",
    ".html": "text/html; charset=utf-8", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".png": "image/png", ".ktx2": "image/ktx2", ".glb": "model/gltf-binary",
    ".gltf": "model/gltf+json", ".webp": "image/webp", ".zip": "application/zip",
};

function findBrowser() {
    const candidates = [
        process.env.BROWSER,
        "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
        "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    ].filter(Boolean);

    for (const c of candidates) {
        if (existsSync(c)) return c;
    }
    try {
        const out = execFileSync("where.exe", ["msedge.exe"], { encoding: "utf8" });
        const first = out.split(/\r?\n/).map((l) => l.trim()).find(Boolean);
        if (first && existsSync(first)) return first;
    } catch {
        // fall through
    }
    throw new Error(
        "No browser found. Set BROWSER=<path to msedge.exe or chrome.exe>."
    );
}

/** Scenarios that have both a ZIP and a manifest, so both paths can be compared. */
function findCases(selected) {
    const cases = [];
    for (const [dir, prefix] of [[releaseRoot, ""], [testReleaseRoot, "test/"]]) {
        if (!existsSync(dir)) continue;
        for (const name of readdirSync(dir).filter((n) => n.endsWith(".scenario.json"))) {
            const scenario = name.replace(/\.scenario\.json$/, "");
            if (selected.length > 0 && !selected.includes(scenario)) continue;
            const zip = path.join(dir, `${scenario}.zip`);
            cases.push({
                scenario,
                manifestUrl: `/r/${prefix}${name}`,
                zipUrl: existsSync(zip) ? `/r/${prefix}${scenario}.zip` : null,
            });
        }
    }
    return cases;
}

const HARNESS = (cases) => `<!doctype html>
<meta charset="utf-8">
<title>scenario render check</title>
<style>html,body{margin:0;background:#111} canvas{display:block}</style>
<!-- Scenario modules are compiled with \`import ... from "WebEngineTS"\` and are
     loaded as blob: URLs, so the bare specifier is resolved by the document's
     import map. This mirrors what virtual-lab's frontend/src/index.html does;
     without it both load paths fail identically at the entry-point import,
     which is a fair reproduction of the platform but tells us nothing. -->
<script type="importmap">
{ "imports": { "WebEngineTS": "/engine.js" } }
</script>
<canvas id="c" width="640" height="480"></canvas>
<script type="module">
import { Application, SceneManager } from "/engine.js";

const CASES = ${JSON.stringify(cases)};
const results = [];

// A scenario is "rendered" when timeToFirstFrame stops being -1. Polling for it
// rather than counting rAFs keeps this honest: it is the engine's own statement
// that a frame reached the screen, not our guess that enough time passed.
function waitForFirstFrame(scenario, timeoutMs = 60000) {
    return new Promise((resolve) => {
        const started = performance.now();
        (function poll() {
            if (scenario.timeToFirstFrame >= 0) return resolve(scenario.timeToFirstFrame);
            if (performance.now() - started > timeoutMs) return resolve(-1);
            requestAnimationFrame(poll);
        })();
    });
}

// Cheap proof that the manifest path built the *same content*, not merely that
// it built something that renders. An empty scene draws a clear colour perfectly
// happily, so a passing timeToFirstFrame on its own would not catch a manifest
// that silently delivered nothing.
function sceneSize() {
    const scene = SceneManager.activeScene;
    if (!scene) return null;
    return { roots: scene.rootCount, gameObjects: scene.gameObjectCount };
}

const canvas = document.getElementById("c");
const app = new Application(canvas);

for (const c of CASES) {
    for (const mode of ["manifest", "zip"]) {
        if (mode === "zip" && !c.zipUrl) continue;
        const entry = { scenario: c.scenario, mode };
        const t0 = performance.now();
        try {
            let scenario;
            if (mode === "manifest") {
                scenario = await app.loadScenarioFromManifest(new URL(c.manifestUrl, location.href).href);
            } else {
                const buf = await (await fetch(c.zipUrl)).arrayBuffer();
                scenario = await app.loadScenarioFromBuffer(buf);
            }
            entry.loadMs = Math.round(performance.now() - t0);
            entry.manifestId = scenario.manifest?.id ?? null;
            entry.entryPoint = scenario.manifest?.entryPoint ?? null;
            entry.timeToFirstFrame = Math.round(await waitForFirstFrame(scenario));
            entry.scene = sceneSize();
            entry.ok = entry.timeToFirstFrame >= 0;
        } catch (err) {
            entry.ok = false;
            entry.error = String(err && err.message || err);
        }
        results.push(entry);
        try { app.unloadScenario(); } catch {}
    }
}

const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
await fetch("/result", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
        renderer: gl ? gl.getParameter(gl.VERSION) : "no webgl context",
        results,
    }),
});
document.title = "done";
</script>`;

async function main() {
    const args = process.argv.slice(2);
    const selected = [];
    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--scenario") {
            selected.push(...String(args[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean));
        } else {
            throw new Error(`Unknown argument: ${args[i]}`);
        }
    }

    if (!existsSync(engineBundle)) {
        throw new Error(`Engine bundle not found at ${engineBundle}. Run npm install.`);
    }
    const cases = findCases(selected);
    if (cases.length === 0) {
        throw new Error(
            "Nothing to check. Build the archives and emit manifests first:\n" +
            "  node build-package.mjs --all --tests && node build-manifest.mjs --all --tests"
        );
    }

    let resolveResult;
    const resultPromise = new Promise((resolve) => { resolveResult = resolve; });

    const server = createServer((req, res) => {
        if (req.method === "POST" && req.url === "/result") {
            const chunks = [];
            req.on("data", (c) => chunks.push(c));
            req.on("end", () => {
                res.writeHead(204);
                res.end();
                try { resolveResult(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
                catch (err) { resolveResult({ error: `bad result payload: ${err.message}` }); }
            });
            return;
        }

        const url = new URL(req.url, "http://localhost").pathname;
        if (url === "/" || url === "/index.html") {
            res.writeHead(200, { "content-type": MIME[".html"] });
            res.end(HARNESS(cases));
            return;
        }
        if (url === "/engine.js") {
            res.writeHead(200, { "content-type": MIME[".js"] });
            res.end(readFileSync(engineBundle));
            return;
        }
        if (url.startsWith("/r/")) {
            const abs = path.join(releaseRoot, url.slice(3));
            if (abs.startsWith(releaseRoot) && existsSync(abs) && statSync(abs).isFile()) {
                res.writeHead(200, { "content-type": MIME[path.extname(abs)] ?? "application/octet-stream" });
                res.end(readFileSync(abs));
                return;
            }
        }
        res.writeHead(404);
        res.end("not found");
    });

    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;

    const browser = findBrowser();
    const profile = mkdtempSync(path.join(tmpdir(), "scenario-render-"));
    const flags = [
        // swiftshader: no GPU is guaranteed on a build machine, and WebGL has to
        // come from somewhere. These numbers are not performance data.
        "--enable-unsafe-swiftshader",
        "--use-angle=swiftshader",
        "--no-first-run", "--no-default-browser-check",
        "--disable-extensions", "--disable-background-networking",
        `--user-data-dir=${profile}`,
        base,
    ];
    if (!process.env.HEADFUL) flags.unshift("--headless=new", "--disable-gpu-sandbox");

    console.log(`[render] ${browser}`);
    console.log(`[render] serving ${releaseRoot} at ${base}`);
    console.log(`[render] ${cases.length} scenario(s), both paths each\n`);

    const child = spawn(browser, flags, { stdio: "ignore" });
    const timeoutMs = Number(process.env.RENDER_TIMEOUT_MS ?? 300000);
    const timeout = new Promise((resolve) =>
        setTimeout(() => resolve({ error: `timed out after ${timeoutMs}ms` }), timeoutMs));

    let payload;
    try {
        payload = await Promise.race([resultPromise, timeout]);
    } finally {
        child.kill();
        server.close();
        // Best-effort: Windows holds the profile open for a moment after the
        // browser exits, and a failure to delete a temp directory is not a
        // reason to lose the results we came for.
        try {
            await new Promise((resolve) => setTimeout(resolve, 500));
            rmSync(profile, { recursive: true, force: true });
        } catch { /* left behind in %TEMP%; harmless */ }
    }

    if (payload.error) {
        console.error(`[render] FAILED: ${payload.error}`);
        process.exit(1);
    }

    console.log(`renderer: ${payload.renderer}\n`);

    const byScenario = new Map();
    for (const r of payload.results) {
        if (!byScenario.has(r.scenario)) byScenario.set(r.scenario, {});
        byScenario.get(r.scenario)[r.mode] = r;
    }

    let failures = 0;
    for (const [scenario, modes] of byScenario) {
        for (const [mode, r] of Object.entries(modes)) {
            if (r.ok) {
                console.log(
                    `  ${mode.padEnd(8)} id=${String(r.manifestId).padEnd(26)} ` +
                    `entry=${String(r.entryPoint).padEnd(12)} ` +
                    `load=${String(r.loadMs).padStart(6)}ms  ttff=${String(r.timeToFirstFrame).padStart(5)}ms  ` +
                    `objects=${r.scene ? r.scene.gameObjects : "?"}`
                );
            } else {
                console.log(`  ${mode.padEnd(8)} FAILED: ${r.error ?? "no frame rendered"}`);
                failures += 1;
            }
        }

        // The comparison the whole exercise is for.
        const { manifest, zip } = modes;
        if (manifest?.ok && zip?.ok) {
            const sameEntry = manifest.entryPoint === zip.entryPoint;
            const sameId = manifest.manifestId === zip.manifestId;
            const sameScene = JSON.stringify(manifest.scene) === JSON.stringify(zip.scene);
            const agree = sameEntry && sameId && sameScene;
            if (!agree) failures += 1;
            console.log(
                `  ${agree ? "MATCH" : "DIFFER"}   id=${sameId} entry=${sameEntry} scene=${sameScene}`
            );
        }
        console.log(`  ^ ${scenario}\n`);
    }

    console.log(
        failures === 0
            ? "Both load paths rendered every scenario, and agreed on what they built."
            : `${failures} problems.`
    );
    // Said plainly because the table above is full of millisecond columns and
    // they look like a benchmark. Measured: running solar-system alone gave
    // manifest 41.8s / zip 48.7s, while the same scenario inside a five-scenario
    // run gave 33.5s / 2.4s — the second load inherits the first one's compiled
    // shaders. Software rasterisation dominates everything here. Loading time
    // belongs to the engine's harness, driven by URL flags, on a real GPU.
    console.log(
        "\nTimings above are not performance data: swiftshader is a software\n" +
        "rasteriser and whichever path runs second inherits warmed-up shaders.\n" +
        "This checks that the two paths agree, not which is faster."
    );
    process.exit(failures === 0 ? 0 : 1);
}

await main();
