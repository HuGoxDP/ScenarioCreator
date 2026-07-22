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
npm run build -- --scenario Benchscene1_primitives
npm run build -- --scenario Benchscene1_primitives,Benchscene2_complexmodel
npm run build:all
```

## Notes

- If a scenario has zero or multiple classes extending `ScenarioBehaviour`, build fails to avoid ambiguous `entryPoint` values.
- You no longer need per-scenario `build-package.mjs`, `manifest.json`, `package.json`, or `tsconfig.json` for packaging.

