# TASK — build the `Crystals` scenario

**Read [`TASK-catalogue-expansion.md`](TASK-catalogue-expansion.md) first.**

**Deliverable:** `Scenarios/Crystals/` — «Кристалічні ґратки». Seven structures built from their
real lattice constants and bases, with the unit cell highlighted inside the extended lattice, and
a density computed from geometry that matches the handbook value.

**Cheapest of the eight.** It reuses `Molecules`' element colours and radii and its
sphere/cylinder builder almost unchanged; most of the work is the data table.

## 1. What to create

```
Scenarios/Crystals/
├── scenario.meta.json           id: crystal-lattices, name: "Кристалічні ґратки"
└── scripts/
    ├── Scenario.ts
    └── helpers/
        ├── UIKit.ts             ← copy
        ├── CameraSetup.ts       ← copy
        └── LatticeBuilder.ts    ← basis × cells → instances; bonds; the cell wireframe
    └── data/
        ├── elements.ts          ← colours and the two radii per element
        └── structures.ts        ← the eight structures, plus the guards
```

## 2. The structure table

```ts
export interface Structure {
    key: string;
    name: string;            // "Кухонна сіль (NaCl)"
    type: string;            // "Гранецентрована кубічна (ГЦК)"
    a: number;               // lattice constant, Å
    basis: { element: ElementKey; frac: [number, number, number] }[];
    coordination: number;    // coordination number
    perCell: number;         // formula units per unit cell, Z
    molarMass: number;       // g/mol per formula unit
    bonding: string;         // "іонний", "ковалентний", "металічний", "молекулярний"
    fact: string;            // one sentence, Ukrainian
}
```

**Eight** structures, not seven, chosen so all four bonding types and all three common metal
packings appear. The ρ column is not stored — it is **computed** (§4) and checked against these
values, and the last column is what the check produced:

| Structure | a (Å) | Type | CN | Z | ρ handbook | ρ computed |
|---|---|---|---|---|---|---|
| NaCl | 5.640 | ГЦК, йонна | 6 | 4 | 2.16 | 2.164 |
| CsCl | 4.110 | Проста кубічна, йонна | 8 | 1 | 3.99 | 4.027 |
| Алмаз (C) | 3.567 | Кубічна алмазна | 4 | 8 | 3.51 | 3.516 |
| Графіт (C) | a 2.460, c 6.708 | Гексагональна шарувата | 3 | 4 | 2.27 | 2.269 |
| Мідь (Cu) | 3.615 | ГЦК | 12 | 4 | 8.96 | 8.935 |
| Залізо α (Fe) | 2.866 | ОЦК | 8 | 2 | 7.87 | 7.878 |
| Магній (Mg) | a 3.209, c 5.211 | ГЩУ | 12 | 2 | 1.738 | 1.737 |
| Аргон (Ar) | 5.311 | ГЦК, молекулярна | 12 | 4 | 1.77 | 1.771 |

Every one lands within 1 %.

**Solid argon is the molecular crystal, not ice or CO₂.** Dry ice was tried first and its computed
density comes out around 1.65 against a handbook 1.56 — a 6 % gap that would look like a bug in
the very readout that exists to prove the arithmetic. Argon is a clean FCC of spherical atoms and
lands on 1.771 against 1.77. Magnesium is the eighth, added so the third close packing (HCP) is
present alongside FCC and BCC.

`Structure` carries both `a` and `c`; for cubic cells they are equal. Lattice vectors come from
`latticeVectors()`, which is also what makes the hexagonal cells work.

## 3. What is on screen

- **The lattice** — basis translated over `n × n × n` cells, `n` from a slider (1…5). At n = 5
  and NaCl that is 1000 ions: one `InstancedMeshRenderer` per element, `setInstanceTransform` +
  `setInstanceColor`, one `apply()` after the build. Rebuild only when the structure or `n`
  changes.
- **Bonds** — cylinders between neighbours closer than a per-structure cutoff, drawn only for
  n ≤ 3. Past that they are visual noise and there are thousands of them. Say so in the toggle's
  label rather than silently doing nothing («Зв'язки — до 3 комірок»).
- **The unit cell** — a `LineRenderer` wireframe box around one cell at the origin, with the
  atoms inside it drawn at full brightness and the rest dimmed. This is the toggle students need
  most: the cell is invisible inside a lattice until you outline it.
- **Cross-section** — a slider that hides every instance with `x > threshold`, cutting the block
  open. Cheap (skip the instance, shrink `count`) and it is the only way to see the interior of a
  five-cell block.

## 4. Density, computed on screen

```
ρ = Z · M / (N_A · a³)
```

with `a` in cm. Show the substituted numbers and the result in г/см³ next to the handbook value
from the table above.

**Check:** NaCl gives ≈ 2.16, Cu ≈ 8.96, Fe ≈ 7.87, diamond ≈ 3.51. If a structure is out by a
factor of 2 or 4, `perCell` counts atoms where it should count formula units — that is the
classic error, and it is exactly what this readout exists to expose.

**Check:** the coordination number readout matches what is on screen. Turn on bonds and count what
touches an ion: six for NaCl, eight for CsCl, twelve for copper. The readout must be verifiable by
counting, or it is decoration.

`validateStructures()` counts the same thing at load, over ±2 cells, for **every** basis atom of
every structure — and this caught a real mistake. `latticeVectors()` builds a hexagonal cell with
a₁ and a₂ **60°** apart, while the basis had been written for the usual 120° setting. Graphite came
out with one neighbour instead of three and magnesium with ten instead of twelve, and both still
looked entirely plausible on screen. The honeycomb partner and the HCP second atom belong at
(1/3, 1/3) in a 60° cell, not (1/3, 2/3).

## 5. Ball-and-stick versus space-filling

A toggle, «Іонні радіуси», that switches between:

- **ball-and-stick** — small spheres at a fixed radius, bonds visible, geometry legible;
- **space-filling** — every ion at its true relative radius, touching its neighbours, no gaps.

**Check:** in space-filling NaCl, the chloride ions (1.81 Å) dwarf the sodium ions (1.02 Å) and
the sodium ions sit in the holes between them. A student who has only ever seen ball-and-stick
believes an ionic crystal is mostly empty space; this toggle is the correction.

## 6. Controls

| Control | Range |
|---|---|
| Dropdown «Структура» | the seven |
| Slider «Розмір ґратки n» | 1…5, whole numbers |
| Slider «Розріз» | 0…100 % |
| Toggle «Елементарна комірка» | |
| Toggle «Зв'язки» (n ≤ 3) | |
| Toggle «Іонні радіуси» | |
| Toggle «Обертання» | |

Readout panel: name, bonding type, lattice type, `a`, coordination number, atoms per cell,
computed ρ, and the fact line. Click any ion → its element name and radius.

## 7. Notes for the implementer

- **Frame on selection.** `setOrbitDistance` scaled by `n · a`; a five-cell caesium chloride and a
  one-cell diamond differ by an order of magnitude.
- **Fractional coordinates only in the data.** `frac × a` happens in the builder. Storing world
  positions makes the table unreadable and unverifiable against any reference.
- **Out of scope:** X-ray diffraction and Bragg's law, defects and dislocations, Miller indices,
  hexagonal close packing beyond graphite. Miller indices would be a natural sequel and would
  reuse the cross-section slider.
