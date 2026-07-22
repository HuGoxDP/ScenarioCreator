# ScenarioCreator

Centralized build pipeline for scenarios in `Scenarios/`.

## How it works

- Uses one shared dependency installation at repo root (`node_modules`).
- For each scenario folder with `scripts/`:
  - Compiles TypeScript into `<scenario>/dist/scripts`.
  - Detects `entryPoint` automatically by finding exactly one class that `extends ScenarioBehaviour`.
  - Generates `<scenario>/dist/manifest.json` with template metadata values and the detected `entryPoint`.
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

## Notes

- Scenarios are **content only** — no embedded benchmarking or optimization toggles.
  Performance/memory measurement lives in the WebEngineTS engine harness
  (`benchmarks/run.ts` + `MemoryProfiler`/`Benchmark`), driven by URL params.
- If a scenario has zero or multiple classes extending `ScenarioBehaviour`, build fails to avoid ambiguous `entryPoint` values.
- You no longer need per-scenario `build-package.mjs`, `manifest.json`, `package.json`, or `tsconfig.json` for packaging.

