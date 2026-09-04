// .flipcheck.mjs — throwaway diagnostic: why does the pug's colour map look wrong?
//
// Renders Benchscene2 four ways in one browser session, from the SAME archive,
// with the pose frozen so the frames are directly comparable:
//
//   embedded  — Resources.tryLoad is stubbed to return null for the colour map,
//               so _applyTextures leaves whatever GLTFLoader put on the material.
//               This is exactly the old, working scenario.
//   current   — untouched: the external .jpg overrides albedo.
//   flipfix   — as current, then flipY=false forced on the uploaded texture.
//   ktx2      — Resources.preferExtension="ktx2", so the .ktx2 is chosen instead.
//
// Frames come back as PNG data URLs and are written to .tmpimg/flip/.
// Modelled on verify-render.mjs (POST the result back, don't scrape the DOM).

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

const rootDir = process.cwd();
const zipPath = path.join(rootDir, "ReleaseScenarios", "test", "Benchscene2_complexmodel.zip");
const engineBundle = path.join(rootDir, "node_modules", "WebEngineTS", "dist", "WebEngineTS.standalone.js");
const basisDir = path.join(
    "C:", "Users", "HuGox", "WebstormProjects", "WebEngineTS",
    "node_modules", "three", "examples", "jsm", "libs", "basis"
);
const outDir = path.join(rootDir, ".tmpimg", "flip");

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

const HARNESS = `<!doctype html>
<meta charset="utf-8"><title>flip check</title>
<style>html,body{margin:0;background:#111}canvas{display:block}</style>
<script type="importmap">{ "imports": { "WebEngineTS": "/engine.js" } }</script>
<canvas id="c" width="720" height="720"></canvas>
<script type="module">
import { Application, SceneManager, Resources, Time, Texture2D, MeshRenderer, StandardMaterial } from "/engine.js";

Texture2D.ktx2TranscoderPath = "/basis/";

const canvas = document.getElementById("c");
// preserveDrawingBuffer BEFORE the Application is constructed: three.js then
// adopts this same context and toDataURL() works outside the draw call.
canvas.getContext("webgl2", { preserveDrawingBuffer: true });
const app = new Application(canvas);

const zipBuf = await (await fetch("/scene.zip")).arrayBuffer();
const realTryLoad = Resources.tryLoad.bind(Resources);

function waitFrames(n) {
    return new Promise((res) => {
        let i = 0;
        (function tick() { if (++i >= n) return res(); requestAnimationFrame(tick); })();
    });
}
function waitFirstFrame(scenario, timeoutMs = 120000) {
    return new Promise((resolve) => {
        const t0 = performance.now();
        (function poll() {
            if (scenario.timeToFirstFrame >= 0) return resolve(scenario.timeToFirstFrame);
            if (performance.now() - t0 > timeoutMs) return resolve(-1);
            requestAnimationFrame(poll);
        })();
    });
}

/** The one StandardMaterial the pug's four meshes share. */
function pugMaterial() {
    const scene = SceneManager.activeScene;
    for (const root of scene.getRootGameObjects()) {
        for (const r of root.getComponentsInChildren(MeshRenderer, true)) {
            if (r.sharedMaterial instanceof StandardMaterial) return r.sharedMaterial;
        }
    }
    return null;
}

function describe(tex) {
    if (!tex) return null;
    const t = (tex._threeTextureForUpload && tex._threeTextureForUpload()) || tex._internalThreeTexture;
    if (!t) return { note: "no three texture" };
    const img = t.image;
    return {
        ctor: t.constructor.name,
        flipY: t.flipY,
        colorSpace: t.colorSpace,
        channel: t.channel,
        w: img ? (img.width ?? img.naturalWidth ?? null) : null,
        h: img ? (img.height ?? img.naturalHeight ?? null) : null,
        repeat: [t.repeat.x, t.repeat.y],
        offset: [t.offset.x, t.offset.y],
    };
}

const results = [];

async function pass(name, { stubColour = false, forceFlip = false, ktx2 = false } = {}) {
    const entry = { name };
    try {
        // The leading dot matters: _resolvePath compares against the registered
        // extension list, which stores ".ktx2". Without it the override never
        // matches and the load silently falls through to the .jpg.
        Resources.preferExtension = ktx2 ? ".ktx2" : null;
        Resources.tryLoad = stubColour
            ? function (type, p) {
                  if (String(p).includes("complex_albedo")) return Promise.resolve(null);
                  return realTryLoad(type, p);
              }
            : realTryLoad;

        const scenario = await app.loadScenarioFromBuffer(zipBuf);
        entry.ttff = Math.round(await waitFirstFrame(scenario));

        const mat = pugMaterial();
        entry.hasMaterial = !!mat;

        if (forceFlip && mat && mat.albedoTexture) {
            const t = mat.albedoTexture._threeTextureForUpload();
            if (t) { t.flipY = false; t.needsUpdate = true; }
        }

        // Freeze the pose so every frame lands on the identical rotation:
        // Scenario.update() recomputes from Time.time each frame.
        Time.timeScale = 0;
        Time._time = 2;
        await waitFrames(8);

        entry.albedo = mat ? describe(mat.albedoTexture) : null;
        entry.normal = mat ? describe(mat.normalTexture) : null;
        entry.metallic = mat ? describe(mat.metallicTexture ?? mat.metallicRoughnessTexture) : null;
        entry.png = canvas.toDataURL("image/png");
        entry.ok = entry.ttff >= 0;
    } catch (err) {
        entry.ok = false;
        entry.error = String((err && err.stack) || err);
    } finally {
        Resources.tryLoad = realTryLoad;
        Resources.preferExtension = null;
        try { app.unloadScenario(); } catch {}
        Time.timeScale = 1;
    }
    results.push(entry);
}

const ALL = {
    embedded:   { stubColour: true },
    current:    {},
    flipfix:    { forceFlip: true },
    ktx2:       { ktx2: true },
    ktx2flipfix:{ ktx2: true, forceFlip: true },
};
const WANT = ${JSON.stringify(process.env.FLIP_PASSES ? process.env.FLIP_PASSES.split(",") : ["embedded", "current", "flipfix", "ktx2"])};
for (const name of WANT) await pass(name, ALL[name]);

const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
await fetch("/result", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ renderer: gl ? gl.getParameter(gl.VERSION) : "none", results }),
});
document.title = "done";
</script>`;

const MIME = { ".js": "text/javascript", ".wasm": "application/wasm", ".zip": "application/zip" };

async function main() {
    mkdirSync(outDir, { recursive: true });
    if (!existsSync(zipPath)) throw new Error(`Build the archive first: ${zipPath}`);

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
        if (url === "/") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); return res.end(HARNESS); }
        if (url === "/engine.js") { res.writeHead(200, { "content-type": MIME[".js"] }); return res.end(readFileSync(engineBundle)); }
        if (url === "/scene.zip") { res.writeHead(200, { "content-type": MIME[".zip"] }); return res.end(readFileSync(zipPath)); }
        if (url.startsWith("/basis/")) {
            const abs = path.join(basisDir, url.slice(7));
            if (abs.startsWith(basisDir) && existsSync(abs)) {
                res.writeHead(200, { "content-type": MIME[path.extname(abs)] ?? "application/octet-stream" });
                return res.end(readFileSync(abs));
            }
        }
        res.writeHead(404); res.end("not found");
    });

    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${server.address().port}`;

    const browser = findBrowser();
    const profile = mkdtempSync(path.join(tmpdir(), "flipcheck-"));
    const flags = [
        "--enable-unsafe-swiftshader", "--use-angle=swiftshader",
        "--no-first-run", "--no-default-browser-check", "--disable-extensions",
        "--disable-background-networking", `--user-data-dir=${profile}`, base,
    ];
    if (!process.env.HEADFUL) flags.unshift("--headless=new", "--disable-gpu-sandbox");

    console.log(`[flip] ${browser}\n[flip] ${base}`);
    const child = spawn(browser, flags, { stdio: "ignore" });
    const timeoutMs = Number(process.env.RENDER_TIMEOUT_MS ?? 900000);
    const timeout = new Promise((r) => setTimeout(() => r({ error: `timed out after ${timeoutMs}ms` }), timeoutMs));

    let payload;
    try { payload = await Promise.race([resultPromise, timeout]); }
    finally {
        child.kill(); server.close();
        try { await new Promise((r) => setTimeout(r, 500)); rmSync(profile, { recursive: true, force: true }); } catch {}
    }

    if (payload.error) { console.error(`[flip] FAILED: ${payload.error}`); process.exit(1); }
    console.log(`renderer: ${payload.renderer}\n`);

    for (const r of payload.results) {
        if (r.png) {
            writeFileSync(path.join(outDir, `${r.name}.png`), Buffer.from(r.png.split(",")[1], "base64"));
            delete r.png;
        }
        console.log(JSON.stringify(r, null, 2));
    }
    console.log(`\nframes written to ${outDir}`);
}

await main();
