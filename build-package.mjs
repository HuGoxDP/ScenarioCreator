import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { assetGuid, installedEngineVersion, readScenarioMeta } from "./scenario-meta.mjs";

const rootDir = process.cwd();
// Two sources, kept apart on purpose. `Scenarios/` is what students get;
// `TestScenarios/` holds the ones used for measurement and engine testing —
// benchmark scenes, feature demos — which must never reach the catalog by
// accident. The split is a directory rather than a flag inside each scenario
// so it is visible without opening anything.
const scenariosRoot = path.join(rootDir, "Scenarios");
const testScenariosRoot = path.join(rootDir, "TestScenarios");
const releaseRoot = path.join(rootDir, "ReleaseScenarios");

/** Test packages land in their own folder, so a stray upload cannot mix them in. */
const testReleaseRoot = path.join(releaseRoot, "test");

/** Scenario folders under one root. A folder without `scripts/` is not one. */
function discoverIn(root) {
    if (!existsSync(root)) return [];

    return readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(root, entry.name))
        .filter((dir) => existsSync(path.join(dir, "scripts")));
}

/**
 * Every scenario, keyed by name, carrying which root it came from.
 * A name may not appear in both roots — that would make `--scenario <name>`
 * ambiguous and, worse, make it unclear whether the result is publishable.
 */
function getScenarioMap() {
    const map = new Map();

    for (const dir of discoverIn(scenariosRoot)) {
        map.set(path.basename(dir), { dir, kind: "production" });
    }

    for (const dir of discoverIn(testScenariosRoot)) {
        const name = path.basename(dir);
        if (map.has(name)) {
            throw new Error(
                `Scenario '${name}' exists in both Scenarios/ and TestScenarios/. ` +
                `Rename one — a scenario is either published or it is not.`
            );
        }
        map.set(name, { dir, kind: "test" });
    }

    return map;
}

function parseArgs() {
    const args = process.argv.slice(2);
    const selected = [];
    let listOnly = false;
    let buildAll = false;
    let ktx2 = false;
    let strict = false;
    let includeTests = false;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === "--list") {
            listOnly = true;
            continue;
        }
        if (arg === "--all") {
            buildAll = true;
            continue;
        }
        if (arg === "--ktx2") {
            ktx2 = true;
            continue;
        }
        if (arg === "--strict") {
            strict = true;
            continue;
        }
        if (arg === "--tests") {
            includeTests = true;
            continue;
        }
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

    return {
        listOnly,
        buildAll,
        selected,
        ktx2,
        strict,
        includeTests,
    };
}

function findTsFiles(dir) {
    const stack = [dir];
    const files = [];

    while (stack.length > 0) {
        const current = stack.pop();
        const entries = readdirSync(current, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                stack.push(fullPath);
            } else if (entry.isFile() && fullPath.endsWith(".ts") && !fullPath.endsWith(".d.ts")) {
                files.push(fullPath);
            }
        }
    }

    return files;
}

function findJsFiles(dir) {
    const stack = [dir];
    const files = [];

    while (stack.length > 0) {
        const current = stack.pop();
        const entries = readdirSync(current, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                stack.push(fullPath);
            } else if (entry.isFile() && fullPath.endsWith(".js")) {
                files.push(fullPath);
            }
        }
    }

    return files;
}

function detectEntryPoint(scriptsDir) {
    const candidateFiles = findTsFiles(scriptsDir);
    const matches = [];

    for (const filePath of candidateFiles) {
        const source = readFileSync(filePath, "utf8");
        if (/class\s+[A-Za-z_$][A-Za-z0-9_$]*\s+extends\s+ScenarioBehaviour\b/.test(source)) {
            matches.push(filePath);
        }
    }

    if (matches.length !== 1) {
        const count = matches.length;
        throw new Error(
            `Expected exactly one class extending ScenarioBehaviour in ${scriptsDir}, found ${count}.`
        );
    }

    const relativeTsPath = path.relative(scriptsDir, matches[0]).replace(/\\/g, "/");
    return relativeTsPath.replace(/\.ts$/, ".js");
}

function compileScenarioTypescript(scenarioDir, scriptsDir, distDir) {
    const tscPath = path.join(rootDir, "node_modules", "typescript", "lib", "tsc.js");
    if (!existsSync(tscPath)) {
        throw new Error("TypeScript is not installed at root. Run: npm install");
    }

    const tsFiles = findTsFiles(scriptsDir);
    if (tsFiles.length === 0) {
        throw new Error(`No TypeScript files found in ${scriptsDir}`);
    }

    const outScriptsDir = path.join(distDir, "scripts");
    const tscArgs = [
        tscPath,
        "--pretty", "false",
        "--ignoreConfig",
        "--target", "ES2020",
        "--module", "ESNext",
        "--moduleResolution", "bundler",
        "--strict",
        "--declaration", "false",
        "--sourceMap", "false",
        "--outDir", outScriptsDir,
        "--rootDir", scriptsDir,
        "--skipLibCheck",
        ...tsFiles,
    ];

    execFileSync(process.execPath, tscArgs, {
        cwd: scenarioDir,
        stdio: "inherit",
    });
}

function findBash() {
    // Prefer Git Bash over PATH's `bash`: on Windows that is often
    // System32\bash.exe — the WSL relay, which fails ("execvpe(/bin/bash)")
    // when no WSL distro provides a usable /bin/bash. Set the BASH env var
    // to override.
    const candidates = [
        process.env.BASH,
        "C:\\Program Files\\Git\\bin\\bash.exe",
        "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
        "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
    ].filter(Boolean);

    // Git isn't always under Program Files (e.g. a per-user install under
    // C:\Users\<user>\Programs\Git). Derive candidates from wherever
    // git.exe actually is instead of hardcoding a username.
    try {
        const whereOut = execFileSync("where.exe", ["git.exe"], { encoding: "utf8" });
        for (const gitExe of whereOut.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)) {
            let dir = path.dirname(gitExe);
            for (let i = 0; i < 3; i++) {
                candidates.push(path.join(dir, "bin", "bash.exe"), path.join(dir, "usr", "bin", "bash.exe"));
                dir = path.dirname(dir);
            }
        }
    } catch {
        // `where.exe` unavailable or git not on PATH — fall through to the other candidates.
    }

    for (const c of candidates) {
        if (existsSync(c)) return c;
    }
    return "bash";
}

function findTar() {
    // Windows ships bsdtar at System32\tar.exe: it understands `C:\...` paths
    // and `-a` (infer archive format from the extension). Git for Windows
    // ships GNU tar at usr\bin\tar.exe, which reads `C:\...` as a *remote host*
    // spec and dies with "Cannot connect to C: resolve failed". A bare
    // "tar.exe" picks whichever comes first on PATH, so which shell launched
    // the build silently decides whether packaging works. Resolve explicitly.
    const systemRoot = process.env.SystemRoot || process.env.windir;
    if (systemRoot) {
        const bsdtar = path.join(systemRoot, "System32", "tar.exe");
        if (existsSync(bsdtar)) return bsdtar;
    }
    return "tar.exe";
}

/**
 * Set from --strict. Module-level rather than threaded through buildScenario,
 * because the failure policy is a property of the run, not of any one scenario.
 */
let strictKtx2 = false;

function runKtx2Conversion(scenarioDir) {
    const script = path.join(scenarioDir, "convert_to_ktx2.sh");
    const scenarioName = path.basename(scenarioDir);
    if (!existsSync(script)) {
        console.log(`  [ktx2] ${scenarioName}: no convert_to_ktx2.sh — skipping (loose-texture scenes only)`);
        return;
    }
    console.log(`  [ktx2] ${scenarioName}: generating .ktx2 alongside originals...`);
    try {
        execFileSync(findBash(), ["convert_to_ktx2.sh"], {
            cwd: scenarioDir,
            stdio: "inherit",
            env: { ...process.env, INCLUDE_SKYBOX: process.env.INCLUDE_SKYBOX ?? "0" },
        });
    } catch (err) {
        const detail =
            `Needs Git Bash + KTX-Software on PATH; set BASH=<path-to-git-bash.exe> ` +
            `if not auto-found. ${err?.message ?? err}`;
        if (strictKtx2) {
            // Degrading to "packaging existing textures only" is right for a
            // routine build and wrong for a release. --ktx2 returning success
            // while producing no .ktx2 at all is exactly how an archive with a
            // stale or missing encode reaches a student, and the exit code gives
            // no hint at all. --strict turns that into a stop.
            throw new Error(
                `[ktx2] ${scenarioName}: conversion failed and --strict is set. ${detail}`
            );
        }
        console.warn(`  [ktx2] conversion failed — packaging existing textures only. ${detail}`);
    }
}

/**
 * @param scenarioDir absolute path to the scenario folder
 * @param ktx2 whether to also emit compressed textures
 * @param kind "production" or "test" — decides which release folder it lands in
 */
function buildScenario(scenarioDir, ktx2, kind) {
    const scenarioName = path.basename(scenarioDir);
    const scriptsDir = path.join(scenarioDir, "scripts");
    const distDir = path.join(scenarioDir, "dist");
    const assetsDir = path.join(scenarioDir, "assets");
    const entryPoint = detectEntryPoint(scriptsDir);
    const outRoot = kind === "test" ? testReleaseRoot : releaseRoot;
    mkdirSync(outRoot, { recursive: true });
    const zipPath = path.join(outRoot, `${scenarioName}.zip`);

    console.log(`\n[build] ${scenarioName}`);

    rmSync(distDir, { recursive: true, force: true });
    compileScenarioTypescript(scenarioDir, scriptsDir, distDir);

    const compiledScriptsDir = path.join(distDir, "scripts");
    const scriptEntries = findJsFiles(compiledScriptsDir)
        .map((filePath) => `scripts/${path.relative(compiledScriptsDir, filePath).replace(/\\/g, "/")}`)
        .sort();

    if (ktx2) {
        runKtx2Conversion(scenarioDir);
    }

    if (existsSync(assetsDir)) {
        cpSync(assetsDir, path.join(distDir, "assets"), { recursive: true });
    }

    // The manifest is written after the assets are staged, not before: --ktx2
    // generates textures during the step above, and an asset list built earlier
    // would omit exactly the files that run was for.
    const meta = readScenarioMeta(scenarioDir, scenarioName);
    const distAssetsDir = path.join(distDir, "assets");
    const assetEntries = existsSync(distAssetsDir)
        ? readdirSync(distAssetsDir, { recursive: true, withFileTypes: true })
            .filter((entry) => entry.isFile())
            .map((entry) => {
                const rel = path.relative(distAssetsDir, path.join(entry.parentPath, entry.name));
                return `assets/${rel.replace(/\\/g, "/")}`;
            })
            .sort()
            .map((assetPath) => ({ guid: assetGuid(meta.id, assetPath), path: assetPath }))
        : [];

    const manifest = {
        manifestVersion: "1.0",
        id: meta.id,
        name: meta.name,
        version: meta.version,
        ...(meta.description ? { description: meta.description } : {}),
        ...(meta.category ? { category: meta.category } : {}),
        ...(meta.author ? { author: meta.author } : {}),
        ...(meta.graded ? { graded: true } : {}),
        engineVersion: installedEngineVersion(rootDir),
        entryPoint,
        // Stable identities, so a scene serialized while this ran from a ZIP
        // still resolves when the same scenario is served from a manifest —
        // build-manifest.mjs derives them the same way, from the same id.
        assets: assetEntries,
        metadata: {
            scripts: scriptEntries,
        },
    };

    writeFileSync(path.join(distDir, "manifest.json"), `${JSON.stringify(manifest, null, 4)}\n`, "utf8");

    rmSync(zipPath, { force: true });

    const archiveEntries = readdirSync(distDir);
    if (archiveEntries.length === 0) {
        throw new Error(`No files were produced for packaging in ${distDir}`);
    }

    execFileSync(findTar(), ["-a", "-c", "-f", zipPath, ...archiveEntries], {
        cwd: distDir,
        stdio: "inherit",
    });

    rmSync(distDir, { recursive: true, force: true });
    console.log(`[ok] Created ${zipPath}`);
}

if (!existsSync(scenariosRoot) && !existsSync(testScenariosRoot)) {
    throw new Error(
        `No scenario roots found. Expected ${scenariosRoot} or ${testScenariosRoot}.`
    );
}

mkdirSync(releaseRoot, { recursive: true });

const options = parseArgs();
strictKtx2 = options.strict;
const scenarioMap = getScenarioMap();
const availableNames = [...scenarioMap.keys()].sort();

if (availableNames.length === 0) {
    throw new Error(
        `No scenario folders with scripts/ were found in ${scenariosRoot} or ${testScenariosRoot}`
    );
}

if (options.listOnly) {
    const byKind = (kind) => availableNames.filter((n) => scenarioMap.get(n).kind === kind);

    console.log("Production scenarios (Scenarios/):");
    for (const name of byKind("production")) console.log(`- ${name}`);

    const tests = byKind("test");
    console.log("\nTest scenarios (TestScenarios/ — built only with --all --tests or by name):");
    if (tests.length === 0) console.log("- (none)");
    for (const name of tests) console.log(`- ${name}`);

    process.exit(0);
}

let namesToBuild;
if (options.buildAll) {
    // `--all` means "everything publishable". Test scenarios are opt-in via
    // --tests or by naming them, so a routine rebuild-and-publish cannot ship
    // a benchmark scene to students.
    namesToBuild = availableNames.filter(
        (n) => options.includeTests || scenarioMap.get(n).kind === "production"
    );
} else if (options.selected.length > 0) {
    namesToBuild = [...new Set(options.selected)];
} else {
    throw new Error(
        "No scenario selected. Use --scenario <name> (can repeat or comma-separate), --all, or --list."
    );
}

for (const name of namesToBuild) {
    if (!scenarioMap.has(name)) {
        throw new Error(`Unknown scenario '${name}'. Use --list to see valid names.`);
    }
}

for (const name of namesToBuild) {
    const entry = scenarioMap.get(name);
    buildScenario(entry.dir, options.ktx2, entry.kind);
}

const builtTests = namesToBuild.filter((n) => scenarioMap.get(n).kind === "test");
console.log(`\nDone. Packages are in ${releaseRoot}`);
if (builtTests.length > 0) {
    console.log(`Test packages (${builtTests.join(", ")}) are in ${testReleaseRoot} — not for the catalog.`);
}
