# TASK — build the `GasTheory` scenario

**Read [`TASK-catalogue-expansion.md`](TASK-catalogue-expansion.md) first.**

**Deliverable:** `Scenarios/GasTheory/` — «Молекулярно-кінетична теорія». Several hundred
molecules in a box with a movable piston. Pressure is **measured from wall impulses** and shown
next to the ideal-gas prediction, so `pV = NkT` arrives as a result rather than an assumption.
Category `simulation`.

## 1. What to create

```
Scenarios/GasTheory/
├── scenario.meta.json           id: gas-theory, name: "Молекулярно-кінетична теорія"
└── scripts/
    ├── Scenario.ts
    └── helpers/
        ├── UIKit.ts             ← copy
        ├── CameraSetup.ts       ← copy
        ├── GasSim.ts            ← positions, velocities, walls, collisions, impulse accounting
        └── Histogram.ts         ← speed distribution drawn as UI bars
```

## 2. Do not use the physics engine for this

`GasSim.ts` owns flat `Float64Array`s of positions and velocities and integrates them itself.
Double precision, not single: positions are in metres and the box is 2·10⁻⁸ m across, so a float
would spend most of its mantissa on the exponent. `mulberry32` lives in this file rather than an
`Rng.ts` of its own — it is nine lines and has exactly one caller.
Reasons, in order of weight:

1. **Determinism.** Umbrella §2.6 requires it, and a seeded PRNG plus explicit integration gives
   it exactly. A rigid-body solver's contact resolution does not.
2. Six hundred `Rigidbody` objects with sphere colliders is a lot of solver for a problem where
   the exact answer is three lines of vector algebra.
3. The impulse bookkeeping in §4 needs the wall collision *in the scenario's own code*. Reading
   it back out of a general solver is harder than doing the reflection by hand.

Draw with **one** `InstancedMeshRenderer` — verified API: `mesh`, `count`,
`setInstanceTransform(i, pos, rot, scale)`, `setInstanceColor(i, color)`, `apply()`. One
`apply()` per frame, after the whole update loop.

Integration: fixed substeps, `dt` clamped so no molecule can cross a wall in one step at the
maximum speed the temperature slider allows.

- **Wall collision:** reflect the normal velocity component, clamp the position back inside.
- **Molecule collision:** elastic, equal masses, resolved along the line of centres, found through
  a uniform spatial grid with cell size ≥ 2r. Cap `N` at 600. If the grid turns out to cost too
  much, keep pair collisions only in the Brownian mode — but then say so on screen, because
  without them the Maxwell distribution in §5 never forms.

## 3. Modes

Tabs across the top; one simulation underneath, three ways of looking at it.

- **«Ідеальний газ»** — the box with a piston, the P/V/T readouts, the gas laws.
- **«Броунівський рух»** — one large heavy particle among the small ones, with a trail.
- **«Розподіл швидкостей»** — the histogram at full size against the Maxwell curve.

## 4. Pressure, measured

Accumulate `Σ|Δp|` — the total normal momentum transferred to the walls — over a rolling window
of ~0.5 s, then

```
P = Σ|Δp| / (Δt · A)
```

where `A` is the total wall area. Show it beside `P_ideal = N·k·T / V` computed from the current
slider values.

**Check — the point of the whole scenario:** the two track each other as T and V change. Measured
in Node before the scene existed, at N = 400, T = 300 K: **218.9 kPa measured against 207.1 kPa
ideal**, and `v_rms` matching `√(3kT/m)` to 0.1 m/s.

**The measured value sits a few percent above `NkT/V`, and that is physics rather than a bug.**
The molecules have a real radius, so the volume left for their centres is smaller than V — the
van der Waals `b` correction. The excess grows with density: halving the volume takes the ratio
from 1.06 to 1.13. Say so in the readout, because a student who sees 218.9 next to 207.1 with no
explanation will assume the simulation is wrong.

If instead the measured pressure came out at *half* the prediction, the impulse sum would be
missing its factor of 2 — a reflection transfers `2m·v⊥`, not `m·v⊥`.

Temperature is likewise **measured**: `T = m⟨v²⟩ / (3k)`. The slider sets a target; the
simulation is rescaled toward it (see §6), and the readout shows what the molecules actually have.

## 5. The histogram

A pool of 26 `UIImage` bars, heights from the speed distribution. Over it, the Maxwell–Boltzmann
prediction for the current **measured** `T`.

*Drawn as a step line, one marker per bin, rather than a smooth curve.* It can then be compared
bar by bar, and it needs no rotated segments — nothing depends on getting a polyline's transform
right in a UI space whose Y axis points down. Bars and prediction are scaled to whichever is
taller, so they share one axis.

`v_ймовірніша = √(2kT/m)`, `v_сер = √(8kT/πm)` and `v_квадратична = √(3kT/m)` are printed in the
readout beside the measured `v_rms`, rather than marked on the axis: axis labels would need
world-space text, which this batch avoids for the reason given in
[`TASK-optics-lenses.md`](TASK-optics-lenses.md) §3.

**Check:** start every molecule at the **same** speed («Однакові швидкості», or the E key) and
watch the histogram spread into the Maxwell shape within a few seconds. That equilibration from a
non-equilibrium start is the best moment in this scenario, and it is only possible if
molecule–molecule collisions are on.

Measured in Node, N = 500, T = 300 K, standard deviation of the speeds against the 201.0 m/s the
Maxwell distribution predicts:

| t | 0 s | 1 s | 2 s | 4 s | 8 s | 16 s |
|---|---|---|---|---|---|---|
| spread, m/s | 0.0 | 107.8 | 144.2 | 174.6 | 195.5 | **202.1** |

with the temperature holding at 300.0 K throughout — the collisions redistribute the speeds
without changing the total kinetic energy, which is the other half of the claim.

## 6. Controls

| Control | Range | Effect |
|---|---|---|
| Slider «Температура T» | 50…1000 K | Rescales every velocity by `√(T_target/T_measured)`, gradually — an instant rescale is a jump, and looks like a bug |
| Slider «Об'єм V» | 30…100 % | Moves the piston; molecules the piston sweeps over get pushed, which is why compressing heats the gas |
| Slider «Кількість N» | 50…600 | |
| Toggle «Колір за швидкістю» | | Blue → red by speed via `setInstanceColor` |
| Toggle «Слід важкої частинки» | | Brownian mode only |
| Button «Скинути» | | Same seed, same initial state, every time |

**Check (Бойль):** halve V at constant T → measured P doubles. **Check (Шарль/Гей-Люссак):**
double T at constant V → measured P doubles. **Check:** compressing quickly with the piston
raises the measured T even though the slider was not touched — that is adiabatic heating falling
out of the model, and it is worth a line in the readout.

## 7. Notes for the implementer

- **Brownian mode:** one particle of 220× the mass and 3.4× the radius, its path in a rolling
  `LineRenderer` buffer of 400 points. **Check:** the path is a random walk — the distance
  travelled is far greater than the net displacement.

  *`⟨r²⟩/t` is not printed, though this section first asked for it.* A mean-square displacement
  is an **ensemble** average, and there is exactly one heavy particle: a single trajectory's
  `⟨r²⟩/t` wanders by a factor of several and never settles, so a readout of it would suggest a
  law that the number on screen visibly fails to obey. Measured over one run it went 0.13 / 0.38
  / 0.81 nm² at 2 / 4 / 6 s — which is noise around a trend, not a demonstration of one.
- **Scale.** Real molecules at real sizes would be invisible; draw them large and say in the
  readout that the drawing is not to scale, next to the real mean free path for the current
  density. Being explicit about the lie costs one line and prevents a wrong intuition.
- **Out of scope:** real gases and van der Waals, phase transitions, diffusion between two gases,
  gravity-induced density gradients. The last one is tempting and cheap; it is also a different
  lesson.
