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
| + | A lamp and a switch in every template | Brightness ∝ P; the switch opens the loop |

Each template is a fixed list of nodes and edges on a 2D schematic grid, with a closed-form
solver written next to it. Four solvers of three lines each beat one general solver nobody can
check.

## 4. The scene

Flat schematic on the XY plane, orthographic camera (`Camera.orthographic = true`), viewed down
−Z. It should read like a textbook diagram, not a 3D model of a breadboard.

- **Wires** — `LineRenderer` polylines along grid lines, right angles only.
- **Resistors** — the standard rectangle, drawn as a flattened box, with a world-space label
  showing `R`, `U` and `I` for that element (umbrella §5).
- **Battery** — the long/short line pair, labelled with the EMF.
- **Lamp** — a sphere whose `StandardMaterial.emissionColor` scales with `P = U·I`, normalised
  against the maximum the sliders allow. A `PointLight` at the same position, intensity likewise.
- **Switch** — a hinged segment that visibly lifts off its contact when open.
- **Meters** — an ammeter in series and a voltmeter across a selectable element, drawn as circles
  with a needle that sweeps to the reading. A needle is worth the trouble: a number changing is
  not the same lesson as a needle moving when a slider does.

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
| Dropdown «Вольтметр на…» | which element the voltmeter measures |

Readout table, one row per element: `R`, `U`, `I`, `P`; plus a totals row with `R_екв`, `I`, and
`P` of the whole circuit.

**Check (series):** `U₁ + U₂ + U₃ = U_джерела`, and `I` is identical in all three rows.
**Check (parallel):** `I₁ + I₂ + I₃ = I_заг`, and `U` is identical in all three rows.
**Check (mixed):** with R₁ = 10, R₂ = R₃ = 20 and U = 12 В: `R₂∥R₃ = 10`, `R_екв = 20`,
`I = 0.6 А`, `U₁ = 6 В`, and R₂ and R₃ each carry 0.3 А. Those numbers are the acceptance test —
put them in a comment in `templates.ts`.

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
