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
| `ReleaseScenarios/test/Benchscene2_complexmodel.zip` | 29.4 MB → **9.7 MB** after P0 |
| `ReleaseScenarios/test/Benchscene3_solarsystem.zip` | 10.5 MB → 10.4 MB after P0 |

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

## Measured — what is actually inside the archives

Read before optimising anything, because the intuitive answer is wrong for the biggest file.
Entry sizes from the archives as they stood on 2026-08-11, **before P0**; conclusion 2 below
turned out to be half wrong, see P0 for what was actually inside that GLB.

| Entry | Raw | Stored | Ratio |
|---|---|---|---|
| `Benchscene2` — `assets/models/complex_model.glb` | 38.58 MB | 27.99 MB | **73%** |
| `Benchscene3` — `assets/textures/moon.jpg`, `mercury.jpg`, `sun.jpg`, `mars.jpg` | ~0.8–1 MB each | unchanged | **100%** |
| `Benchscene3` — `assets/textures/earth_normal.ktx2` | 2.67 MB | 0.40 MB | **15%** |

Three conclusions:

1. **"Deflate over already-compressed assets is wasted" is only true for the JPEGs.** The GLB
   deflates by 27% — 10.6 MB — because it carries raw vertex buffers. An earlier draft of this
   document asserted the opposite from assumption; it was wrong, and storing entries
   uncompressed wholesale would make `Benchscene2` 10 MB *larger*.
2. **The real problem in `Benchscene2` is the content, not the container.** 38.58 MB of raw
   geometry is what makes that scenario slow, and no container change addresses it. Compressing
   the mesh does — see P0.
3. **`earth_normal.ktx2` looks mis-configured.** A properly supercompressed KTX2 (UASTC or
   ETC1S plus zstd) is close to incompressible; this one deflates to 15%, and at 2.67 MB it is
   *larger* than the JPEG it replaces. KTX2's win is VRAM rather than file size, so being bigger
   on disk is not automatically wrong — but a 15% deflate ratio says the payload is not
   supercompressed at all. Worth checking what `convert_to_ktx2.sh` passes to `toktx`.

### Why not 7z (decided 2026-08-11)

LZMA would genuinely beat deflate on that GLB — plausibly another 4–5 MB. It is still the wrong
move:

- **Browsers cannot read it.** It needs a WASM decoder either bundled into the engine or served
  by every host. This project already has that scar: the Basis transcoder returns 404 **silently**
  until some scenario happens to ship a `.ktx2`.
- **LZMA decompresses several times slower than deflate.** The complaint is *total load time*,
  so this trades download seconds for CPU seconds on a student laptop.
- **Solid archives make random access worse**, which is the opposite direction from per-asset
  addressing. A ZIP's central directory and independent entries are what make range reads
  possible at all; 7z takes that away.
- New tooling on both ends — the platform validates with `node-stream-zip`, the build writes
  with `tar -a`.

The same reasoning rejects tar-based and custom formats. **The container is not the problem.**

## P0 — Compress the content — ✅ done 2026-08-12

Result: `complex_model.glb` **40 453 656 → 12 518 232 bytes (−69%)**, and
`Benchscene2_complexmodel.zip` **29 352 066 → 9 710 408 bytes (−67%)**. Reproduced by
[`TestScenarios/Benchscene2_complexmodel/compress_model.sh`](../TestScenarios/Benchscene2_complexmodel/compress_model.sh),
which carries the full rationale. Archive re-validated through the platform's own
`archive-validation.js`: PASS, no warnings.

**Two things in the section below were wrong, and both changed what got built.**

**1. It is not 38.58 MB of geometry.** `gltf-transform inspect` says ~17 MB of it is three
2048×2048 **PNG textures embedded in the GLB** (baseColor 9.21, normal 7.19,
metallicRoughness 0.59). Geometry was the other ~23 MB. So "compress the mesh" addressed
barely half the file, and the textures were the cheaper, larger win.

**2. Draco and meshopt would both have broken the scene.** The engine builds a bare
`new GLTFLoader(manager)` (`WebEngineTS/src/engine/core/scenario/ScenarioAssets.ts:104`) and
never calls `setDRACOLoader`, `setMeshoptDecoder` or `setKTX2Loader` — verified by grep across
the whole engine source. Three.js ships all three extensions and each throws without its
decoder wired up. This is the Basis-transcoder scar again, and this document walked into it
while arguing against 7z for exactly that reason.

What the engine *can* read with no decoder, and what was used instead:

| | why it is safe |
|---|---|
| `KHR_mesh_quantization` | explicit `case` in GLTFLoader → `GLTFMeshQuantizationExtension`; the GPU just reads narrower types |
| `EXT_texture_webp` | registered unconditionally in the GLTFLoader constructor, delegates to the normal texture path — **the browser decodes it** |

Pipeline: `prune` (drops a dead `TEXCOORD_3`) → `dedup` → `quantize` → PNG-to-WebP.
`weld` was measured and dropped: byte-identical output after `quantize`. Geometry is
unchanged where it counts — vertex counts (65 532 / 65 532 / 65 532 / 56 305),
`renderVertexCount` 1 310 430 and the bounding box all match the original, and indices fell
`u32 → u16` on their own. `dedup` alone accounted for 4 MB, because the three UV sets are
bit-identical duplicates.

Texture fidelity, measured as PSNR / max channel error against the source PNGs:
baseColor **41.6 dB / 14**, metallicRoughness **50.7 dB / 12**, normal **38.1 dB / 26**.
The normal map is deliberately the weakest: lossy WebP is always YUV 4:2:0, so its error
plateaus near 38 dB regardless of quality (q92/q96/q99 → 38.10/38.55/38.80 dB). Lossless
would make it exact for **+3.57 MB — a 29% larger file** — and this material sets
`KHR_materials_specular` `specularFactor = 0`, so the normal map shades diffuse light only,
where a mean error of 2/255 does not show.

**Still open:** nothing has rendered this in a browser. The extension analysis above is read
from the engine bundle, not observed. Load `Benchscene2` once before republishing.

### KTX2 supercompression — ✅ diagnosed and fixed, but it barely helps the ZIP

The suspicion in §"Measured" was right about the cause and wrong about the payoff.

Reading `supercompressionScheme` straight out of the KTX2 headers: every ETC1S texture had
**BasisLZ**, and `earth_normal.ktx2` — the one UASTC file — had **none**. ETC1S carries its
compression inside the payload; UASTC is raw blocks until zstd is applied, and
`convert_to_ktx2.sh` never passed `--zstd`. Fixed in both encoder branches (`--zstd` for
`ktx create`, `--zcmp` for `toktx`, level via `ZSTD_LEVEL`, default 18).

`earth_normal.ktx2`: **2 796 752 → 373 479 bytes (−87%)** at rest, scheme now Zstandard, and
the `.ktx2` entries now deflate to **99%** — the incompressibility this document predicted.

**But `Benchscene3_solarsystem.zip` only went 10 476 770 → 10 434 788 (−42 KB, 0.4%).** The
ZIP's deflate had already been recovering almost all of it: that entry was stored at ~400 KB
before and 373 KB now. **The 7× win is real only outside the ZIP** — on the P1 manifest path,
where assets are fetched individually, it is 2.67 MB versus 0.37 MB over the wire. As a
container change it is worth ~nothing, which is the same lesson as §"Why not 7z".

## P0 — original plan (~1 day, do this first)

Independent of everything else, helps both the ZIP and the manifest path, and it is the fastest
answer to "large scenarios load slowly".

- Run `complex_model.glb` through `gltf-transform` with Draco or meshopt. Raw vertex data
  typically shrinks several times over, and both decode fast — unlike LZMA, this reduces bytes
  *and* keeps decode cheap. Measure rather than trust the ratio; the point is that 38.58 MB of
  raw geometry is the single largest thing in the whole catalogue.
- While there: check the KTX2 supercompression question from §"Measured".

**Done when:** `Benchscene2_complexmodel.zip` is materially smaller and the scene renders
unchanged.

This is deliberately ahead of the manifest work. It is cheaper, it needs no other repository,
and a manifest that streams needlessly-large assets is still streaming needlessly-large assets.

## P1 — Emit `scenario.json` beside the ZIP — ✅ done 2026-08-12

Shipped as [`build-manifest.mjs`](../build-manifest.mjs) — `npm run manifest -- --scenario X`,
`npm run manifest:all`, `npm run manifest:verify`. Emits
`ReleaseScenarios/<name>.scenario.json` plus a **shared** content-addressed store at
`ReleaseScenarios/objects/<ab>/<sha256><ext>`. No `baseUrl` is written, so the manifest's own
location is the base and serving `ReleaseScenarios/` as static files is a complete host — the
cheapest form this document asked for, with no platform code at all.

**Deviation, on purpose:** it reads the **built ZIP** rather than emitting from inside
`build-package.mjs`. The ZIP already holds exactly what a manifest describes — compiled
`scripts/*.js`, `assets/**` as shipped, and the `entryPoint` — so there is no second copy of
discovery, compile or entry-point detection to drift. It is also the only way to land this
without colliding with the uncommitted edits that currently span every region of
`build-package.mjs`. Folding it into a single pass is one call, whenever that is wanted.

**Cross-scenario dedup is real and measured.** Across all five scenarios: 47 objects stored
(42.25 MB), **16 shared, 7.10 MB not stored twice** — `solar-system-scenario` and
`Benchscene3_solarsystem` do carry the same planet textures, exactly as predicted above.

**Verified against the engine's own code, not a reimplementation of its rules.** The installed
`WebEngineTS` exports `parseStreamingManifest` and `toScenarioManifest`, so every manifest is
parsed back through them before it is written, and `--verify` re-reads all of them and confirms
each URL resolves to bytes that still hash to what was recorded: **63 referenced files, 0
problems**. Rebuilding produces a **byte-identical** manifest, so the guids survive a rebuild —
which is half of P2's done-criterion, met here because a guid is derived from
`sha256(id + path)` and never from content. Renaming an asset still changes its guid; that is
the honest limit of deriving identity from a path.

**Priorities: a built-in ladder plus an override, because the ladder is a guess.** The default
keys on file type — `skybox/**` critical, `**/*.glb` high, everything else low — and a scenario
overrides it in `scenario.meta.json`. That file is also where P2 should read real id / name /
version from, which is why identity lives there rather than in a streaming-only side file.
The ladder degenerates on a scene made only of textures: `Benchscene3` came out as
2 critical / 22 low, one undifferentiated block that measures nothing, which is why it is the
one scenario given a meta file (now 2 critical / 4 high / 18 low, reasoned in the file itself).

**The delivery path is proven; only rendering is not.** `--verify-fetch` serves
`ReleaseScenarios/` from a throwaway static server and pulls every manifest through the
engine's own `StreamingAssetSource.fromUrl` — fetching the manifest, resolving each url
against its location, sorting by priority and returning bytes. All five load:

| manifest | scripts | assets | fetched |
|---|---|---|---|
| `Molecules` | 8 | 0 | 66.8 KB / 8 requests |
| `solar-system-scenario` | 5 | 18 (1 critical, 6 high, 11 low) | 26.57 MB / 23 requests |
| `Benchscene1_primitives` | 1 | 0 | 4.2 KB / 1 request |
| `Benchscene2_complexmodel` | 1 | 1 (1 high) | 11.94 MB / 2 requests |
| `Benchscene3_solarsystem` | 5 | 24 (2 critical, 4 high, 18 low) | 10.77 MB / 29 requests |

A plain static server being enough *is* the deployment story: `ReleaseScenarios/` behind any
file server is a working origin, and no platform code was needed to prove it.

**And it renders.** [`verify-render.mjs`](../verify-render.mjs) — `npm run
manifest:verify-render` — serves `ReleaseScenarios/`, launches headless Edge with swiftshader,
and loads every scenario **both ways in one session**: `loadScenarioFromManifest(url)` and
`loadScenarioFromBuffer(zip)`. All five render from both paths and agree on scenario id, entry
point and scene-graph size:

| scenario | objects (manifest / zip) | agree |
|---|---|---|
| `Molecules` | 39 / 39 | ✅ |
| `solar-system-scenario` | 75 / 75 | ✅ |
| `Benchscene1_primitives` | 1004 / 1004 | ✅ |
| `Benchscene2_complexmodel` | 14 / 14 | ✅ |
| `Benchscene3_solarsystem` | 21 / 21 | ✅ |

`timeToFirstFrame` is `-1` until a frame actually reaches the screen, so a run that reports a
number has demonstrably rendered. Scene size is checked alongside it because an *empty* scene
renders perfectly happily, and a manifest that silently delivered nothing would otherwise pass.

**This also closes P0's open question.** `Benchscene2` — quantized geometry plus WebP textures —
renders identically to its ZIP in a real browser, so `KHR_mesh_quantization` and
`EXT_texture_webp` do work without a decoder. That had been read out of the engine bundle
rather than observed.

The harness needs the same import map virtual-lab's `frontend/src/index.html` carries
(`WebEngineTS` → the standalone bundle): scenario modules are compiled with a bare specifier
and loaded as blob URLs. Without it *both* paths fail identically at the entry-point import —
a faithful reproduction of the platform, and a useful reminder that the ZIP path depends on it
just as much.

**No timing conclusions come out of this, by design.** Measured: `solar-system` run alone gave
manifest 41.8 s / zip 48.7 s, while the same scenario inside a five-scenario run gave 33.5 s /
2.4 s — whichever path runs second inherits the first one's compiled shaders, and software
rasterisation dominates everything. An earlier reading of that 33.5 vs 2.4 as "the manifest
path is 14× slower" was wrong, and re-running is what caught it. Loading-time numbers belong to
the engine's harness on a real GPU, driven by URL flags.

### Original plan

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

## P2 — Real manifest metadata — ✅ done 2026-08-12

**No archive reports `template.*` any more**, and the platform validator passes all five with
**zero warnings**.

| archive | id | version | engineVersion | asset guids |
|---|---|---|---|---|
| `Molecules` | `molecules` | 1.0.0 | `0.1.0-local.1786479071411` | 0 |
| `solar-system-scenario` | **`solar-system`** | 3.5.0 | ″ | 18 |
| `Benchscene1_primitives` | `benchscene1-primitives` | 1.0.0 | ″ | 0 |
| `Benchscene2_complexmodel` | `benchscene2-complexmodel` | 1.0.0 | ″ | 1 |
| `Benchscene3_solarsystem` | `benchscene3-solarsystem` | 1.0.0 | ″ | 24 |

Metadata comes from an optional `<scenario>/scenario.meta.json` — the same file P1 already
reads, which is why identity was put there rather than in a streaming-only side file. Two
choices worth stating:

- **The fallback is derived, not fictional.** No meta file means id = slugified folder name,
  name = folder name, version = `1.0.0`. Fields nobody has stated — `description`, `author` —
  are **omitted** rather than filled with a plausible invention, because a wrong author in a
  catalogue is worse than a missing one. That is why three scenarios above have no meta file
  and still report cleanly.
- **`solar-system-scenario` declares `id: "solar-system"`**, the slug it already has in the
  platform's catalogue. `CLAUDE.md` is explicit that this mismatch is to be fixed here rather
  than by making the platform tolerate it, so it is fixed here.

**Identity is shared, not duplicated.** [`scenario-meta.mjs`](../scenario-meta.mjs) is imported
by both builders, because two things must agree across the ZIP and the manifest or the two
artifacts describe different content: the scenario **id**, and the asset **guid** — a scene
serialized while running from a ZIP has to keep resolving when the same scenario is later
served from a manifest. Verified rather than assumed: **all 43 guids are identical between the
two artifacts, and identical again after a rebuild.** They are derived from
`sha256(id + "\0" + path)` and never from content, so re-encoding a texture does not move one.

**One ordering fix came with it.** The ZIP manifest is now written *after* the assets are
staged rather than before. `--ktx2` generates textures during that step, so an asset list built
earlier omitted exactly the files that run existed to produce.

**Left open:** `CLAUDE.md`'s "Manifest metadata is currently a placeholder" section now
describes something that is no longer true, and its line numbers for `build-package.mjs` were
already stale. Not edited here — it has uncommitted changes.

### Original plan

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

## P3 — LOD variants — ⚠️ textures done 2026-08-12, VRAM claim unmeasured

`convert_to_ktx2.sh` now takes `LOD_SIZES=512,1024` and emits a ladder;
`build-manifest.mjs` picks it up and writes ascending `lods[]`. `Benchscene3` publishes
**three levels for each of its 12 KTX2 textures** — for `earth.ktx2`, 30 121 → 79 495 →
224 059 bytes.

**The variants live in `<scenario>/lods/`, outside `assets/`.** `build-package.mjs` copies
`assets/` verbatim, so anything put there would land in the ZIP and make it bigger while making
nothing faster — the client would take every level to use one. That is the same defect as the
dual-format archive, and the reason the ladder was worth generating only after a manifest
existed to address it. `Benchscene3_solarsystem.zip` is unchanged at 10.4 MB with the whole
ladder in place; the 1.4 MB of coarser levels reaches clients only through the manifest.

Levels are same-extension only. A `.ktx2` asset with a `.jpg` rung would be addressed by a path
whose extension stops describing the bytes behind some of its levels. The full-size encode is
never copied into `lods/` — it is already in the archive and is simply listed as the top rung.

**Verified that the rungs are selectable, not merely well-formed.** `--verify-fetch` now asks
the engine for level 0 and the top level of every laddered asset via `setLodLevel` and checks
the bytes that come back are exactly what the manifest promised for that level. A ladder that
always returned the same file would validate perfectly and stream nothing. 12 ladders, both
ends each, all matching. Rendering is unaffected — both load paths still agree.

**Not done, and the done-criterion below is only half met:**

- **Peak texture VRAM against a budget has not been measured.** The criterion asks that
  `TextureStreaming` measurably lower it; the only GPU available here is swiftshader, where the
  number would mean nothing. This is now the *single* thing standing between P3 and done, and
  it cannot be closed in this repository.
- **The dual-format archive has not been retired.** `Benchscene3` still ships `.jpg` *and*
  `.ktx2` in the ZIP. Removing it is now *possible* — the A/B it exists for is expressible as
  two manifest levels — but it changes what the ZIP contains, and the ZIP is still the only
  thing the platform can consume. Worth doing deliberately, after the platform reads manifests.
### Mesh decimation — done 2026-08-12

`LOD_RATIOS=25,50 ./compress_model.sh` emits coarser meshes into
`<scenario>/lods/models/`, and the same `findLadder` picks them up — the naming convention
(`<stem>.<n>.<ext>`, ascending) turned out to generalise from texture sizes to mesh percentages
without changing the manifest code. `Benchscene2` now publishes three levels:

| level | triangles | bytes |
|---|---|---|
| 0 | 109 195 | 5 826 336 |
| 1 | 218 402 | 8 111 952 |
| 2 (the archive's own) | 436 810 | 12 518 232 |

`extensionsRequired` stays `EXT_texture_webp` + `KHR_mesh_quantization` at every level, so a
coarse mesh needs no decoder the full one did not — the constraint from P0 still holds.
`Benchscene2_complexmodel.zip` is unchanged at 9 710 408 bytes.

Two things that are not obvious and cost time:

- **`weld` before `simplify` is not optional.** Without it the simplifier stops far short of the
  target: this model is a Sketchfab export split into four 65 532-vertex chunks, and split
  vertices pin the topology. The default `--error` also stops it early, so it needs `0.05` to
  actually reach the ratio. Both failure modes are silent — you get a "simplified" mesh that is
  nearly full size.
- **`weld` undoes `dedup`.** It re-splits the shared UV accessors and inflates the file to
  14.54 MB, so `dedup` and `quantize` have to run again afterwards. The pipeline is
  weld → simplify → dedup → quantize.

**Textures are carried over untouched**, so a coarse mesh still ships the full 2.81 MB of WebP.
Combining a coarse mesh with a coarse texture set is a further step, and a bigger one, because
it means a level is no longer one file.

### Original plan

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

## P4 — Housekeeping — ✅ done 2026-08-12

**`--strict` exists.** `node build-package.mjs --scenario X --ktx2 --strict` turns a failed
`convert_to_ktx2.sh` into a build failure instead of a warning. Verified both ways against a
script made to exit non-zero: without the flag it warns, packages, and exits 0; with it the
build stops and exits 1. The default stays permissive because that is right for a routine
build — but `--ktx2` returning success while producing no `.ktx2` at all is exactly how an
archive with a stale or missing encode reaches a student, and the exit code gives no hint.

**Storing already-compressed entries uncompressed: measured, and decided against.** Across all
five archives as they now stand:

| archive | raw | stored | deflate saves | in entries deflate cannot help |
|---|---|---|---|---|
| `Molecules` | 68 996 | 20 045 | 48 951 | 0 |
| `solar-system-scenario` | 27 859 372 | 18 251 778 | **9 607 594** | 4 228 070 |
| `Benchscene1_primitives` | 4 643 | 1 701 | 2 942 | 0 |
| `Benchscene2_complexmodel` | 12 521 338 | 9 709 362 | **2 811 976** | 0 |
| `Benchscene3_solarsystem` | 11 296 035 | 10 428 503 | 867 532 | 8 068 749 |

Deflate saves **13.3 MB** across the catalogue, so doing this wholesale would cost 13.3 MB —
the warning in §"Measured" still holds. It holds even after P0: the compressed `complex_model.glb`
still deflates by 2.8 MB, and `Benchscene2` has *no* entry deflate cannot help.

Per-entry it is a different question, and a smaller one: 12.3 MB of content sits in entries
where deflate buys under 2% — the JPEGs, and the now properly supercompressed `.ktx2`. Storing
just those uncompressed would cost roughly nothing and save decompression time on a student
laptop. **Not implemented, deliberately:** `tar -a -c -f` has no per-entry compression control,
so it would mean replacing the ZIP writer, and the saving is CPU-only and unmeasured. The
content this would help is also the content already moving to the manifest path, where entries
are not deflated at all. Revisit only with a measured decompression cost to point at.

---

## Order

```
P0 ✅ ─► P1 ✅ ─► P3 ⚠️   compress content, then address it, then vary it
P2 ✅                     independent, cheap, and it unblocks the platform's R7
P4 ✅                     whenever
```

**What is left is not buildable here.** Every remaining open item needs something this
repository does not have: a real GPU to measure peak VRAM against a budget, or a platform that
reads manifests before the dual-format archive can be retired. The four verification layers —
`--verify`, `--verify-fetch`, `manifest:verify-render`, and the LOD selection check inside
`--verify-fetch` — are the handover surface for whoever picks that up.

**P1 is next.** P0 left it one concrete gift and one concrete warning: the gift is that the
`.ktx2` and WebP payloads are now genuinely incompressible, so per-asset delivery finally
measures transfer rather than deflate; the warning is that anything the manifest points at
must be readable by a bare `GLTFLoader` with no decoder wired up. Emitting LOD variants (P3)
in Draco would fail for the same reason Draco failed here.

P0 first because it is cheap, needs no other repository, and a manifest that streams
needlessly-large assets is still streaming needlessly-large assets.

P1 is the one that unblocks other repositories — everything the engine built this month is
waiting on it. Start it in its **cheapest form**: `StreamingAssetSource.fromUrl` takes any URL,
so a directory of hashed files served by nginx proves the entire path with **no platform code
at all** — no `scenario_assets` table, no manifest endpoint. Those are needed for catalog
integration and dedup accounting, and can follow once the path is known to work.
