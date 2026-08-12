# TASK — build the `Mechanics` scenario

**Read [`TASK-catalogue-expansion.md`](TASK-catalogue-expansion.md) first.**

**Deliverable:** `Scenarios/Mechanics/` — «Механіка: похила площина». A block on a ramp, driven by
the engine's real rigid-body solver, with the force vectors drawn and the analytic answer printed
next to the measured one. Category `simulation`.

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
        ├── Ramp.ts              ← ramp, ground, blocks, materials
        └── VectorArrow.ts       ← a LineRenderer + cone tip that follows a body
```

## 2. Units and the world

**1 world unit = 1 metre**, and say so in a comment. Every number on screen is then SI without a
conversion factor anyone can get wrong.

- Ramp: a scaled `BoxCollider` + cube mesh, rotated about Z by α. Rotate the **ramp**, keep
  gravity vertical — the reverse (tilting gravity) is easier to code and teaches the wrong model.
- Ground: a plane the block slides onto, so the run has an end.
- Block: `BoxCollider` + `Rigidbody`, `mass` from the slider, `PhysicMaterial(friction, 0)`.
  Verified API: `new PhysicMaterial(friction, bounciness)`, and `Rigidbody.material` is settable.
- `Physics.gravity` is a settable static — use it for the planet dropdown rather than scaling
  masses.

## 3. Controls

| Control | Range | Note |
|---|---|---|
| Slider «Кут нахилу α» | 0…60°, whole degrees | Rebuilds the ramp transform; resets the run |
| Slider «Маса m» | 0.5…10 кг | |
| Slider «Коефіцієнт тертя μ» | 0…1.0 | Applied to both surfaces |
| Dropdown «Тяжіння» | Земля 9.81 / Місяць 1.62 / Марс 3.71 / Юпітер 24.79 | Sets `Physics.gravity` |
| Buttons | «Пуск», «Пауза», «Скинути» | |
| Toggle «Вектори сил» | | §4 |
| Toggle «Слід» | | Trail of the block's path, `LineRenderer` |
| Toggle «Два тіла» | | §5 |

Changing α, m or μ while a run is in progress resets it. Silently continuing with the old state
is how a student ends up measuring one configuration and reading another.

## 4. Force vectors

Four arrows anchored on the block, each a `LineRenderer` with a small cone at the tip, length
proportional to magnitude with a stated scale (`1 Н = 0.05 м` in the legend):

| Vector | Direction | Magnitude |
|---|---|---|
| `mg` | straight down | `m·g` |
| `N` | perpendicular to the ramp | `m·g·cos α` |
| `F_тертя` | up the slope, opposing motion | `μ·N`, capped at the driving force while at rest |
| `F_рівнод` | along the slope | `m·g·sin α − F_тертя` |

Label each with a world-space canvas (umbrella §5 — remember they are not depth-occluded).

**Check:** while the block is at rest, `F_тертя` exactly cancels `mg·sin α` and `F_рівнод` is
zero-length. Static friction is *not* `μN` until it has to be; drawing it at full length on a
stationary block is the classic wrong diagram.

## 5. Readouts — measured beside calculated

Two columns, headed «Розрахунок» and «Вимір»:

| Row | Розрахунок | Вимір |
|---|---|---|
| `mg·sin α` | `m·g·sin α` | — |
| `mg·cos α` (= N) | `m·g·cos α` | — |
| `F_тертя max` | `μ·m·g·cos α` | — |
| `a` | `g(sin α − μ·cos α)`, floored at 0 | finite difference of the sampled velocity |
| `v` | `a·t` | `Rigidbody.velocity` magnitude |
| `s` | `a·t²/2` | distance travelled |

**Check:** the two `a` columns agree to within a few percent for α = 30°, μ = 0.2. They will not
agree exactly — the solver has its own timestep — and the gap is itself worth showing. If they
diverge grossly, the ramp's `PhysicMaterial` is not being applied, or friction is being combined
between two materials in a way that halves it.

State line, in words: «спокій — тертя утримує (tg α ≤ μ)» / «ковзання — a = … м/с²».

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

- **Sample in `fixedUpdate`, draw in `update`.** `Tracker.ts` reads velocity on the physics
  timestep; the readouts refresh on the render frame. Sampling velocity in `update` and calling
  it a measurement makes the "вимір" column a function of frame rate.
- **Reset means reset.** Set position, rotation, `velocity` and `angularVelocity`, and call
  `wakeUp()`. A body left asleep will not start moving when the angle changes.
- **Constrain rotation** (`RigidbodyConstraints`) so the block slides rather than tumbling. A
  tumbling box is a different lesson and a worse one — rolling and toppling need proper inertia.
- **Out of scope:** rolling bodies, air resistance, a pulley or a second connected body,
  energy-conservation bookkeeping. Each is a good separate scenario.
