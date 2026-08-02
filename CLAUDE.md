# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# ScenarioCreator

Build pipeline that turns scenario **source** in `Scenarios/` into distributable `.zip` archives
in `ReleaseScenarios/`. One shared `node_modules` at the repo root serves every scenario — there
are no per-scenario `package.json`, `tsconfig.json` or build scripts.

User-facing usage lives in `README.md`. **This file is the working guide**: the rules that are
easy to break and the reasons behind them.

## Ecosystem position

This repo is the **content producer** of a four-repo ecosystem (all under
`C:\Users\Work\WebstormProjects\`):

- **WebEngineTS** — the 3D engine. Consumed here as a packed tarball
  (`WebEngineTS-0.1.0.tgz`, a `file:` dependency) purely so scenario TypeScript can compile
  against `ScenarioBehaviour` and the rest of the engine API.
- **virtual-lab** — the web platform students use. Consumes the ZIPs this repo produces,
  uploaded through its `/admin` screen. It stores only catalog metadata and the archives.
- **WebEngineTSEditor** — the graphical editor; another engine consumer.

Data flow is one-directional: **engine → this repo → ZIP → virtual-lab**. Nothing here imports
from the platform, and the platform never builds scenarios.

Each repo keeps its **own copy** of the engine tarball. They are not kept in lockstep
automatically — `WebEngineTS-0.1.0.tgz` here can lag behind the one in `virtual-lab`. If a
scenario compiles here but fails at runtime in the platform, suspect that gap first.

## Critical rules

1. **Scenarios are content only.** No embedded benchmarking, no optimization toggles, no
   measurement code. That was stripped in `05af25d` on purpose: performance measurement belongs
   to the engine's harness (`WebEngineTS/benchmarks/run.ts` + `Benchmark`/`MemoryProfiler`),
   driven by **URL flags**. One ZIP per scene; you change the URL, not the ZIP. Re-introducing a
   `BenchmarkHarness` into a scenario silently invalidates every number the harness produces.
2. **No engine code here.** Rendering, math and scenario-runtime concerns belong in WebEngineTS.
3. **No platform code here.** Catalog, auth and storage belong in virtual-lab.
4. **Exactly one `ScenarioBehaviour` subclass per scenario.** See "Entry point detection" below.

## How the build works

`build-package.mjs` (327 lines, run via `npm run build`). Per scenario:

1. **Discovery** — every directory under `Scenarios/` that contains a `scripts/` folder is a
   scenario. A folder without `scripts/` is invisible to the builder.
2. **Compile** — `tsc` is invoked directly from `node_modules/typescript/lib/tsc.js` with flags
   on the command line and **`--ignoreConfig`**: the root `tsconfig.json` is deliberately *not*
   used for scenario compilation. Target ES2020, module ESNext, strict, no declarations, no
   source maps. Output: `<scenario>/dist/scripts`.
3. **Entry point detection** — the source is scanned with a regex for
   `class X extends ScenarioBehaviour`. **Exactly one match is required**; zero or several is a
   hard build failure rather than an ambiguous guess. The detected `.ts` path becomes the `.js`
   `entryPoint`, relative to `scripts/`.
4. **Manifest** — `<scenario>/dist/manifest.json` is generated (see the warning below).
5. **KTX2** (only with `--ktx2`) — runs the scenario's `convert_to_ktx2.sh`, producing `.ktx2`
   next to the originals so **both** formats ship in one archive.
6. **Assets** — `<scenario>/assets` is copied verbatim if present.
7. **Package** — `tar.exe -a -c -f` zips the `dist` contents, then `dist/` is deleted.

### Manifest metadata is currently a placeholder

`build-package.mjs:240-256` hard-codes template values into every manifest:

```js
id: `template.${scenarioName.toLowerCase().replace(/[^a-z0-9]+/g, ".")}`,
name: `Template ${scenarioName}`,
version: "0.0.1-template",
category: "template",
author: { name: "Template Author", ... },
engineVersion: "0.0.0-template",
```

So a published scenario reports `id: template.benchscene3.solarsystem` and version
`0.0.1-template`. **This is why the manifest id never matches the platform's catalog id** —
virtual-lab uses slugs (`solar-system`), treats the mismatch as a warning rather than an error,
and records `manifest_id` separately. Do not "fix" this by making the platform enforce equality;
fix it here, by sourcing real metadata. Tracked in
[`docs/TASK-rebuild-and-republish.md`](docs/TASK-rebuild-and-republish.md).

## Platform contract

`virtual-lab/backend/archive-validation.js` rejects an upload unless:

- the file parses as a ZIP;
- `manifest.json` is at the archive **root** (not nested in a subdirectory);
- it is valid JSON;
- `manifestVersion`, `id`, `name`, `version` and `entryPoint` are all present;
- `scripts/<entryPoint>` actually exists inside the archive.

A build that satisfies this repo's own rules satisfies that automatically. If an upload is
refused, the message names the exact reason.

## Build & Dev

```powershell
npm install                                              # once, at the repo root
npm run build:list                                       # names the builder recognises
npm run build -- --scenario Benchscene3_solarsystem      # one (comma-separate for several)
npm run build:all                                        # everything
npm run clean:release                                    # empty ReleaseScenarios/

$env:INCLUDE_SKYBOX = "1"                                # also convert the skybox panorama
npm run build -- --scenario Benchscene3_solarsystem --ktx2
```

**Either shell works — the builder no longer depends on PATH order.** Both external binaries it
shells out to are ambiguous on Windows, so each is resolved explicitly:

- `findTar()` picks `%SystemRoot%\System32\tar.exe` (bsdtar). Git for Windows puts GNU tar on
  PATH first, which reads `C:\...` as a *remote host* and fails with
  `tar: Cannot connect to C: resolve failed` — that is why running the build from Git Bash used
  to break packaging.
- `findBash()` prefers Git Bash over PATH's `bash.exe`, because the latter is often the WSL relay
  in `System32`, which fails with `execvpe(/bin/bash)` when no WSL distro provides `/bin/bash`.
  It also derives candidates from `where.exe git.exe`, so a per-user Git install (outside
  `C:\Program Files`) is found. Override with the `BASH` env var.

KTX2 conversion needs [KTX-Software](https://github.com/KhronosGroup/KTX-Software). The builder
only requires it on PATH; the fallback to `C:\Program Files\KTX-Software\bin` lives inside each
scenario's `convert_to_ktx2.sh`, not in `build-package.mjs`. Only scenarios that ship that script
are affected; the rest build unchanged.

**`--ktx2` failing does not fail the build.** `runKtx2Conversion` catches the error, prints
`[ktx2] conversion failed — packaging existing textures only`, and packages the originals. So a
`--ktx2` run can quietly produce an archive with **no** `.ktx2` variants. Always check the ZIP
contents rather than trusting the exit code:

```powershell
python -c "import zipfile; print([n for n in zipfile.ZipFile('ReleaseScenarios/Benchscene3_solarsystem.zip').namelist() if n.endswith('.ktx2')])"
```

## Scenario layout

```
Scenarios/<Name>/
├── scripts/            # TypeScript; exactly one class extends ScenarioBehaviour
│   ├── components/
│   └── helpers/
├── assets/             # copied verbatim into the archive
└── convert_to_ktx2.sh  # optional, enables --ktx2 for this scenario
```

`ReleaseScenarios/` and `Scenarios/*/dist/` are gitignored — build outputs are never committed.
`dist/` is also removed automatically after each successful package step, so seeing one lying
around means a build failed partway.

`*.ktx2` is gitignored too. `--ktx2` writes the encoded textures *next to the source images*
inside `Scenarios/<Name>/assets/`, not into a build folder, so without that rule they would look
like source. The tracked `.jpg`/`.png` remain the source of truth; re-encode with `--ktx2`.
Existing `.ktx2` are **never** re-encoded unless `FORCE=1` is set, so after changing a source
image use `FORCE=1` or the archive will ship the stale encode.

## Known gaps

- **Template manifest metadata**, as described above.
- **No tests.** The builder has no automated coverage; correctness is verified by inspecting the
  produced ZIPs.

## Open work

[`docs/TASK-rebuild-and-republish.md`](docs/TASK-rebuild-and-republish.md) — rebuild every
scenario and republish into virtual-lab, whose archives are stale imports from Google Drive.
