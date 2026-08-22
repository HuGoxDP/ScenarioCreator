# TASK — benchmark archives, against `WebEngineTS-Benchmarks/tasks/scenariocreator.md`

**Origin:** the benchmark suite rebuilding the paper's tables for the 24 August resubmission
found that three of its optimization flags had nothing to act on, and that the cause was on this
side — how the archives are packed. Its task file is the tracker; this file records what was done
here, with the measurements, so a number in the paper can be traced back to a commit.

The rule that governs all of it: **no benchmark logic in scenario code.** No URL parameters, no
`if (benchmark)`, no optimization toggles. The archives are content and the harness measures
them. Nothing below breaks that; where a flag needed something to reach, the fix was to change
what the archive *contains*, never to have the scenario notice it was being measured.

---

## S2 — Benchscene2's textures were embedded in the GLB · **done** (`c103fd2`, revised)

Six cells of Table 2 measured the same scene. `Resources` picks its texture decoder by file
extension, and an image inside a GLB has no file to dispatch on — GLTFLoader hands three.js the
decoded image and the engine only wraps it, so neither `maxSize` nor `ktx2` could reach the three
2048×2048 maps.

**Only the base colour was moved out**, and that restriction is the whole shape of the fix.
`Texture2D.fromArrayBuffer` tags every image it decodes as sRGB and no material setter corrects
it — right for base colour, wrong for the normal and metallic-roughness maps, which hold linear
data (entry 5 of [`ENGINE-GAPS.md`](ENGINE-GAPS.md)). A first attempt moved all three out; the
model rendered dark and blotchy, and the two arms of the KTX2 A/B stopped shading identically.
So the rule is: **a texture may leave the GLB only if sRGB is its correct colour space.**

`deembed_textures.sh` extracts the colour slots and lets `gltf-transform prune` drop the orphaned
image; `convert_to_ktx2.sh` encodes the `.ktx2` beside the `.jpg`; `Scenario.ts` loads it
**extensionless**, which is what lets `Resources.preferExtension` swap the variant.

Measured on the rebuilt archive, **a fresh page per cell** — estimated texture VRAM:

| | `maxSize=0` | `maxSize=2048` | `maxSize=1024` |
|---|---|---|---|
| `ktx2=0` | 48.00 MB | 48.00 MB | **36.00 MB** |
| `ktx2=1` | **37.33 MB** | 37.33 MB | 37.33 MB |

One value became three, and the arithmetic checks: three 2048² RGBA maps are 3 × 16 MiB = 48;
capping only the external one gives 4 + 16 + 16 = 36; compressing only the external one gives
48 − 16 + 5.33 = 37.33.

Colour space, read off the material at runtime, is now correct in **both** arms — `map` = `srgb`,
and `normalMap` / `metalnessMap` / `roughnessMap` = `NoColorSpace`, identical whichever way the
`ktx2` flag is set. That is what makes the A/B vary a texture format and nothing else.

**Method note.** The first published version of this table was measured with six scenario loads
in one page. That accumulates: embedded textures are re-created per load and
`unloadScenario` does not release them, and a run in that mode showed a cap apparently
*increasing* VRAM. The numbers above come from a fresh browser per cell. The previously published
figures (48 / 48 / 12 / 16 / 16 / 16, for the all-external configuration) match their arithmetic
exactly — 3 × 16, 3 × 4, 3 × 5.33 — because with every map coming from `Resources` the asset cache
returned the same objects rather than duplicating them. They were right; the method was not.

**Two cells still tie, and neither is packaging:**

- `maxSize=2048` cannot move a 2048×2048 source — the engine's test is strictly `>`. See S3.1;
  same situation, same answer.
- The whole `ktx2=1` row is one number because `fromKTX2ArrayBuffer` never reads `maxSize` —
  entry 3 of [`ENGINE-GAPS.md`](ENGINE-GAPS.md). No longer silent: the loader warns once.

**What the fix costs.** The cap and the format swap reach one map instead of three, so the
effect is a third of what it would be if the engine could express linear data. That is the price
of a correct scene and an honest A/B, and it is recoverable the day entry 5 is fixed — the same
script moves the other two maps out with one line of its slot table.

Archive after the revision: `complex_model.glb` 11 198 164 · `complex_albedo.jpg` 2 132 481 ·
`complex_albedo.ktx2` 958 688 — 14 296 401 uncompressed, 11 483 895 as a ZIP.

---

## S1.1 — the count sweep could not be driven · **done**

`OBJECT_COUNT` was welded into one archive, and a scenario has no parameter channel —
`IScenarioContext` exposes `manifest`, `assets` and `importScript`, and nothing from the URL
reaches scenario code. That is the correct policy, so the sweep ships as four archives:

```
Benchscene1_N100.zip    Benchscene1_N500.zip    Benchscene1_N1000.zip    Benchscene1_N5000.zip
```

`Benchscene1_primitives` became `Benchscene1_N1000` (a `git mv`, history preserved) and three
siblings were copied from it. **The four `Scenario.ts` files are byte-identical except for one
line** — `git diff --no-index` between any two reports exactly `1 1`, and that property is what
the sweep depends on. Ids are stated in `scenario.meta.json` rather than derived, so a folder
rename cannot silently renumber the series.

Verified in a browser, both load paths, scene-graph size:

| archive | objects | = N + camera, sun, ambient, floor |
|---|---|---|
| `benchscene1-n100` | 104 | 100 + 4 |
| `benchscene1-n500` | 504 | 500 + 4 |
| `benchscene1-n1000` | 1004 | 1000 + 4 |
| `benchscene1-n5000` | 5004 | 5000 + 4 |

Nothing else moves.

### The transform workload, recorded but not changed (S1.2)

The scene performs **one transform write per object per frame** — `localRotation`, and nothing
else. No position, no scale, no parent pivot, no world-space read. The quaternion is computed
once and shared, so `update()` is a pure write loop. That figure is now stated at the top of
`Scenario.ts`, because it is what makes a dirty-transform measurement interpretable.

One write is the **least favourable** workload a write-coalescing optimization can be given; it
breaks even nearer three or four. That is a property of this scene and it has deliberately not
been tuned away. Making the workload representative is S1.2, and the task file is right that it
needs a decision about what the scene is meant to represent before anyone touches it.

### Note on where this work belongs

`WebEngineTS-Benchmarks/tasks/README.md` answers the approach question plainly — the benchmark
scenarios should **not** live in ScenarioCreator, and moving them costs nothing scientifically,
because fidelity is in the archive format rather than in the authoring tool. Its ordering puts
the move before S1.1, which would make this one parameterised source instead of four folders.

It was done here anyway, as four folders, because the sweep is wanted for the resubmission and
the same README defers the move ("half a day of pipeline work", not before the 24th). These four
folders are precisely what the move deletes; that is expected, and the one-line-diff property
makes them trivial to fold into a single parameterised source when it happens.

### The scene is not drawing what the archive describes

Found by looking at a rendered frame, which is the first time anyone had. Four of the seven
`Mesh.create*` builders emit triangle winding opposite to their own vertex normals, so those
faces are back-face culled. In `Benchscene1` that means:

- **the floor has never been drawn.** It is a `createPlane`, inverted whole.
- **three of the five object meshes** — cylinder side walls, capsules, tori — shade only their far
  inner surfaces. Cubes and spheres are correct.

Full audit, the exact defect and the engine-side fix are entry 4 of
[`ENGINE-GAPS.md`](ENGINE-GAPS.md). Two things matter for the measurement:

1. **It is not a regression.** The identical audit against `0.1.0-local.1786479071411` gives the
   same counts, so every run ever taken on this scene saw the same geometry. Comparisons
   *between* engine builds are unaffected.
2. **The fill cost is not the scene's.** A frame that never rasterises the floor and shades the
   inside of three mesh types is cheaper than the scene the archive describes. `objects`,
   `triangles` and the transform workload are all still exactly as reported — the defect is in
   which faces survive culling, not in what the scene contains. But wording like "a grid of
   primitives over a floor plane" describes something the renderer never produced, and Section 5
   should not use it until the engine is fixed and the scene re-measured.

There is **no content workaround**: `doubleSided` is a field of `IShaderSource`, not of
`StandardMaterial`, so a scenario cannot ask for both faces. Nothing in this repository can fix
it, which is why nothing here was changed.

---

## S3.1 — the planet textures are already at the cap · **answered, no change**

The task offers a fork: ship 4096×2048 planet sources so the cap has something to cut, *or* say
they only exist at 2048 and keep reporting row 3.2 as what it measurably is. Measured, both
copies of the assets being byte-identical:

| | dimensions |
|---|---|
| `skybox/stars_panorama.jpg` | 8192 × 4096 |
| ten planet/moon textures | 2048 × 1024 |
| `textures/saturn_ring.jpg` | 2048 × 125 |

**There is no 4096 source, here or in history.** So row 3.2 is a skybox result, and that is what
it should be called.

Upscaling 2048 → 4096 was considered and rejected. It would make `maxSize=2048` show a large
saving, but the pixels the cap discarded would be interpolated ones — the optimization would look
good against detail that was never in the asset. That is exactly what the third rule of the task
file forbids.

---

## S3.2 — the skybox can now be KTX2 · **done**

This was filed as *not fixable in content*, and it was: `_loadSkybox()` asked for a literal
`skybox/stars_panorama.jpg`, `getUrl` hands back a blob URL for exactly the path it is given and
never consults `preferExtension`, and asking for the `.ktx2` instead would not have helped either
because `Cubemap.fromEquirectangular` only took a URL and decoded it with the browser, which
cannot read KTX2. So the largest texture in the scene stayed uncompressed in both branches of the
A/B, and the reported KTX2 saving was a **floor** on the real one.

Engine `0.1.0-local.1787254037912` added the overload the benchmark repo's engine task asked for
— `fromEquirectangular(source: string | Texture2D)` — which makes it a content fix after all.
`_loadSkybox()` now loads the panorama through `Resources.tryLoad(Texture2D, …)` **extensionless**
and hands the decoded texture over.

Measured, same engine build, same archive contents, only the loading code differing — total
estimated texture VRAM for the whole scene:

| `_loadSkybox()` | `ktx2=0` | `ktx2=1` | saving |
|---|---|---|---|
| old — `getUrl("…jpg")` | 242.67 MB | 197.33 MB | 45.34 MB · **18.7 %** |
| new — extensionless `Texture2D` | 200.00 MB | **69.33 MB** | 130.67 MB · **65.3 %** |

The skybox now participates in the swap, and the reported saving for Scene 3 roughly triples. The
`.ktx2` in the archive is no longer dead weight.

One thing in that table is measured but **not explained**: the `ktx2=0` baseline also fell, 242.67
→ 200.00 MB, although nothing about the uncompressed path was supposed to change. The likely
cause is that the old route left the decoded panorama live *alongside* the cubemap built from it,
while the new overload takes ownership of a texture the caller already holds — the engine has an
internal `_equirectHandleFor` for exactly that bookkeeping. That is a hypothesis from reading the
API surface, not something verified, and it should be confirmed before any load-time claim rests
on it.

---

## Two texture files were not the format their names claimed · **fixed**

Not an engine gap — a defect in this repository's own assets, found while re-checking
[`ENGINE-GAPS.md`](ENGINE-GAPS.md) entry 5 against the fixed engine.

`Resources.tryLoad(Texture2D, "textures/earth_normal")` returned **null** while `textures/earth`
and `textures/earth_night` loaded from the same folder of the same archive. The cause was in the
bytes:

| file | claimed | actually was |
|---|---|---|
| `earth_normal.jpg` | JPEG | **TIFF** |
| `saturn_ring.jpg` | JPEG | **PNG** with alpha |

A browser will sniff a PNG served under a `.jpg` name and decode it anyway, so `saturn_ring`
worked by luck. It will not decode a TIFF in an `<img>`, so **Earth has never had a normal map on
the `.jpg` path** — in Benchscene3 or in the production `solar-system-scenario`, which ships the
same files.

`convert_to_ktx2.sh` detects format by magic bytes rather than extension and normalises through
Pillow, which is why `earth_normal.ktx2` was always valid. That is the sharp end of it:

**the `ktx2` A/B for Scene 3 differed by whether the Earth had a normal map at all.** At
`ktx2=0` the `.jpg` failed and the slot stayed empty; at `ktx2=1` the `.ktx2` loaded and shaded.
That is a larger discrepancy than the colour-space one it was found next to, and it silently
favoured the compressed arm.

**Fixed** in both scenarios: `earth_normal.jpg` re-encoded from the TIFF as a real JPEG (q94,
4:4:4 — it is a normal map, so no chroma subsampling), `saturn_ring.jpg` renamed to
`saturn_ring.png`, which is what it is. Both scenarios request these paths **extensionless**, so
no scenario code changed; the rename does move `saturn_ring`'s asset guid, which is the documented
limit of deriving identity from a path.

Verified in a browser after the fix — `textures/earth_normal` loads at 2048×1024 where it
returned null before, `textures/saturn_ring` loads at 2048×125, and Earth's material carries a
`normalMap` tagged `NoColorSpace`.

**Worth a pack-time check.** S4.1 already proposes a `content` section in the manifest listing
each texture's dimensions; adding the real format, detected from magic bytes, would have caught
both of these at build time instead of by accident.

---

## Not done, and what each needs

- **S3.3 — seven failed model lookups.** `Scenario.js` tries `models/<planet>` for six planets
  and the moon; the archive ships no `models/`, so all seven fall back to textured spheres and
  `load_ms` is partly a measurement of failed lookups. Either ship the models or drop the
  `model:` fields.
- **S4 — archive identity and deterministic packing.** A content section in the manifest, and a
  byte-identical rebuild so an archive has a SHA-256 the harness can record. The larger of the
  two, and the one that does most for the reproducibility claim.

## Handover — the archives have NOT been copied into the benchmark repo

`WebEngineTS-Benchmarks/scenarios/*.zip` still holds the old exports. Swapping them in is the run
owner's call, not this repo's, because they are inputs to a campaign in flight. Three things
change when they are swapped:

| | old | new |
|---|---|---|
| Benchscene2 id / version | `template.benchscene2.complexmodel` / `0.0.1-template` | `benchscene2-complexmodel` / `1.0.0` |
| Benchscene2 size | 12.5 MB | 19.2 MB uncompressed (textures left the GLB) |
| Benchscene1 | one `Benchscene1.zip` | four `Benchscene1_N*.zip` |

Historical tables in [`PLAN.md`](PLAN.md) and
[`TASK-rebuild-and-republish.md`](TASK-rebuild-and-republish.md) still say
`Benchscene1_primitives`. They are records of measurements actually taken against that archive
and were left alone; renaming them would falsify the record.
