# ScenarioCreator

Centralized build pipeline for scenarios in `Scenarios/`.

## How it works

- Uses one shared dependency installation at repo root (`node_modules`).
- For each scenario folder with `scripts/`:
  - Compiles TypeScript into `<scenario>/dist/scripts`.
  - Detects `entryPoint` automatically by finding exactly one class that `extends ScenarioBehaviour`.
  - Generates `<scenario>/dist/manifest.json` from the scenario's optional `scenario.meta.json`
    (derived defaults when absent), plus the detected `entryPoint` and a stable guid per asset.
  - Copies `<scenario>/assets` if present.
  - Creates `<scenario>.zip` in `ReleaseScenarios/`.
  - Removes `<scenario>/dist` after ZIP creation.

## Build

```powershell
npm run build:list
npm run build -- --scenario Benchscene3_solarsystem
npm run build -- --scenario Benchscene2_complexmodel,Benchscene3_solarsystem
npm run build:all
```

### KTX2 (compressed textures)

Add `--ktx2` to also generate `.ktx2` variants next to the original textures
(via each scenario's `convert_to_ktx2.sh`, needs KTX-Software) and include both
in the ZIP. The engine benchmark harness then selects the compressed variant at
run time with `&ktx2=1`, so one archive covers both formats:

```powershell
npm run build -- --scenario Benchscene3_solarsystem --ktx2
```

Only scenarios with a `convert_to_ktx2.sh` (loose-texture scenes) are affected;
others build unchanged. Set `INCLUDE_SKYBOX=1` to also convert the skybox.

**A failed conversion does not fail the build** — it warns and packages the original textures,
so a `--ktx2` run can quietly produce an archive with no `.ktx2` in it. Add `--strict` to make
it stop instead:

```powershell
npm run build -- --scenario Benchscene3_solarsystem --ktx2 --strict
```

`LOD_SIZES=512,1024` additionally writes coarser levels into `<scenario>/lods/`. Those never
enter the ZIP — only the streaming manifest addresses them.

## Streaming manifest (optional, additive)

Besides the ZIP, the build can publish a `scenario.json` listing every script and asset
individually, with priorities and detail levels, so the engine can fetch them one at a time
instead of unpacking one archive. The ZIP path is unchanged by this. Build the ZIPs first — the
manifest is generated from them:

```powershell
npm run manifest:all -- --tests   # <name>.scenario.json + a shared, content-addressed objects/
npm run manifest:verify           # every referenced file exists and hashes as recorded
npm run manifest:verify-fetch     # the engine loads them over HTTP, LOD levels included
npm run manifest:verify-render    # headless browser: both load paths, compared
```

Serving `ReleaseScenarios/` with any static file server is enough to host them. Assets are
stored under their own hash and shared between scenarios, so textures used by more than one
scenario are stored once.

**The platform cannot consume manifests yet** — uploads through `/admin` are still ZIPs only.

## Notes

- Scenarios are **content only** — no embedded benchmarking or optimization toggles.
  Performance/memory measurement lives in the WebEngineTS engine harness
  (`benchmarks/run.ts` + `MemoryProfiler`/`Benchmark`), driven by URL params.
- If a scenario has zero or multiple classes extending `ScenarioBehaviour`, build fails to avoid ambiguous `entryPoint` values.
- You no longer need per-scenario `build-package.mjs`, `manifest.json`, `package.json`, or `tsconfig.json` for packaging.
- There is no test runner. Correctness is checked by inspecting the produced ZIPs and by the
  four `manifest:verify*` commands above.
- `ReleaseScenarios/`, `<scenario>/dist/`, `<scenario>/lods/` and `*.ktx2` are gitignored —
  all of them are regenerable from tracked sources.

