# TASK — grow the production catalogue from 2 to 10

**Origin:** 2026-08-12. `Scenarios/` holds two scenarios — `solar-system-scenario` and
`Molecules`. The three Benchscenes are measurement rigs and deliberately live in
`TestScenarios/`, so they do not count towards what a student can open. Eight more production
scenarios take the catalogue to ten.

**Deliverable:** eight scenarios under `Scenarios/`, each with its own TASK document in this
folder. This file holds what all eight share; each per-scenario document holds only what is
specific to it, and assumes this one has been read.

| # | Folder | id / doc | Subject | One line |
|---|---|---|---|---|
| 1 | `AtomStructure` | [`atom-structure`](TASK-atom-structure.md) | Хімія | Periodic table → Bohr model, isotopes and ions |
| 2 | `DNA` | [`dna-protein-synthesis`](TASK-dna-protein-synthesis.md) | Біологія | Double helix, transcription, translation |
| 3 | `Optics` | [`optics-lenses`](TASK-optics-lenses.md) | Фізика | Lenses and mirrors, principal rays, image construction |
| 4 | `Mechanics` | [`mechanics-incline`](TASK-mechanics-incline.md) | Фізика | Inclined plane, friction, force vectors |
| 5 | `GasTheory` | [`gas-theory`](TASK-gas-theory.md) | Фізика | Kinetic theory, pressure from impulses, Maxwell distribution |
| 6 | `Crystals` | [`crystal-lattices`](TASK-crystal-lattices.md) | Хімія | Unit cells, coordination number, density from geometry |
| 7 | `Circuits` | [`electric-circuits`](TASK-electric-circuits.md) | Фізика | Series and parallel, Ohm's law, live meters |
| 8 | `Kepler` | [`orbital-mechanics`](TASK-orbital-mechanics.md) | Астрономія | Orbits, escape velocity, all three Kepler laws |

The set is chosen so no two scenarios look alike on screen — a table plus a model, a helix, ray
lines, a falling body, a swarm, a lattice, a schematic, an orbit — and so the four school
subjects a virtual lab is asked for are all covered.

---

## 1. Every one of these ships without a single asset

All eight are procedural: spheres, cylinders, tori, lines and meshes built in code. That is not
a stylistic preference, it is the cheapest way to stay out of the pipeline's way:

- `ScenarioAssets` wires no Draco, meshopt or KTX2 decoder (CLAUDE.md, rule 5), so every mesh
  that enters this repo has to be checked against that. A mesh built by `Mesh.createSphere` is
  never in question.
- A zero-asset scenario packages to a few tens of KB, so the whole catalogue stays smaller than
  `solar-system-scenario` alone.
- Nothing in these eight depends on the LOD/manifest work still in flight.

`Molecules` already proves the shape: 46 molecules, no assets, two meshes and one material per
element for the entire catalogue.

**If a scenario seems to need an asset, it is the wrong scenario for this batch.** Anatomy and
microscopy were dropped for exactly that reason.

## 2. Hard constraints

The first four are repo rules that a build or a review will catch; the last three are the ones
that will not be caught automatically.

1. **Exactly one `class … extends ScenarioBehaviour`** per scenario. The builder greps for it
   and fails on zero or several. It goes in `Scenario.ts`; every helper module exports plain
   functions or plain classes.
2. **Content only.** No benchmark harness, no frame timers, no optimization toggles. Measurement
   belongs to the engine's harness and a scenario that measures itself invalidates it.
3. **No engine code, no platform code.** If something is missing from the engine API, say so in
   the handover instead of working around it inside a scenario.
4. **No cross-scenario imports.** Verified, not assumed: `build-package.mjs:198` compiles with
   `--rootDir <scenario>/scripts`, so a file outside that tree is a compile error. Helpers are
   **copied** into each scenario. `Scenarios/Molecules/scripts/helpers/UIKit.ts` and
   `CameraSetup.ts` are the ones worth copying; copy `components/Rotator.ts` too where a body
   spins.
5. **UI text is Ukrainian; code, comments and identifiers are English.** That is what both
   existing production scenarios do, and the platform's own strings are Ukrainian.
6. **Determinism.** No `Math.random()` without a fixed seed, and no scene-graph size that
   depends on wall-clock time. `npm run manifest:verify-render` loads each scenario twice — once
   from the ZIP, once from the manifest — and compares the scene-graph size; a scenario that
   builds a different number of objects per run fails that check for no real reason.
7. **Every number on screen is either measured or derived, never both silently.** Where a
   scenario shows a simulated quantity next to its textbook formula, label which is which. This
   is the pedagogic point of half the batch.

## 3. `scenario.meta.json` is required for all eight

`Molecules` currently has none, so it appears in the catalogue as `Molecules` — do not repeat
that. Read by `scenario-meta.mjs` for both the ZIP manifest and the streaming manifest:

```json
{
  "id": "atom-structure",
  "name": "Будова атома",
  "description": "Одне-два речення українською: що студент бачить і чим керує.",
  "category": "education",
  "version": "1.0.0",
  "contentVersion": 1
}
```

- **`id`** — the catalogue slug, lowercase kebab. It goes into virtual-lab's `/play/:id` path,
  so state it here rather than letting it be derived from the folder name.
- **`category`** — a value of the engine's `ScenarioCategory` enum: `education` for all eight
  except `mechanics-incline`, `gas-theory`, `orbital-mechanics` and `electric-circuits`, which
  are `simulation`. This is **not** the school subject.
- **The school subject is a platform field**, entered at upload time in virtual-lab's `/admin`
  as `category` + `categoryLabel` (e.g. `chemistry` / `Хімія`). The catalogue already has
  `astronomy` / `Астрономія`. Nothing in this repo writes it.
- **No `author`, no invented fields.** `scenario-meta.mjs` omits what nobody stated on purpose.
- **No `streaming.priorities`** block: with no assets there is nothing to prioritise.

## 4. The shared UI kit needs four more factories

`UIKit.ts` today has `makeLabel`, `makePanel`, `makeButton` and the `Anchor` presets that hide
the Y-down `RectTransform` convention. Seven of the eight need controls it does not have. Add
these to the copy in the **first** scenario built, then copy that version forward:

```ts
makeSlider(parent, { anchor, x, y, width, height, min, max, value, wholeNumbers?,
                     onChange: (v: number) => void }): Slider
makeToggle(parent, { anchor, x, y, width, height, label, value,
                     onChange: (on: boolean) => void }): Toggle
makeDropdown(parent, { anchor, x, y, width, height, options, value,
                     onChange: (index: number) => void }): Dropdown
makeReadout(parent, { anchor, x, y, width, rows }): (row: number, text: string) => void
```

Verified against the installed engine: `Slider` has `minValue`/`maxValue`/`value`/
`wholeNumbers`/`direction` and `onValueChanged: UIEvent<number>`; `Toggle` has `isOn`, `label`
and `onValueChanged: UIEvent<boolean>`; `Dropdown` has `options`, `value`, `maxVisibleItems`.
Use `addListener` rather than assigning `onValueChanged`, and `setValueWithoutNotify` /
`setIsOnWithoutNotify` when code moves a control to reflect state it just changed itself —
otherwise two controls that mirror each other will fight.

**A labelled slider is a row, not a widget.** Every one of these scenarios wants
`«μ (коеф. тертя)   0.35»` above the track. Put that pairing in `makeSlider` — a label, the
slider, and a value readout the factory updates — or it will be re-typed forty times.

## 5. In-scene labels

Several scenarios want text attached to a point in the world (a force vector's name, a resistor's
value, a lattice site). The engine supports it: `Canvas.renderMode = CanvasRenderMode.WorldSpace`
pins a canvas to its GameObject and projects it each frame.

Its documented limit matters here: **it is not depth-occluded** — a label on the far side of an
object draws over it. Where that reads as a bug, hide the label from script; a raycast against
the object is the usual test. `Camera.worldToScreenPoint` is available if a scenario would rather
place an overlay label by hand.

## 6. Order of work, and what "done" means

Build in the table's order. The first one carries the extra cost of extending `UIKit.ts`, so it
should be **`atom-structure`**: it is the one whose UI is closest to what `Molecules` already
does, so the new factories can be written against a familiar screen.

A scenario is done when all five hold:

```powershell
npm run build:list                                  # the name appears
npm run build -- --scenario <Folder>                # exits 0, ZIP in ReleaseScenarios/
npm run manifest:all                                # emits <id>.scenario.json
npm run manifest:verify                             # hashes match
npm run manifest:verify-render                      # loads from ZIP and manifest, same graph
```

plus: the ZIP contains `manifest.json` at the root with the intended id and version, and every
**Check:** in the scenario's own document has been performed by hand, in a browser, by the person
who wrote it. A Check that cannot be performed means the scenario is not finished — that rule is
inherited from [`TASK-ui-showcase.md`](TASK-ui-showcase.md) and it is the only thing standing in
for a test runner here.

## 7. Two things to settle before writing code

- **`Molecules` has no `scenario.meta.json`.** Fix it in the same pass as the first new scenario
  (`id: "molecules"`, `name: "Молекулярні моделі"`, `category: "education"`); otherwise the
  catalogue gets a Latin name next to eight Ukrainian ones.
- **`UIShowcase` is still unbuilt** and [its document](TASK-ui-showcase.md) targets
  `Scenarios/UIShowcase/`. By CLAUDE.md's own division — `TestScenarios/` is for feature demos —
  it belongs in `TestScenarios/`. It is not part of this batch either way; decide the root before
  someone builds it into the student-facing catalogue.
