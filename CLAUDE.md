# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Shared context (all repos)

Loaded from a directory outside this repository, so every project's session sees the same
ecosystem map and the same live status. Edit those files rather than duplicating them here.

@../.claude-shared/ECOSYSTEM.md
@../.claude-shared/ENGINE-GAPS.md


# ScenarioCreator

Build pipeline that turns scenario **source** into distributable `.zip` archives. One shared
`node_modules` at the repo root serves every scenario — there are no per-scenario
`package.json`, `tsconfig.json` or build scripts.

**Two roots, kept apart on purpose:**

| Source | Output | For |
|---|---|---|
| `Scenarios/` | `ReleaseScenarios/` | Production — what students see in the catalog. |
| `TestScenarios/` | `ReleaseScenarios/test/` | Measurement and engine testing: benchmark scenes, feature demos. |

`--all` builds **production only**. Test scenarios are opt-in — `--all --tests`, or name them
explicitly — so a routine rebuild-and-publish cannot put a benchmark scene in front of a
student. `--tests` only widens `--all`: on its own it selects nothing and the builder stops. A
name may not exist in both roots; the builder refuses, because then "is this publishable?" would
have no answer.

User-facing usage lives in `README.md`. **This file is the working guide**: the rules that are
easy to break and the reasons behind them.

## Ecosystem position

This repo is the **content producer** of a four-repo ecosystem (all under
`C:\Users\HuGox\WebstormProjects\`):

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
5. **No asset format that needs a decoder the engine never wires up.** `ScenarioAssets` builds a
   bare `new GLTFLoader(manager)` and never calls `setDRACOLoader`, `setMeshoptDecoder` or
   `setKTX2Loader`. Three.js ships all three extensions and each throws without its decoder, so a
   Draco- or meshopt-compressed mesh, or KTX2 *inside* a GLB, fails at load. What is safe, and
   what the compressed assets here use: **`KHR_mesh_quantization`** (the GPU reads narrower
   types) and **`EXT_texture_webp`** (registered unconditionally; the browser decodes it).
   Loose `.ktx2` files are fine — that is the Basis transcoder path, not `KHR_texture_basisu`.

## How the build works

`build-package.mjs` (327 lines, run via `npm run build`). Per scenario:

1. **Discovery** — every directory under `Scenarios/` *or* `TestScenarios/` that contains a
   `scripts/` folder is a scenario, tagged production or test by which root it came from. A
   folder without `scripts/` is invisible to the builder.
2. **Compile** — `tsc` is invoked directly from `node_modules/typescript/lib/tsc.js` with flags
   on the command line and **`--ignoreConfig`**: the root `tsconfig.json` is deliberately *not*
   used for scenario compilation. Target ES2020, module ESNext, strict, no declarations, no
   source maps. Output: `<scenario>/dist/scripts`.
3. **Entry point detection** — the source is scanned with a regex for
   `class X extends ScenarioBehaviour`. **Exactly one match is required**; zero or several is a
   hard build failure rather than an ambiguous guess. The detected `.ts` path becomes the `.js`
   `entryPoint`, relative to `scripts/`.
4. **Manifest** — `<scenario>/dist/manifest.json` is generated (see below).
5. **KTX2** (only with `--ktx2`) — runs the scenario's `convert_to_ktx2.sh`, producing `.ktx2`
   next to the originals so **both** formats ship in one archive.
6. **Assets** — `<scenario>/assets` is copied verbatim if present.
7. **Package** — `tar.exe -a -c -f` zips the `dist` contents, then `dist/` is deleted.

### Manifest metadata comes from `scenario.meta.json`

Every archive used to report `id: template.<name>` and version `0.0.1-template`. That is fixed:
metadata is read from an optional `<scenario>/scenario.meta.json`, and the fallback when it is
absent is **derived** — id is the slugified folder name, name is the folder name, version is
`1.0.0`. Fields nobody has stated (`description`, `author`) are **omitted rather than invented**,
because a wrong author in a catalogue is worse than a missing one.

`engineVersion` is stamped from the installed engine, so it answers "which engine was this built
against" — the first thing to check when a scenario compiles here but fails in the platform.

`solar-system-scenario` declares `id: "solar-system"` to match the platform's catalogue slug. Do
not "fix" a mismatch by making the platform enforce equality; state the right id here.

**Identity is shared with the manifest emitter through `scenario-meta.mjs`, deliberately.** Two
things must agree across the ZIP and the streaming manifest or the artifacts describe different
content: the scenario **id**, and each asset's **guid**. A scene serialized while running from a
ZIP has to keep resolving when the same scenario is later served from a manifest. Guids are
`sha256(id + NUL + path)` — never content — so re-encoding a texture does not move one, and a
rebuild produces byte-identical output. Renaming an asset *does* change its guid; that is the
honest limit of deriving identity from a path.

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
npm run build -- --scenario Benchscene3_solarsystem --ktx2 --strict
```

A second, additive artifact — the streaming manifest. The ZIP path is unchanged by it, and the
platform cannot consume it yet; it exists so the engine's streaming can be run against real
content. Build the ZIPs first, since it reads them:

```powershell
npm run manifest:all -- --tests     # <name>.scenario.json + a shared objects/ store
npm run manifest:verify             # every referenced file exists and hashes as recorded
npm run manifest:verify-fetch       # the engine loads them over HTTP, LOD levels included
npm run manifest:verify-render      # headless browser, both load paths, compared
```

Serving `ReleaseScenarios/` with any static file server is a complete origin — no `baseUrl` is
written, so the manifest's own location is the base.

**CI** (`.github/workflows/ci.yml`, `windows-latest`) runs `npm ci`, `build:list`, the builds
(`--all`, then `--all --tests`, never `--ktx2`), `manifest:all -- --tests` and the three verifiers
on every push and PR, and uploads `ReleaseScenarios/` as an artifact. Keep npm caching out of it:
no `cache: npm`, and keep `package-manager-cache: false`, since setup-node turns the cache on by
itself once `package.json` names npm in `packageManager`. A warm cache installs the engine by the
lockfile's integrity instead of reading the `.tgz`, so a tarball swapped without a lockfile update
would build against the previous engine and pass.

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

**`--ktx2` failing does not fail the build — unless you pass `--strict`.** By default
`runKtx2Conversion` catches the error, prints `[ktx2] conversion failed — packaging existing
textures only`, and packages the originals, so a `--ktx2` run can quietly produce an archive with
**no** `.ktx2` variants. That is right for a routine build and wrong for a release: add
`--strict` and the build stops with exit 1 instead. Either way, check the ZIP contents rather
than trusting the exit code:

```powershell
python -c "import zipfile; print([n for n in zipfile.ZipFile('ReleaseScenarios/Benchscene3_solarsystem.zip').namelist() if n.endswith('.ktx2')])"
```

## Scenario layout

```
Scenarios/<Name>/
├── scripts/             # TypeScript; exactly one class extends ScenarioBehaviour
│   ├── components/
│   └── helpers/
├── assets/              # copied verbatim into the archive
├── scenario.meta.json   # optional: id, name, version, category, streaming priorities
├── lods/                # optional: coarser levels — NEVER copied into the ZIP
└── convert_to_ktx2.sh   # optional, enables --ktx2 for this scenario
```

**`lods/` sits outside `assets/` on purpose.** `assets/` is copied verbatim, so a variant placed
there would enter the ZIP and make it bigger while making nothing faster — the client would have
to take every level to use one. Only the manifest can address levels individually, which is why
the ladder is worth generating at all. `lods/` is gitignored, like `dist/` and `*.ktx2`.

`ReleaseScenarios/` and `Scenarios/*/dist/` are gitignored — build outputs are never committed.
`dist/` is also removed automatically after each successful package step, so seeing one lying
around means a build failed partway.

`*.ktx2` is gitignored too. `--ktx2` writes the encoded textures *next to the source images*
inside `Scenarios/<Name>/assets/`, not into a build folder, so without that rule they would look
like source. The tracked `.jpg`/`.png` remain the source of truth; re-encode with `--ktx2`.
Existing `.ktx2` are **never** re-encoded unless `FORCE=1` is set, so after changing a source
image use `FORCE=1` or the archive will ship the stale encode.

## Known gaps

- **No unit tests.** There is no test runner. What exists instead is four verification layers,
  all runnable and all used to check the work in `../.claude-shared/PLAN.md`:
  `npm run manifest:verify` (every file a manifest references exists and still hashes to what
  was recorded), `manifest:verify-fetch` (the engine's own `StreamingAssetSource` can load every
  manifest over HTTP, including selecting individual LOD levels), `manifest:verify-render`
  (headless Edge loads every scenario from **both** the ZIP and the manifest and compares id,
  entry point and scene-graph size), and virtual-lab's `archive-validation.js` run directly.
  ZIP contents are still worth inspecting by hand — that is what caught the `--ktx2` silent
  failure.
- **Peak texture VRAM against a budget is unmeasured.** The only GPU available here is
  swiftshader, where the number would mean nothing. Needs the engine's harness on real hardware.
- **`Benchscene3` still ships both `.jpg` and `.ktx2`.** With a manifest that A/B is two levels,
  so the dual-format archive can retire — but not before the platform reads manifests.

## Open work

[`../.claude-shared/PLAN.md`](../.claude-shared/PLAN.md) is the tracker: P0 (compress content), P1 (emit a manifest),
P2 (real metadata) and P4 (housekeeping) are done; P3 (LOD variants) is built for textures and
meshes, with only its VRAM criterion outstanding. Every remaining item needs something outside
this repository — a real GPU, or a platform that reads manifests.

[`docs/TASK-rebuild-and-republish.md`](docs/TASK-rebuild-and-republish.md) — republish into
virtual-lab, whose archives are stale imports from Google Drive and are now stale again against
these builds. The upload itself is a manual `/admin` step.

[`docs/TASK-benchmark-archives.md`](docs/TASK-benchmark-archives.md) — the `TestScenarios/`
archives, against the tracker in `WebEngineTS-Benchmarks/tasks/scenariocreator.md`. Three of that
suite's optimization flags had nothing to act on and the cause was here: Benchscene2's textures
were embedded in its GLB, and Benchscene1's object count was welded into one archive. Both fixed,
with the measurements recorded. The rebuilt ZIPs have deliberately **not** been copied into the
benchmark repo — those are inputs to a measurement run in flight.

[`docs/TASK-catalogue-expansion.md`](docs/TASK-catalogue-expansion.md) — content, not pipeline:
eight more production scenarios, taking `Scenarios/` from two to ten. All eight are procedural
and ship without a single asset, which is what keeps them clear of rule 5 and of the LOD work
still in flight. That file holds the constraints they share; one document per scenario holds the
rest.
