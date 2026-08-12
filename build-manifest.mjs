// build-manifest.mjs — emit a streaming manifest beside an already-built ZIP.
//
// WHAT THIS IS FOR
//   The engine can load a scenario from a `scenario.json` listing individually
//   fetchable scripts and assets with priorities and detail levels — progressive
//   first paint, a priority queue, a VRAM budget, per-asset LOD selection. None
//   of that had ever run against real content, because nothing published a
//   scenario in that form. This publishes one. See docs/PLAN.md, P1.
//
// WHY IT READS THE ZIP INSTEAD OF THE SOURCE
//   The ZIP is the build output and already contains exactly what a manifest has
//   to describe: compiled `scripts/*.js`, `assets/**` as shipped, and the
//   manifest.json naming the entry point. Reading it means this file needs no
//   copy of the discovery, compile or entry-point-detection logic in
//   build-package.mjs, and cannot drift from it. Run the build first:
//
//     npm run build -- --scenario Benchscene3_solarsystem
//     node build-manifest.mjs --scenario Benchscene3_solarsystem
//     node build-manifest.mjs --verify        # re-check everything emitted
//     node build-manifest.mjs --verify-fetch  # load it all through the engine
//
//   Folding this into build-package.mjs is a one-line call once the two are
//   wanted in a single pass; it is kept separate for now so the ZIP path stays
//   exactly as it is.
//
// WHAT IT WRITES
//   ReleaseScenarios/<name>.scenario.json        (test scenarios: under test/)
//   ReleaseScenarios/objects/<ab>/<sha256><ext>  content-addressed, SHARED
//
//   The object store is shared across scenarios on purpose: that is where
//   dedup happens. solar-system-scenario and Benchscene3_solarsystem carry the
//   same planet textures and store two copies today; addressed by content they
//   are one file, and the run prints how many were already present.
//
//   No `baseUrl` is written. The engine resolves URLs against the manifest's own
//   location, so serving ReleaseScenarios/ as static files is a complete host —
//   `StreamingAssetSource.fromUrl` takes any URL, and proving the path needs no
//   platform code at all.
//
// VERIFICATION
//   Every manifest is parsed back through the engine's own
//   `parseStreamingManifest` and `toScenarioManifest` before being written, so a
//   manifest this tool emits is one the engine has already accepted. This is an
//   import of the installed WebEngineTS, not a reimplementation of its rules.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
    existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

import { parseStreamingManifest, StreamingAssetSource, toScenarioManifest } from "WebEngineTS";

const rootDir = process.cwd();
const scenariosRoot = path.join(rootDir, "Scenarios");
const testScenariosRoot = path.join(rootDir, "TestScenarios");
const releaseRoot = path.join(rootDir, "ReleaseScenarios");
const testReleaseRoot = path.join(releaseRoot, "test");
const objectsRoot = path.join(releaseRoot, "objects");

/**
 * Default priority ladder, first match wins.
 *
 * A manifest that marks everything `critical` measures nothing — it describes
 * the monolithic ZIP again, in more words. So the default has to produce a
 * spread, and it has to be honest that it is guessing: nothing here can know
 * what the first frame shows. The ladder below is a defensible starting point,
 * and a scenario that cares overrides it in scenario.meta.json.
 */
const DEFAULT_PRIORITIES = [
    // The backdrop fills the whole frame; its absence is the most visible.
    ["skybox/**", "critical"],
    // Geometry is the subject. Without it there is nothing to texture.
    ["**/*.glb", "high"],
    ["**/*.gltf", "high"],
    // Textures can arrive late — a surface renders untextured, not missing.
    ["**", "low"],
];

function parseArgs() {
    const args = process.argv.slice(2);
    const selected = [];
    let buildAll = false;
    let includeTests = false;
    let verify = false;
    let verifyFetch = false;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === "--all") { buildAll = true; continue; }
        if (arg === "--tests") { includeTests = true; continue; }
        if (arg === "--verify") { verify = true; continue; }
        if (arg === "--verify-fetch") { verifyFetch = true; continue; }
        if (arg === "--scenario") {
            const value = args[i + 1];
            if (!value || value.startsWith("--")) {
                throw new Error("Expected scenario name after --scenario");
            }
            i += 1;
            for (const name of value.split(",").map((v) => v.trim()).filter(Boolean)) {
                selected.push(name);
            }
            continue;
        }
        throw new Error(`Unknown argument: ${arg}`);
    }

    return { buildAll, includeTests, selected, verify, verifyFetch };
}

/**
 * Pulls every manifest through the engine's own loader over real HTTP.
 *
 * `--verify` proves the manifest describes files that exist. This proves the
 * *engine* can consume it: `StreamingAssetSource.fromUrl` fetches the manifest,
 * resolves each url against its location, sorts assets by priority and hands
 * back bytes. Everything short of putting pixels on screen is exercised here,
 * which is worth having because the alternative — finding out in a browser — is
 * the slowest possible feedback loop for a typo in a url.
 *
 * A plain static server is deliberate: it is the whole deployment story. If this
 * passes, `ReleaseScenarios/` behind any file server is a working origin, and no
 * platform code is needed to prove the path.
 */
async function verifyByFetch() {
    const mimes = {
        ".json": "application/json", ".js": "text/javascript", ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg", ".png": "image/png", ".ktx2": "image/ktx2",
        ".glb": "model/gltf-binary", ".gltf": "model/gltf+json", ".webp": "image/webp",
    };

    const server = createServer((req, res) => {
        const rel = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
        const abs = path.join(releaseRoot, rel);
        // Refuse to serve outside the release root even on a throwaway server;
        // a path-traversal-shaped bug here would silently "pass" the check.
        if (!abs.startsWith(releaseRoot) || !existsSync(abs) || !statSync(abs).isFile()) {
            res.writeHead(404);
            res.end("not found");
            return;
        }
        res.writeHead(200, { "content-type": mimes[path.extname(abs)] ?? "application/octet-stream" });
        res.end(readFileSync(abs));
    });

    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    let problems = 0;

    try {
        for (const dir of [releaseRoot, testReleaseRoot]) {
            if (!existsSync(dir)) continue;
            for (const name of readdirSync(dir).filter((n) => n.endsWith(".scenario.json"))) {
                const urlPath = path.relative(releaseRoot, path.join(dir, name)).replace(/\\/g, "/");
                let local = 0;

                const source = await StreamingAssetSource.fromUrl(`${base}/${urlPath}`);

                for (const scriptPath of source.listScripts()) {
                    const got = await source.readScript(scriptPath);
                    if (got == null || got.length === 0) {
                        console.log(`  EMPTY SCRIPT ${scriptPath}`);
                        local += 1;
                    }
                }

                for (const asset of source.manifest.assets) {
                    const bytes = await source.readBytes(asset.path);
                    const expected = asset.lods[0].bytes;
                    if (expected !== undefined && bytes.length !== expected) {
                        console.log(`  SIZE ${asset.path}: fetched ${bytes.length}, manifest says ${expected}`);
                        local += 1;
                    }
                }

                const byPriority = ["critical", "high", "low", "lazy"]
                    .map((p) => [p, source.pathsByPriority(p).length])
                    .filter(([, n]) => n > 0)
                    .map(([p, n]) => `${n} ${p}`)
                    .join(", ");

                console.log(
                    `${local ? "FAIL" : "ok  "} ${urlPath}  ` +
                    `id=${source.manifest.id}  scripts=${source.listScripts().length}  ` +
                    `assets=${source.manifest.assets.length} (${byPriority})  ` +
                    `identity=${source.assetEntries().length}  ` +
                    `fetched=${fmt(source.bytesFetched)} in ${source.requestCount} requests`
                );
                problems += local;
                source.dispose?.();
            }
        }
    } finally {
        server.close();
    }

    console.log(
        problems === 0
            ? "\nEvery manifest loaded through the engine's own StreamingAssetSource."
            : `\n${problems} problems.`
    );
    if (problems > 0) process.exit(1);
}

/**
 * Re-reads every emitted manifest and checks it against what is on disk.
 *
 * This repository has no automated tests; correctness is verified by inspecting
 * the produced artifacts. A manifest is worse than a ZIP in that respect — a ZIP
 * either contains a file or it does not, while a manifest is a set of promises
 * about files somewhere else, and a broken one fails at runtime as an asset that
 * silently never appears. So: parse with the engine's validator, then confirm
 * every url resolves and its bytes still hash to what was recorded.
 */
function verifyManifests() {
    let checked = 0;
    let problems = 0;

    for (const dir of [releaseRoot, testReleaseRoot]) {
        if (!existsSync(dir)) continue;
        for (const name of readdirSync(dir).filter((n) => n.endsWith(".scenario.json"))) {
            const manifestPath = path.join(dir, name);
            let local = 0;

            const parsed = parseStreamingManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
            const scenario = toScenarioManifest(parsed);

            const refs = [
                ...(parsed.scripts ?? []).map((s) => [s.path, s.url, s.bytes, s.hash]),
                ...parsed.assets.flatMap((a) => a.lods.map((l) => [a.path, l.url, l.bytes, l.hash])),
            ];

            for (const [logical, url, bytes, hash] of refs) {
                const abs = path.resolve(dir, url);
                if (!existsSync(abs)) {
                    console.log(`  MISSING  ${logical} → ${url}`);
                    local += 1;
                    continue;
                }
                const actual = readFileSync(abs);
                if (bytes !== undefined && actual.length !== bytes) {
                    console.log(`  SIZE     ${logical}: recorded ${bytes}, on disk ${actual.length}`);
                    local += 1;
                }
                const digest = `sha256-${createHash("sha256").update(actual).digest("hex")}`;
                if (hash !== undefined && digest !== hash) {
                    console.log(`  HASH     ${logical}`);
                    local += 1;
                }
                checked += 1;
            }

            console.log(
                `${local ? "FAIL" : "ok  "} ${manifestPath}  ` +
                `entry=${scenario.entryPoint}  refs=${refs.length}  identity=${scenario.assets.length}`
            );
            problems += local;
        }
    }

    console.log(`\nChecked ${checked} referenced files across the manifests: ${problems} problems.`);
    if (problems > 0) process.exit(1);
}

/** Same rule as build-package.mjs: a directory with `scripts/` is a scenario. */
function discoverIn(root) {
    if (!existsSync(root)) return [];
    return readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(root, entry.name))
        .filter((dir) => existsSync(path.join(dir, "scripts")));
}

function getScenarioMap() {
    const map = new Map();
    for (const dir of discoverIn(scenariosRoot)) {
        map.set(path.basename(dir), { dir, kind: "production" });
    }
    for (const dir of discoverIn(testScenariosRoot)) {
        map.set(path.basename(dir), { dir, kind: "test" });
    }
    return map;
}

function findTar() {
    // Same resolution as build-package.mjs, and for the same reason: Git for
    // Windows puts GNU tar on PATH first, which reads `C:\...` as a remote host.
    const systemRoot = process.env.SystemRoot || process.env.windir;
    if (systemRoot) {
        const bsdtar = path.join(systemRoot, "System32", "tar.exe");
        if (existsSync(bsdtar)) return bsdtar;
    }
    return "tar.exe";
}

function walkFiles(dir) {
    const stack = [dir];
    const files = [];
    while (stack.length > 0) {
        const current = stack.pop();
        for (const entry of readdirSync(current, { withFileTypes: true })) {
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) stack.push(full);
            else if (entry.isFile()) files.push(full);
        }
    }
    return files;
}

/**
 * Glob to RegExp, supporting `**`, `*` and `?`.
 *
 * `*` deliberately does not cross a `/`, so `textures/*.jpg` cannot reach into a
 * subdirectory; `**` is the one that does.
 */
function globToRegExp(glob) {
    let out = "";
    for (let i = 0; i < glob.length; i++) {
        const c = glob[i];
        if (c === "*") {
            if (glob[i + 1] === "*") {
                out += ".*";
                i += 1;
                if (glob[i + 1] === "/") i += 1; // `**/` also matches zero directories
            } else {
                out += "[^/]*";
            }
        } else if (c === "?") {
            out += "[^/]";
        } else {
            out += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
        }
    }
    return new RegExp(`^${out}$`);
}

function matchPriority(relPath, rules) {
    for (const [glob, priority] of rules) {
        if (globToRegExp(glob).test(relPath)) return priority;
    }
    return "low";
}

/**
 * Optional per-scenario metadata: `<scenario>/scenario.meta.json`.
 *
 * Absent is the normal case and everything falls back to a derived default, so
 * no scenario has to be given one before this tool works on it. The same file is
 * where P2 should read real id/name/version from, which is why identity lives
 * here rather than in a streaming-only side file.
 */
function readMeta(scenarioDir, scenarioName) {
    const metaPath = path.join(scenarioDir, "scenario.meta.json");
    const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, "utf8")) : {};

    const slug = scenarioName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const priorities = meta.streaming?.priorities
        ? Object.entries(meta.streaming.priorities)
        : [];

    return {
        id: typeof meta.id === "string" ? meta.id : slug,
        name: typeof meta.name === "string" ? meta.name : scenarioName,
        description: typeof meta.description === "string" ? meta.description : undefined,
        // The engine's schema types `version` as a number, unlike the ZIP
        // manifest's string. Not an oversight to reconcile — the ZIP records a
        // human release version, this records which build of the content the
        // URLs point at.
        version: typeof meta.version === "number" ? meta.version : 1,
        // Author rules first, then the built-in ladder as the fallback tail.
        priorities: [...priorities, ...DEFAULT_PRIORITIES],
        hasMeta: existsSync(metaPath),
    };
}

/**
 * Stable per-asset identity.
 *
 * Derived from the scenario id and the asset's path, never from its bytes: a
 * guid has to survive re-encoding a texture, or a serialized scene stops
 * resolving the moment the asset is rebuilt. The engine drops assets without a
 * guid rather than minting one, for the same reason — an id that does not
 * survive a reload is worse than none. Renaming an asset does change its guid,
 * which is the honest limit of deriving identity from a path.
 */
function assetGuid(scenarioId, assetPath) {
    return createHash("sha256").update(`${scenarioId}\u0000${assetPath}`).digest("hex").slice(0, 32);
}

/** Writes bytes into the shared store under their own hash. Returns the relative url. */
function storeObject(bytes, ext, stats) {
    const hash = createHash("sha256").update(bytes).digest("hex");
    const shard = hash.slice(0, 2);
    const fileName = `${hash}${ext}`;
    const absDir = path.join(objectsRoot, shard);
    const absPath = path.join(absDir, fileName);

    if (existsSync(absPath)) {
        stats.deduped += 1;
        stats.dedupedBytes += bytes.length;
    } else {
        mkdirSync(absDir, { recursive: true });
        writeFileSync(absPath, bytes);
        stats.written += 1;
        stats.writtenBytes += bytes.length;
    }

    return { hash, objectPath: absPath };
}

function emitManifest(scenarioName, scenarioDir, kind) {
    const outRoot = kind === "test" ? testReleaseRoot : releaseRoot;
    const zipPath = path.join(outRoot, `${scenarioName}.zip`);
    if (!existsSync(zipPath)) {
        throw new Error(
            `No archive at ${zipPath}. Build it first: ` +
            `npm run build -- --scenario ${scenarioName}`
        );
    }

    const meta = readMeta(scenarioDir, scenarioName);
    console.log(`\n[manifest] ${scenarioName} → id "${meta.id}"` +
        (meta.hasMeta ? "" : "  (no scenario.meta.json — using derived defaults)"));

    const tempDir = mkdtempSync(path.join(tmpdir(), "scenario-manifest-"));
    const stats = { written: 0, writtenBytes: 0, deduped: 0, dedupedBytes: 0 };

    try {
        execFileSync(findTar(), ["-x", "-f", zipPath, "-C", tempDir], { stdio: "inherit" });

        const zipManifestPath = path.join(tempDir, "manifest.json");
        if (!existsSync(zipManifestPath)) {
            throw new Error(`${zipPath} has no manifest.json at its root.`);
        }
        const zipManifest = JSON.parse(readFileSync(zipManifestPath, "utf8"));
        if (typeof zipManifest.entryPoint !== "string") {
            throw new Error(`${zipPath} manifest.json has no entryPoint.`);
        }

        const scripts = [];
        const assets = [];
        const counts = { critical: 0, high: 0, low: 0, lazy: 0 };

        const scriptsDir = path.join(tempDir, "scripts");
        if (existsSync(scriptsDir)) {
            for (const abs of walkFiles(scriptsDir).sort()) {
                if (!abs.endsWith(".js")) continue;
                const rel = path.relative(scriptsDir, abs).replace(/\\/g, "/");
                const bytes = readFileSync(abs);
                const { hash, objectPath } = storeObject(bytes, path.extname(abs), stats);
                scripts.push({
                    path: `scripts/${rel}`,
                    url: path.relative(outRoot, objectPath).replace(/\\/g, "/"),
                    bytes: bytes.length,
                    hash: `sha256-${hash}`,
                });
            }
        }

        const assetsDir = path.join(tempDir, "assets");
        if (existsSync(assetsDir)) {
            for (const abs of walkFiles(assetsDir).sort()) {
                const rel = path.relative(assetsDir, abs).replace(/\\/g, "/");
                const bytes = readFileSync(abs);
                const { hash, objectPath } = storeObject(bytes, path.extname(abs), stats);
                const priority = matchPriority(rel, meta.priorities);
                counts[priority] = (counts[priority] ?? 0) + 1;
                assets.push({
                    path: `assets/${rel}`,
                    guid: assetGuid(meta.id, `assets/${rel}`),
                    priority,
                    // One level for now. P3 turns convert_to_ktx2.sh into a
                    // ladder and this becomes the list it was shaped for.
                    lods: [{
                        level: 0,
                        url: path.relative(outRoot, objectPath).replace(/\\/g, "/"),
                        bytes: bytes.length,
                        hash: `sha256-${hash}`,
                    }],
                });
            }
        }

        const manifest = {
            schema: 1,
            id: meta.id,
            name: meta.name,
            ...(meta.description ? { description: meta.description } : {}),
            version: meta.version,
            entry: `scripts/${zipManifest.entryPoint}`,
            scripts,
            assets,
        };

        // Parse it back with the engine's own validator before writing. A
        // manifest is written by a tool and read by a loader with no user in
        // between, so a malformed one has to fail here — not later, as a texture
        // that silently never appears.
        const parsed = parseStreamingManifest(manifest);
        toScenarioManifest(parsed);

        const outPath = path.join(outRoot, `${scenarioName}.scenario.json`);
        mkdirSync(outRoot, { recursive: true });
        writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

        const priorityLine = Object.entries(counts)
            .filter(([, n]) => n > 0)
            .map(([p, n]) => `${n} ${p}`)
            .join(", ");
        console.log(`  scripts ${scripts.length}, assets ${assets.length} (${priorityLine || "none"})`);
        console.log(`  objects: ${stats.written} written (${fmt(stats.writtenBytes)}), ` +
            `${stats.deduped} already present (${fmt(stats.dedupedBytes)} not stored again)`);
        console.log(`[ok] ${outPath}`);

        return stats;
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
}

function fmt(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

const options = parseArgs();

if (options.verify) {
    verifyManifests();
    process.exit(0);
}

if (options.verifyFetch) {
    await verifyByFetch();
    process.exit(0);
}

const scenarioMap = getScenarioMap();
const availableNames = [...scenarioMap.keys()].sort();

let namesToEmit;
if (options.buildAll) {
    // `--all` means production only, matching build-package.mjs. Test scenarios
    // are opt-in so a routine run cannot publish a benchmark scene.
    namesToEmit = availableNames.filter(
        (n) => options.includeTests || scenarioMap.get(n).kind === "production"
    );
} else if (options.selected.length > 0) {
    namesToEmit = [...new Set(options.selected)];
} else {
    throw new Error(
        "No scenario selected. Use --scenario <name> (comma-separate for several), " +
        "--all, or --all --tests."
    );
}

for (const name of namesToEmit) {
    if (!scenarioMap.has(name)) {
        throw new Error(`Unknown scenario '${name}'. Known: ${availableNames.join(", ")}`);
    }
}

const total = { written: 0, writtenBytes: 0, deduped: 0, dedupedBytes: 0 };
for (const name of namesToEmit) {
    const entry = scenarioMap.get(name);
    const stats = emitManifest(name, entry.dir, entry.kind);
    for (const key of Object.keys(total)) total[key] += stats[key];
}

console.log(`\nDone. Manifests in ${releaseRoot}, objects in ${objectsRoot}`);
if (namesToEmit.length > 1) {
    console.log(`Across ${namesToEmit.length} scenarios: ${total.written} objects stored ` +
        `(${fmt(total.writtenBytes)}), ${total.deduped} shared (${fmt(total.dedupedBytes)} saved).`);
}
