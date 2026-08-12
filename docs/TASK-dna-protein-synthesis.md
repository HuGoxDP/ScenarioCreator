# TASK — build the `DNA` scenario

**Read [`TASK-catalogue-expansion.md`](TASK-catalogue-expansion.md) first.**

**Deliverable:** `Scenarios/DNA/` — «ДНК і синтез білка». A B-DNA double helix built from real
geometry, which unwinds into transcription and then translation, one codon at a time, against
the full genetic code table.

## 1. What to create

```
Scenarios/DNA/
├── scenario.meta.json           id: dna-protein-synthesis, name: "ДНК і синтез білка"
└── scripts/
    ├── Scenario.ts              ← the single ScenarioBehaviour subclass; owns the step machine
    ├── helpers/
    │   ├── UIKit.ts             ← copy (with the factories from atom-structure)
    │   ├── CameraSetup.ts       ← copy
    │   ├── HelixBuilder.ts      ← backbones, base pairs, unwinding
    │   └── Ribosome.ts          ← ribosome, tRNA arrivals, growing peptide
    └── data/
        ├── genetic-code.ts      ← all 64 codons
        └── sequences.ts         ← three short template strands
```

## 2. Geometry — B-DNA, not "a spiral"

Build from the real numbers, and put them in a comment where the builder reads them:

| Quantity | Value |
|---|---|
| Rise per base pair | 3.4 Å |
| Base pairs per turn | 10.5 (→ 34.3° per bp) |
| Helix diameter | 20 Å |
| Strand offset | the two backbones are **not** 180° apart — offset them ~120°/240° |

That last row is what produces the major and minor grooves. Place the backbones opposite each
other and the model looks like a ladder twisted at random; place them at 120°/240° and the
grooves appear on their own.

Use the same Å → world scale trick as `Molecules` (`SCALE`, exported) so the camera can frame by
real size.

- **Backbones** — two `LineRenderer`s through the phosphate positions, or cylinders between
  successive nodes if the line caps read badly. `LineRenderer` has `positions`, `setPosition` and
  `numCornerVertices`, so a smooth ribbon is one call per frame during unwinding.
- **Bases** — one cylinder per base from its backbone toward the axis, meeting its partner in the
  middle. Colours: A green, T red, G orange, C blue; U (in mRNA) a lighter red than T, so the
  substitution is visible at a glance.
- **Hydrogen bonds** — thin dashed sticks between partners: **two** for A–T, **three** for G–C.
  **Check:** count them on screen. This is the reason G–C rich DNA is harder to melt, and the
  readout should say so when a G–C pair is selected.
- Click a base → readout: letter, full name («аденін»), its partner, and the bond count.

## 3. Modes and the step machine

Two modes, chosen by tabs: «Транскрипція» and «Трансляція». Both are driven by one step counter
so «Далі», «Назад», «Авто» and the speed slider work identically in each.

### Транскрипція

1. Idle: the full helix rotates slowly.
2. A window of ~8 bp unwinds — interpolate the two strands apart over ~1 s, easing.
3. RNA polymerase (a translucent rounded body) travels along the template strand.
4. The mRNA strand grows behind it, one base per step, complementary to the template.
5. The window closes behind the polymerase as the mRNA peels away.

**Check — the mistake this scenario exists to prevent:** every A on the template produces **U**
in the mRNA, never T. Step through a template containing A and read the new base. A second check:
the mRNA is complementary to the *template* strand and therefore identical (bar T→U) to the
*coding* strand — label both strands on screen so that is visible rather than asserted.

### Трансляція

6. The mRNA moves to a clear area; the ribosome (two rounded blobs, large and small subunit)
   attaches at the start codon.
7. Per step: a tRNA arrives carrying an amino acid, its anticodon pairs with the current codon,
   the amino acid joins the chain, the tRNA leaves and the ribosome advances three bases.
8. The peptide grows as a chain of coloured beads, one per amino acid, labelled with the
   three-letter code.
9. A stop codon terminates: no tRNA arrives, the subunits separate, the peptide is released.

**Check:** the chain stops at UAA, UAG or UGA and the readout names which one. **Check:** the
first amino acid is methionine (AUG), and the readout says the start codon is also a codon for
Met.

## 4. Data

`genetic-code.ts` — all **64** codons mapped to `{ code3: "Met", name: "Метіонін", stop?: true }`.
Store the whole table; deriving it from wobble rules produces a table nobody can proofread.

`sequences.ts` — three template strands, 45–75 bases (15–25 codons), each with a start codon, no
premature stop, and a real stop at the end. Give each a Ukrainian title and a sentence of
context. Keep them short enough that a student can step through one in a minute.

## 5. UI

- **Bottom strip** — the sequence in a monospace-ish layout, the current codon highlighted, the
  already-translated part dimmed. This is the scenario's most-read element; give it room.
- **Right panel** — the codon table, four columns by the first base and sixteen rows by the
  second and third, with the current codon highlighted.

  *Built differently from how this section first specified it.* The original called for a
  `ScrollRect` + `RectMask2D` auto-scrolled to the current codon. All 64 cells turn out to fit on
  screen at once in the textbook's own 4×16 layout, which removes the scrolling, the two-way
  scrollbar wiring and the class of bugs that comes with it — and lands on the arrangement
  students have already seen in print. The `ScrollRect` demonstration belongs in
  [`TASK-ui-showcase.md`](TASK-ui-showcase.md), which exists for exactly that.
- **Left panel** — current step, its explanation in one sentence, and the growing peptide as text.
- **Controls** — «◀ Крок», «Крок ▶», «Авто ▶/⏸», speed slider (0.25×…4×), «Скинути»,
  toggle «Водневі зв'язки», dropdown of the three sequences.

## 6. Notes for the implementer

- **Object budget.** A 75-base helix is ~150 bases + ~150 backbone segments + bonds. Build it
  once per sequence and animate transforms; never rebuild per step. tRNAs are pooled — three
  instances reused, not one per codon, or a 25-codon run leaks 25 objects.
- **Unwinding is interpolation, not physics.** Keep both the wound and unwound positions per base
  and lerp; do not run a rigid-body simulation of a helix.
- **Out of scope, with reasons worth stating in the handover:** replication (a second polymerase
  and a lagging strand double the step machine, and the pedagogy here is the codon table);
  splicing and introns (the sequences are deliberately intron-free — say so on screen, or a
  biology teacher will notice the omission and assume it is an error); protein folding.
