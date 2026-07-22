import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const rootDir = process.cwd();
const scenariosRoot = path.join(rootDir, "Scenarios");
const releaseRoot = path.join(rootDir, "ReleaseScenarios");

function getScenarioMap() {
    const map = new Map();

    const dirs = readdirSync(scenariosRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(scenariosRoot, entry.name))
        .filter((dir) => existsSync(path.join(dir, "scripts")));

    for (const dir of dirs) {
        map.set(path.basename(dir), dir);
    }

    return map;
}

function parseArgs() {
    const args = process.argv.slice(2);
    const selected = [];
    let listOnly = false;
    let buildAll = false;
    let ktx2 = false;

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

function runKtx2Conversion(scenarioDir) {
    const script = path.join(scenarioDir, "convert_to_ktx2.sh");
    const scenarioName = path.basename(scenarioDir);
    if (!existsSync(script)) {
        console.log(`  [ktx2] ${scenarioName}: no convert_to_ktx2.sh — skipping (loose-texture scenes only)`);
        return;
    }
    console.log(`  [ktx2] ${scenarioName}: generating .ktx2 alongside originals...`);
    try {
        execFileSync("bash", ["convert_to_ktx2.sh"], {
            cwd: scenarioDir,
            stdio: "inherit",
            env: { ...process.env, INCLUDE_SKYBOX: process.env.INCLUDE_SKYBOX ?? "0" },
        });
    } catch (err) {
        console.warn(
            `  [ktx2] conversion failed (KTX-Software or bash missing?) — ` +
            `packaging existing textures only. ${err?.message ?? err}`
        );
    }
}

function buildScenario(scenarioDir, ktx2) {
    const scenarioName = path.basename(scenarioDir);
    const scriptsDir = path.join(scenarioDir, "scripts");
    const distDir = path.join(scenarioDir, "dist");
    const assetsDir = path.join(scenarioDir, "assets");
    const entryPoint = detectEntryPoint(scriptsDir);
    const zipPath = path.join(releaseRoot, `${scenarioName}.zip`);

    console.log(`\n[build] ${scenarioName}`);

    rmSync(distDir, { recursive: true, force: true });
    compileScenarioTypescript(scenarioDir, scriptsDir, distDir);

    const compiledScriptsDir = path.join(distDir, "scripts");
    const scriptEntries = findJsFiles(compiledScriptsDir)
        .map((filePath) => `scripts/${path.relative(compiledScriptsDir, filePath).replace(/\\/g, "/")}`)
        .sort();

    const manifest = {
        manifestVersion: "1.0",
        id: `template.${scenarioName.toLowerCase().replace(/[^a-z0-9]+/g, ".")}`,
        name: `Template ${scenarioName}`,
        version: "0.0.1-template",
        description: "Template description: replace with scenario details.",
        category: "template",
        author: {
            name: "Template Author",
            email: "template.author@example.com",
        },
        engineVersion: "0.0.0-template",
        entryPoint,
        metadata: {
            scripts: scriptEntries,
        },
    };

    writeFileSync(path.join(distDir, "manifest.json"), `${JSON.stringify(manifest, null, 4)}\n`, "utf8");

    if (ktx2) {
        runKtx2Conversion(scenarioDir);
    }

    if (existsSync(assetsDir)) {
        cpSync(assetsDir, path.join(distDir, "assets"), { recursive: true });
    }

    rmSync(zipPath, { force: true });

    const archiveEntries = readdirSync(distDir);
    if (archiveEntries.length === 0) {
        throw new Error(`No files were produced for packaging in ${distDir}`);
    }

    execFileSync("tar.exe", ["-a", "-c", "-f", zipPath, ...archiveEntries], {
        cwd: distDir,
        stdio: "inherit",
    });

    rmSync(distDir, { recursive: true, force: true });
    console.log(`[ok] Created ${zipPath}`);
}

if (!existsSync(scenariosRoot)) {
    throw new Error(`Scenarios directory not found: ${scenariosRoot}`);
}

mkdirSync(releaseRoot, { recursive: true });

const options = parseArgs();
const scenarioMap = getScenarioMap();
const availableNames = [...scenarioMap.keys()].sort();

if (availableNames.length === 0) {
    throw new Error(`No scenario folders with scripts/ were found in ${scenariosRoot}`);
}

if (options.listOnly) {
    console.log("Available scenarios:");
    for (const name of availableNames) {
        console.log(`- ${name}`);
    }
    process.exit(0);
}

let namesToBuild;
if (options.buildAll) {
    namesToBuild = availableNames;
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
    buildScenario(scenarioMap.get(name), options.ktx2);
}

console.log(`\nDone. Packages are in ${releaseRoot}`);
