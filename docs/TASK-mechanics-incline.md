# TASK — build the `Mechanics` scenario

**Read [`TASK-catalogue-expansion.md`](TASK-catalogue-expansion.md) first.**

**Deliverable:** `Scenarios/Mechanics/` — «Механіка: похила площина». A block on a ramp with its
free-body diagram drawn and every number on screen in SI. Category `simulation`.

## 1. What to create

```
Scenarios/Mechanics/
├── scenario.meta.json           id: mechanics-incline, name: "Механіка: похила площина"
└── scripts/
    ├── Scenario.ts
    ├── components/
    │   └── Tracker.ts           ← samples v, s, t off one Rigidbody each FixedUpdate
    └── helpers/
        ├── UIKit.ts             ← copy
        ├── CameraSetup.ts       ← copy
        ├── Ramp.ts              ← ramp, ground, blocks, and the force arrows
        └── Slide.ts             ← the equation of motion, engine-free
```

**`components/Tracker.ts` is not needed and was not built.** It existed to sample a `Rigidbody`
each `fixedUpdate`; there is no `Rigidbody` here. See §2.

## 2. Units and the world

**1 world unit = 1 metre**, and say so in a comment. Every number on screen is then SI without a
conversion factor anyone can get wrong.

- Ramp: a scaled cube mesh, rotated about Z by α. Rotate the **ramp**, keep gravity vertical —
  the reverse (tilting gravity) is easier to code and teaches the wrong model.
- Ground: a flat run the block slides onto, so the run has an end.
- Block: a cube placed along the path by `helpers/Slide.ts`.

### The rigid-body solver cannot carry μ, so it is not used

This section originally called for `BoxCollider` + `Rigidbody` + `PhysicMaterial(μ, 0)`, and the
whole scenario turns on μ. It does not work, and the reason is worth stating precisely because it
affects any scenario that wants friction:

`PhysicMaterial` writes its `friction` onto a cannon-es `Material`. cannon only reads a
material's friction through a `ContactMaterial` registered for that **pair** of materials, and
the engine never calls `world.addContactMaterial` — zero call sites in `WebEngineTS.esm.js`, the
only occurrence being cannon's own method definition. Every contact therefore falls back to
`world.defaultContactMaterial`, which is a hard-coded friction of **0.3**. A μ slider wired to
`PhysicMaterial` would move and change nothing at all.

That is an engine gap, written up in full — with the evidence and the engine-side fix — as entry
1 of [`ENGINE-GAPS.md`](ENGINE-GAPS.md). In the meantime
the inclined plane loses nothing by being integrated directly: `a = g(sin α − μ cos α)` is exact
for this problem, not an approximation of what a solver would produce. `helpers/Slide.ts` imports
nothing from the engine, which also means the physics is checkable in Node — and it was checked
before the scene existed.

`Physics.gravity` is likewise unused: with no rigid bodies there is nothing for it to act on, and
the planet dropdown feeds `g` straight into the equation.

## 3. Controls

| Control | Range | Note |
|---|---|---|
| Slider «Кут нахилу α» | 0…60°, whole degrees | Rebuilds the ramp transform; resets the run |
| Slider «Маса m» | 0.5…10 кг | |
| Slider «Коефіцієнт тертя μ» | 0…1.0 | Applied to both surfaces |
| Dropdown «Тяжіння» | Земля 9.81 / Місяць 1.62 / Марс 3.71 / Юпітер 24.79 | Feeds `g` into the equation |
| Buttons | «Пуск», «Пауза», «Скинути» | |
| Toggle «Вектори сил» | | §4 |
| Toggle «Слід» | | Trail of the block's path, `LineRenderer` |
| Toggle «Два тіла» | | §5 |

Changing α, m or μ while a run is in progress resets it. Silently continuing with the old state
is how a student ends up measuring one configuration and reading another.

## 4. Force vectors

Four arrows anchored on the block, each a shaft and two head strokes drawn with `LineRenderer`s
in the bench's own plane — no cone mesh, so there is no winding to get wrong on geometry nobody
can inspect here.

| Vector | Direction | Magnitude |
|---|---|---|
| `mg` | straight down | `m·g` |
| `N` | perpendicular to the ramp | `m·g·cos α` |
| `F_тертя` | up the slope, opposing motion | `μ·N`, capped at the driving force while at rest |
| `F_рівнод` | along the slope | `m·g·sin α − F_тертя` |

**Scaled so that `mg` is always the same length on screen**, with the rest in that same scale.
A fixed newtons-per-metre scale cannot serve both a 0.5 kg block on the Moon (0.8 Н) and a 10 kg
block on Jupiter (248 Н): one is invisible and the other runs off the bench. Normalising on the
weight keeps every arrow legible and keeps the *ratios* true, which is what a free-body diagram
is read for. The newtons are on the panel, and the legend says what the scaling is.

No world-space labels, for the reason given in
[`TASK-optics-lenses.md`](TASK-optics-lenses.md) §3 — the legend names each colour instead.

**Check:** while the block is at rest, `F_тертя` exactly cancels `mg·sin α` and `F_рівнод` is
zero-length. Static friction is *not* `μN` until it has to be; drawing it at full length on a
stationary block is the classic wrong diagram.

## 5. Readouts

One column, not two. The «Вимір» column this section used to call for was there to show that the
solver agreed with theory; with no solver there is nothing independent to measure, and printing
the integrator's output under a heading that says «вимір» would be a lie about where the number
came from.

State line first — «Спокій — тертя утримує» / «Ковзання по похилій» / «Гальмування на
горизонталі» / «Зупинився» — then `tg α` against `μ` so the threshold is legible as an
inequality, then:

| Row | Shown |
|---|---|
| `mg` | `m·g` |
| `mg·sin α` | the driving component |
| `N = mg·cos α` | |
| `F_тертя` | what friction is *actually* doing, with `μN` beside it as the maximum |
| `F_рівнодійна` | zero while at rest |
| `a` | `g(sin α − μ·cos α)` on the ramp, `−μg` on the flat |
| `t`, `v`, `s` | live |

**The one honest comparison that remains, and it is worth keeping:** while the block is on the
ramp the acceleration is constant, so the integrated `v` and `s` must equal `a·t` and `a·t²/2`
exactly. Both pairs are printed together. `Slide.step` integrates trapezoidally for this reason —
semi-implicit Euler drifts about 0.2 % high over two seconds at 240 Hz, which is invisible in a
simulation and glaring when the textbook value is printed next to it.

## 6. The three demonstrations to check by hand

1. **The sliding threshold.** With μ = 0.5, raise α slowly. The block stays put until
   `tg α > μ` — at α ≈ 26.6° — and moves immediately after. **Check:** the state line flips at
   the same angle the inequality does, not one slider notch away.
2. **Mass does not matter.** Toggle «Два тіла»: a 1 кг and a 10 кг block side by side, released
   together. **Check:** they stay level the whole way down and arrive together. Everyone expects
   the heavy one to win; this is the single best moment in the scenario.
3. **Free fall.** μ = 0, α = 30°, Earth → measured `a ≈ 4.9 м/с²` = `g/2`. **Check:** it does.
   Switch to the Moon → `a ≈ 0.81 м/с²`.

## 7. Notes for the implementer

- **Integrate in `fixedUpdate`, draw in `update`.** `Time.fixedDeltaTime` is a fixed step, so the
  motion does not depend on frame rate; placement and the readouts refresh on the render frame.
- **Reset means reset**, and it happens on every parameter change: `Slide.configure` resets time,
  distance and speed, and the trail is cleared with it.
- **The block lies flat on whatever it stands on** — `Quaternion.fromToRotation(Vector3.up, n)`.
  It slides rather than tumbling, which is the intended lesson; rolling and toppling need proper
  inertia and are a different scenario.
- **Out of scope:** rolling bodies, air resistance, a pulley or a second connected body,
  energy-conservation bookkeeping. Each is a good separate scenario.
