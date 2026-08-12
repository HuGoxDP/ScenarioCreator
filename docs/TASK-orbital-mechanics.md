# TASK — build the `Kepler` scenario

**Read [`TASK-catalogue-expansion.md`](TASK-catalogue-expansion.md) first.**

**Deliverable:** `Scenarios/Kepler/` — «Орбітальна механіка». Launch a body from orbit height at a
chosen speed and watch which conic section it gets. All three of Kepler's laws are demonstrated,
not asserted. Category `simulation`.

This is the companion to `solar-system-scenario`, which shows the result; this one shows **why**.
It must not duplicate it: no planet textures, no tour of the system, no skybox panorama.

## 1. What to create

```
Scenarios/Kepler/
├── scenario.meta.json           id: orbital-mechanics, name: "Орбітальна механіка"
└── scripts/
    ├── Scenario.ts
    └── helpers/
        ├── UIKit.ts             ← copy
        ├── CameraSetup.ts       ← copy
        ├── Integrator.ts        ← velocity Verlet, fixed dt, substepped
        ├── OrbitElements.ts     ← state vector → a, e, ε, T, apo/peri
        └── SweptArea.ts         ← the Kepler-2 sector mesh
```

## 2. Integrate it yourself, and use velocity Verlet

Not the rigid-body solver, and not naive Euler.

- The physics engine has no inverse-square attraction and reintroducing it through `addForce`
  every step buys nothing but its timestep.
- **Euler leaks energy.** A circular orbit under Euler spirals outward visibly within a minute,
  and a student watching an orbit decay when nothing removes energy has been taught something
  false. **Velocity Verlet is symplectic**: the orbit stays closed. This choice is the difference
  between a demonstration and a bug.
- Fixed `dt` with substepping, and `dt` reduced near periapsis where the acceleration is largest.

```
a = −GM · r̂ / |r|²
```

Everything is planar (XY) — an inclined orbit adds a parameter and teaches nothing extra here.

## 3. Units

Working in metres and seconds puts `6.674e−11` and `1.989e30` on screen. Use **AU and years**
with `GM = 4π²` (AU³/year²) for the Sun, and print the same quantities converted to km and days
in the readout so the numbers are still recognisable. State the choice in a comment at the top of
`Integrator.ts` — a unit system that is not written down somewhere gets silently changed later.

## 4. Scene

- **Central body** — an emissive sphere at the origin, with a `PointLight`.
- **Satellite** — a small sphere, its velocity vector drawn as a `LineRenderer` arrow.
- **Trail** — a rolling `LineRenderer` buffer (~2000 points). Fixed capacity: an unbounded trail
  is a memory leak with a nice appearance.
- **Orbit ellipse** — the *predicted* orbit from the current state vector, drawn as a thin dashed
  ellipse. **Check:** the integrated trail lies on the predicted ellipse and stays on it after
  many revolutions. That agreement between numerics and theory is the scenario's strongest claim.
- **Foci** — both marked; the central body sits on one. **Check:** it does, and it is *not* at the
  centre. That is Kepler's first law, and it is one marker.
- **Apoapsis / periapsis** markers with their distances.

## 5. The five demonstrations

### 1. Circular orbit — `v = √(GM/r)`

A button «Кругова швидкість» sets exactly that. **Check:** the trail closes on itself and `e`
reads ~0. Nudge the speed by 5 % and the ellipse opens up.

### 2. Kepler's first law

Vary the launch speed between circular and escape. **Check:** `e` climbs from 0 toward 1, the
ellipse elongates, and the central body remains on a focus throughout.

### 3. Kepler's second law — equal areas in equal times

`SweptArea.ts` shades the sector swept over a fixed interval (say every 1/12 of the period),
building a fan of triangles as a custom `Mesh` (`vertices` + `triangles` + `recalculateNormals`,
public API). Twelve sectors of the same colour, drawn once each per orbit.

**Check:** the printed area of each sector is the same to within a fraction of a percent, while
the sectors near periapsis are visibly short and fat and those near apoapsis long and thin. Print
`dA/dt` live — it must be constant — and the specific angular momentum `L = r × v` beside it,
because they are the same statement.

### 4. Escape velocity — `v = √(2GM/r)`

**Check:** the specific orbital energy `ε = v²/2 − GM/r` is negative for every closed orbit,
crosses **exactly zero** at escape velocity, and is positive on a hyperbolic path. Show the sign
and the shape name («еліпс / парабола / гіпербола») side by side; the sign change and the shape
change must happen at the same slider position. If they do not, `ε` and the conic classification
are computed from different states.

### 5. Kepler's third law — `T² ∝ a³`

A panel plotting `T²` against `a³` for the eight real planets, from data in the scenario, as
points on a straight line through the origin. The simulated body's own `(a³, T²)` is plotted as a
distinct marker and updates as the orbit changes.

**Check:** the marker lands on the same line as the planets, at every eccentricity. The third law
depends on `a`, not on how elliptical the orbit is, and this plot is the only place that is
visible.

## 6. Controls

| Control | Range |
|---|---|
| Slider «Початкова висота r» | 0.3…5 AU |
| Slider «Початкова швидкість v» | 0…1.6 × escape velocity, marked with `v_кр` and `v_втечі` ticks |
| Slider «Кут запуску» | 0…90° from the radial direction |
| Slider «Швидкість часу» | 0.1×…20× |
| Buttons | «Запуск», «Кругова швидкість», «Друга космічна», «Пауза», «Скинути» |
| Toggles | «Слід», «Прогноз орбіти», «Сектори (2-й закон)», «Вектор швидкості» |

The two tick marks on the speed slider are worth building properly: they turn an abstract
threshold into a place on a control the student is already holding.

Readouts: `r`, `v`, `a`, `e`, `T`, `ε`, `L`, periapsis and apoapsis distances and speeds, the
conic type, and — when the orbit is closed — the period in both years and days.

## 7. Notes for the implementer

- **Reset must be exact.** Same initial state → same trajectory, bit for bit. No time-seeded
  anything (umbrella §2.6).
- **Collision with the central body** is a real outcome — detect `r < R_body` and stop with
  «падіння на поверхню» rather than letting the integrator blow up as `r → 0`. This is the one
  singularity in the model and it must be handled explicitly.
- **Camera:** frame by apoapsis, not by the current position, or a highly eccentric orbit sends
  the body off screen for most of its period. Re-frame when the orbit changes, not every frame.
- **Out of scope:** n-body interactions, orbital manoeuvres and transfers, perturbations,
  relativistic precession. A Hohmann-transfer scenario would be an excellent eleventh and could
  reuse `Integrator.ts` and `OrbitElements.ts` wholesale.
