# ScenarioCreator — plan

Drafted 2026-08-11, against branch `rebuild/scenarios-republish` (`e8f0777`).

Companion to the engine's [`design/handoff-boundary.md`](../../WebEngineTS/design/handoff-boundary.md),
which paused engine feature work and named **this repo as the first thing to do next**.

**Verified while writing this** — `build-package.mjs` (the manifest block at ~line 298, the
`--ktx2` path at ~line 250), `docs/TASK-rebuild-and-republish.md`, and the sizes of the archives
currently in `ReleaseScenarios/`. Anything I did not read is marked as an assumption.

---

## Why this repo is first

The engine now consumes a **manifest** — `scenario.json` listing individually-fetchable scripts
and assets with priorities and detail levels — and can act on all of it: progressive first
paint, a priority queue, a VRAM budget, per-asset LOD selection, in-place reload. None of that
has ever been run against real content, because nothing publishes a scenario in that form.

**Emitting `scenario.json` is the single change that makes everything already built
measurable.** It also unblocks the platform's Phase 6 and the paper's loading-latency numbers.

## The problem, in this repo's own numbers

| Archive | Size |
|---|---|
| `ReleaseScenarios/Molecules.zip` | 22 KB |
| `ReleaseScenarios/solar-system-scenario.zip` | 18.3 MB |
| `ReleaseScenarios/test/Benchscene1_primitives.zip` | 2.3 KB |
| `ReleaseScenarios/test/Benchscene2_complexmodel.zip` | 29.4 MB |
| `ReleaseScenarios/test/Benchscene3_solarsystem.zip` | 10.5 MB |

Two things follow.

**`Benchscene3` already demonstrates the LOD problem.** `--ktx2` writes both `.jpg` and `.ktx2`
into one archive — 6.6 MB became 10.5 MB — and every client downloads both formats to use one.
That trade was deliberate: it let the harness A/B compressed against uncompressed textures from
a single ZIP via `Resources.preferExtension`. But it is exactly what LOD variants would do,
three or four times over, for the same reason: **an archive has no addressability inside it, so
the client takes everything and picks afterwards.**

**A 29 MB archive must fully arrive and decompress before the first frame.** Nothing can be
deferred, because there is nothing to defer *to*.

Neither is a ZIP defect. A ZIP is fine as a container; it is being used as the unit of
*delivery*, and that is what has to change. Keep the ZIP path for small scenarios —
`Molecules` at 22 KB would be made worse by a manifest, not better.

---

## P1 — Emit `scenario.json` beside the ZIP (~2–3 days)

Produce both artifacts from one build. The ZIP keeps working exactly as today; the manifest is
additive.

### The shape the engine actually reads

Validated by `parseStreamingManifest` in the engine
(`src/engine/core/assets/StreamingManifest.ts`). Two mistakes it rejects at parse time, both
easy to make:

- An asset is addressed by **`path`**, with an optional `guid` — **not** by
  `"id": "earth_albedo"`, which is what `virtual-lab/docs/scenario-delivery-migration.md` §3.1
  sketches. That sketch predates the implementation.
- **`scripts` + `entry` are what make a manifest runnable.** A manifest listing only assets is
  still valid — it is a perfectly good asset source for `Resources.useSource` — but
  `toScenarioManifest` refuses it with a message saying so, because there is nothing to start.

```jsonc
{
  "schema": 1,
  "id": "solar-system-scenario",
  "name": "Сонячна Система",
  "version": 3,
  "baseUrl": "https://…/a/",        // optional; the manifest's own location is the default
  "entry": "scripts/Scenario.js",
  "scripts": [
    { "path": "scripts/Scenario.js", "url": "9f3c…c1.js", "hash": "sha256-9f3c…" }
  ],
  "assets": [
    {
      "path": "textures/earth.ktx2",   // what Resources.load addresses it by
      "guid": "…",                     // optional but wanted — see P2
      "priority": "critical",          // critical | high | low | lazy
      "lods": [                        // ascending; one entry is fine
        { "level": 0, "url": "1a…512.ktx2",  "bytes": 180000 },
        { "level": 1, "url": "2b…2048.ktx2", "bytes": 720000 }
      ]
    }
  ]
}
```

### Steps

1. **Content-address every file.** `sha256` of the bytes → `<hash>.<ext>`. This is what makes
   assets immutable, cacheable forever, and deduplicated across scenarios — `solar-system` and
   `Benchscene3` almost certainly share planet textures today and store them twice.
2. **Write the manifest** next to the ZIP: `ReleaseScenarios/<name>.scenario.json` plus a
   directory of hashed objects. Assume for now that the platform will host them; the layout is
   its decision, and `baseUrl` exists so the manifest need not know.
3. **Mark priorities.** This is the part with judgement in it, and the part that decides whether
   Stage 1 measures anything: **a manifest that marks everything `critical` measures nothing.**
   A first cut that is defensible: scripts and the skybox `critical`; whatever the first frame
   shows `high`; everything else `low`; anything reachable only through interaction `lazy`.
4. **Keep the ZIP.** Same build, both outputs. The engine supports both paths and the platform
   will need the ZIP until its streaming client exists.

**Done when:** `Application.loadScenarioFromManifest(url)` renders a scenario identically to
`loadScenarioFromBuffer` on its ZIP, and `Scenario.timeToFirstFrame` differs measurably between
the two.

**Open question for you:** where the hashed objects live. Options are a directory beside
`ReleaseScenarios/` that the platform uploads wholesale, or publishing straight into the
platform through an API that does not exist yet. The first is less work and blocks nothing.

## P2 — Real manifest metadata (~0.5 day)

`build-package.mjs` hard-codes placeholders (verified at lines ~298–314):

```js
id: `template.${scenarioName.toLowerCase()…}`,
name: `Template ${scenarioName}`,
version: "0.0.1-template",
author: { name: "Template Author", … },
engineVersion: "0.0.0-template",
```

Every published archive therefore reports itself as a template, and the platform's admin screen
shows `0.0.1-template` where a version belongs. This is **R7** in the platform's roadmap; the
fix is here.

- Read a per-scenario `scenario.meta.json` (id, name, version, description, category, author),
  falling back to the current template only when absent, so nothing breaks on a scenario that
  has not been given one yet.
- Stamp `engineVersion` from the installed engine — `node_modules/WebEngineTS/package.json`
  now carries a unique `0.1.0-local.<timestamp>` per release, so this becomes a real answer to
  "which engine was this built against".
- Emit stable `guid`s per asset and keep them across rebuilds, so a serialized scene keeps
  resolving its assets. **Do not mint them per build** — the engine deliberately drops assets
  without a `guid` rather than inventing one, because an id that does not survive a reload is
  worse than none.

**Done when:** no archive reports `template.*` or `0.0.1-template`, and rebuilding a scenario
twice produces the same guids.

## P3 — LOD variants (~2–3 days, after P1)

Only worth doing once the manifest exists — variants inside a ZIP make it bigger and nothing
faster.

- Generalise `convert_to_ktx2.sh` (currently one pass, invoked per scenario at
  `build-package.mjs` ~line 250) into a ladder: emit 512 / 1024 / 2048 for each source texture,
  record them as ascending `lods[]`.
- Mesh decimation is a separate, larger job. Textures first — they are where the VRAM is.
- Once variants exist, **retire the dual-format archive**. `--ktx2` shipping both `.jpg` and
  `.ktx2` in one ZIP was a workaround for having no per-asset addressing; with a manifest the
  same A/B is two levels the harness selects between, and `Benchscene3` stops carrying 4 MB it
  does not use.

**Done when:** a texture-heavy scenario publishes three levels per texture, and the engine's
`TextureStreaming` measurably lowers peak texture VRAM against a budget.

## P4 — Housekeeping, any time

- The `--ktx2` conversion silently degrades to "packaging existing textures only" if the shell
  script fails (verified at ~line 266). That is right for a routine build and wrong for a
  release; consider a `--strict` that fails instead.
- **[ASSUMPTION, not verified]** the ZIP is written with `tar -a -c -f`, which will deflate.
  Deflate over `.ktx2` / `.jpg` / `.glb` buys almost nothing and costs decompression time on
  every load. Worth measuring whether storing them uncompressed loads faster.

---

## Order

```
P1 ──► P3          manifest first; variants are meaningless without it
P2                 independent, cheap, and it unblocks the platform's R7
P4                 whenever
```

P1 is the one that unblocks other repositories. Everything the engine built this month is
waiting on it.
