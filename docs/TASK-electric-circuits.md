# TASK — build the `Circuits` scenario

**Read [`TASK-catalogue-expansion.md`](TASK-catalogue-expansion.md) first.**

**Deliverable:** `Scenarios/Circuits/` — «Електричні кола». Four fixed circuit templates the
student parameterises with sliders, solved live, with meters, a lamp that brightens with power,
and charge carriers whose speed and spacing show the current. Category `simulation`.

## 1. Scope decision, up front

**This is not a circuit editor.** A free-form editor — place components, draw wires, detect
loops, solve an arbitrary graph — is an application, not a scenario, and it would take longer
than the other seven combined. What teaches the material is *varying* a known circuit and
watching Ohm's law hold, so the scenario ships four templates and makes them adjustable.

If a free-form editor is wanted later, it is a separate task and should say so out loud.

## 2. What to create

```
Scenarios/Circuits/
├── scenario.meta.json           id: electric-circuits, name: "Електричні кола"
└── scripts/
    ├── Scenario.ts
    └── helpers/
        ├── UIKit.ts             ← copy
        ├── CameraSetup.ts       ← copy
        ├── Schematic.ts         ← wires, component bodies, world-space labels
        ├── Carriers.ts          ← the moving charge markers
        └── data/
            └── templates.ts     ← the four circuits and their solvers
```

## 3. The four templates

| # | Circuit | What it shows |
|---|---|---|
| 1 | One resistor | `I = U/R`. The base case; the sliders alone make the point. |
| 2 | Three in series | `R = R₁+R₂+R₃`, one current everywhere, voltage divides ∝ R |
| 3 | Three in parallel | `1/R = Σ1/Rᵢ`, one voltage everywhere, current divides ∝ 1/R |
| 4 | Mixed: R₁ in series with (R₂ ∥ R₃) | Both rules at once — the exam question |
| + | A switch in every template | Opens the loop; everything reads zero |

Each template is a fixed list of nodes and edges on a 2D schematic grid, with a closed-form
solver written next to it. Four solvers of three lines each beat one general solver nobody can
check.

**The lamp is template 1's load, not an extra series element in all four.** Putting a lamp in
series with every network changes `R_екв` and destroys exactly the clean textbook arithmetic the
scenario exists to verify — the worked example in §6 would stop coming out at `I = 0.6 А`.
Template 1 *is* the lamp, its resistance is the `R₁` slider, and that is where brightness ∝ P is
demonstrated.

## 4. The scene

Flat schematic on the XY plane, orthographic camera (`Camera.orthographic = true`), viewed down
−Z. It should read like a textbook diagram, not a 3D model of a breadboard.

- **Wires** — `LineRenderer` polylines along grid lines, right angles only.
- **Resistors** — the standard rectangle, each in its own colour, matching the coloured row for
  that element in the readout table. *No world-space labels*, for the reason given in
  [`TASK-optics-lenses.md`](TASK-optics-lenses.md) §3; the colour is the link between the shape
  and its numbers.
- **Battery** — the long/short line pair, labelled with the EMF.
- **Lamp** — a sphere whose `StandardMaterial.emissionColor` scales with `P = U·I`, normalised
  against the maximum the sliders allow. A `PointLight` at the same position, intensity likewise.
- **Switch** — a hinged segment that visibly lifts off its contact when open.
- **Meters** — *not built.* The readout table already gives `R`, `U`, `I` and `P` per element and
  a totals row, and a drawn needle would be a second, unlabelled copy of numbers that are already
  on screen — with a dial whose scale nobody can read without world-space text. The moving thing
  that shows current changing is the carrier stream, which is a better one: it is the current
  rather than a picture of a measurement of it. Worth revisiting once labels in the scene are
  solved.

## 5. Charge carriers

Small spheres travelling along the wire polylines, from − to +, with **speed ∝ I** and **spacing
∝ 1/I**. Pool them per edge; never create per frame.

**Check:** in the series circuit the carriers move at the same speed in every branch — including
"before" and "after" the resistor. Students expect the current to be "used up" by the resistor,
and this is the animation that contradicts it. Put a line in the readout saying so.

**Check:** in the parallel circuit, the branch with the smallest R carries the fastest, densest
stream, and the trunk carries the sum.

## 6. Controls and readouts

| Control | Range |
|---|---|
| Dropdown «Схема» | the four templates |
| Slider «ЕРС джерела U» | 1…24 В |
| Sliders «R₁», «R₂», «R₃» | 1…100 Ом (only those the template uses are shown) |
| Toggle «Вимикач» | open / closed |
| Toggle «Носії заряду», «Підписи» | |
| — | *(no voltmeter selector: every element's voltage is in the table at once)* |

Readout table, one row per element: `R`, `U`, `I`, `P`; plus a totals row with `R_екв`, `I`, and
`P` of the whole circuit.

**Check (series):** `U₁ + U₂ + U₃ = U_джерела`, and `I` is identical in all three rows.
**Check (parallel):** `I₁ + I₂ + I₃ = I_заг`, and `U` is identical in all three rows.
**Check (mixed):** with R₁ = 10, R₂ = R₃ = 20 and U = 12 В: `R₂∥R₃ = 10`, `R_екв = 20`,
`I = 0.6 А`, `U₁ = 6 В`, and R₂ and R₃ each carry 0.3 А.

All of the above are asserted by `validateSolver()` at load, and were run in Node before anything
drew. Measured there: series (12 В, 10/20/30 Ω) → R = 60, I = 0.2 A in all three elements,
U = 2 + 4 + 6 = 12; parallel (12 В, 10/20/20 Ω) → R = 5, U = 12 on every branch,
I = 1.2 + 0.6 + 0.6 = 2.4; mixed → exactly the numbers above; open switch → 0 A everywhere; and
R = 0 on all three branches clamps instead of producing `Infinity`.

**The numerical trap:** `R → 0` in a branch is a short circuit and `I → ∞`. The sliders start at
1 Ом so it cannot be reached, but the parallel solver still divides by a sum of reciprocals —
guard it, and if a template ever produces a current above a stated limit, clamp the display and
show «коротке замикання» rather than a number. A readout showing `Infinity` teaches nothing.

## 7. Notes for the implementer

- **Solve, then draw.** One function per template, `(U, R[]) → { perElement, totals }`, pure and
  checkable against §6's numbers. `Schematic.ts` reads its output and touches nothing else.
- **The open switch is a state, not a special case.** With the switch open, `I = 0` everywhere,
  the lamp is dark, the carriers stop, and the voltmeter across the open switch reads the full
  EMF — which is itself a good **Check**, and the one place a naive `I = U/R` implementation
  visibly falls over.
- **Out of scope:** capacitors and transients, AC, internal resistance of the source,
  Kirchhoff's laws on an arbitrary graph, semiconductor components. Internal resistance is the
  most tempting addition and would fit template 1 with one more slider; leave it for a follow-up
  so this scenario ships.
