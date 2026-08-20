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

## S2 — Benchscene2's textures were embedded in the GLB · **done** (`c103fd2`)

Six cells of Table 2 measured the same scene. `Resources` picks its texture decoder by file
extension, and an image inside a GLB has no file to dispatch on — GLTFLoader hands three.js the
decoded image and the engine only wraps it, so neither `maxSize` nor `ktx2` could reach the three
2048×2048 maps.

`deembed_textures.sh` writes them out as `assets/textures/complex_{albedo,normal,metallic}.jpg`
and strips images, textures, samplers and the `EXT_texture_webp` requirement from the model.
`convert_to_ktx2.sh` is copied verbatim from Benchscene3 so both scenes are encoded under one
policy. `Scenario.ts` loads the three maps **extensionless**, which is what lets
`Resources.preferExtension` swap in the `.ktx2`, and assigns them to every `StandardMaterial` the
model brought.

Measured on the rebuilt archive — estimated texture VRAM, all six cells:

| | `maxSize=0` | `maxSize=2048` | `maxSize=1024` |
|---|---|---|---|
| `ktx2=0` | 48.00 MB | 48.00 MB | **12.00 MB** |
| `ktx2=1` | **16.00 MB** | 16.00 MB | 16.00 MB |

One value became three. At `maxSize=1024` the console prints one `[Texture2D] Downscaled` line
per texture where it printed none.

**Two cells still tie, and neither is packaging:**

- `maxSize=2048` cannot move a 2048×2048 source — the engine's test is strictly `>`. See S3.1;
  it is the same situation, and the same answer.
- The whole `ktx2=1` row is one number because `fromKTX2ArrayBuffer` never reads `maxSize`. That
  is a silent engine no-op, written up as entry 3 of [`ENGINE-GAPS.md`](ENGINE-GAPS.md).

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

## Not done, and what each needs

- **S3.2 — the skybox can never be KTX2.** `_loadSkybox()` asks for a literal
  `skybox/stars_panorama.jpg` and `getUrl` never consults `preferExtension`; even if it did,
  `Cubemap.fromEquirectangular` takes a URL and decodes it with the browser, which cannot read
  KTX2. Not fixable in content. The `.ktx2` beside it is kept so the archive is ready the day the
  engine can use it — the measured KTX2 saving for Scene 3 is a **floor** on the real one until
  then.
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
