# TASK — build the `Optics` scenario

**Read [`TASK-catalogue-expansion.md`](TASK-catalogue-expansion.md) first.**

**Deliverable:** `Scenarios/Optics/` — «Оптика: лінзи та дзеркала». An optical bench where the
student moves the object and changes the focal length, and the three principal rays construct the
image live. Every configuration in the textbook is reachable with two sliders.

## 1. What to create

```
Scenarios/Optics/
├── scenario.meta.json           id: optics-lenses, name: "Оптика: лінзи та дзеркала"
└── scripts/
    ├── Scenario.ts
    └── helpers/
        ├── UIKit.ts             ← copy
        ├── CameraSetup.ts       ← copy
        ├── Bench.ts             ← axis, arrows, F and 2F markers, the lens/mirror body
        └── Rays.ts              ← ray construction and the thin-lens solver
```

## 2. Sign convention — decide it once, state it in the code

Everything downstream is wrong if this is left implicit. Use the Cartesian convention the
Ukrainian school course uses:

- The optical axis is world **X**; light travels **+X**; the lens sits at `x = 0`.
- `d` — object distance, **positive** to the left of the lens.
- `d′` — image distance, **positive** to the right (a real image).
- `f` — **positive** for a converging lens (and a concave mirror), **negative** for a diverging
  lens (and a convex mirror).
- Thin lens / mirror equation: `1/f = 1/d + 1/d′` → `d′ = d·f / (d − f)`.
- Magnification `Γ = −d′/d`. Negative Γ means inverted.

Write these six lines as a comment block at the top of `Rays.ts`.

**The numerical trap:** at `d = f` the denominator is zero. Do not let it produce `Infinity` on
screen. Detect `|d − f| < ε`, draw the rays as parallel (no intersection), and print
«промені паралельні — зображення на нескінченності».

## 3. The scene

Flat, on the XY plane, viewed down −Z. Use `Camera.orthographic = true` with `orthographicSize`
covering the bench — a perspective camera makes a ray diagram lie, because two rays that meet on
screen may not meet in the plane. Lock the camera; pan and zoom only.

- **Optical axis** — a thin `LineRenderer` along X, with tick marks and F, 2F, −F, −2F labelled
  on both sides (world-space canvases, umbrella §5).
- **Object** — an upright arrow at `x = −d`, height `h`: a thin cylinder plus a cone tip.
- **Lens** — a real biconvex/biconcave profile, not a flattened sphere. Build it as a custom
  `Mesh`: sample the two circular arcs, extrude a few units in Z, set `vertices`/`triangles` and
  call `recalculateNormals`. `Mesh` has a public constructor and settable buffers, so this is
  ordinary code. Material: `StandardMaterial` with `renderMode = MaterialRenderMode.Transparent`,
  a pale blue albedo, high `smoothness`. **The shape carries the lesson** — a converging lens must
  be visibly thicker in the middle, a diverging one thinner.
- **Mirror mode** — the same solver, drawn as a curved arc with a hatched back.
- **Image** — an arrow, drawn **solid** when real and **translucent with a dashed outline** when
  virtual. This distinction is the second most common exam mistake after the sign of Γ.

## 4. The three principal rays

Drawn as `LineRenderer`s from the object's tip, in three distinct colours with a legend:

1. **Parallel to the axis → refracted through the far focus.**
2. **Through the optical centre → undeviated.**
3. **Through the near focus → refracted parallel to the axis.**

For a **virtual** image, extend the outgoing rays **backwards** as dashed lines to their
intersection, and draw those extensions in a dimmer tone — they carry no light, and a student who
cannot see which segments are real construction lines has learned the wrong thing.

Toggle «Всі промені»: a fan of ~15 rays from the tip through the lens aperture, all converging on
the same image point. **Check:** they meet at one point, the same point the three principal rays
found. That agreement *is* the proof the construction is not a special case.

## 5. Controls and readouts

| Control | Range |
|---|---|
| Slider «Фокусна відстань f» | −20 … 20 (0 excluded — skip over a dead band around zero) |
| Slider «Відстань до предмета d» | 1 … 60 |
| Slider «Висота предмета h» | 0.5 … 8 |
| Dropdown «Оптичний елемент» | Збиральна лінза / Розсіювальна лінза / Увігнуте дзеркало / Опукле дзеркало |
| Toggle «Всі промені», «Підписи», «Сітка» | — |

Readout panel, live: `1/f = 1/d + 1/d′`, with the numbers substituted; `d′`; `Γ`; and three
plain-language verdicts — «дійсне / уявне», «перевернуте / пряме», «збільшене / зменшене / рівне».

## 6. The cases that must be checked by hand

Set the sliders and confirm each; these are the rows of the textbook table.

| Case | Expected |
|---|---|
| `d > 2f` | Real, inverted, diminished; image between F and 2F on the far side |
| `d = 2f` | Real, inverted, **same size** (Γ = −1); `d′ = 2f` |
| `f < d < 2f` | Real, inverted, magnified; `d′ > 2f` |
| `d = f` | No image; parallel rays; the message from §2, no `Infinity` |
| `d < f` | **Virtual**, upright, magnified, on the same side as the object (a magnifying glass) |
| Diverging lens, any `d` | Always virtual, upright, diminished, between F and the lens |
| Concave mirror, `d < f` | Virtual, upright, magnified (a shaving mirror) |
| Convex mirror, any `d` | Always virtual, upright, diminished (a traffic mirror) |

**Check:** dragging `d` slowly across `f` shows the image sweep out to infinity on one side and
return from the other. That transition is the single most instructive thing in the scenario;
if it stutters or the arrow jumps, clamp the drawn image position rather than the physics, and
say so on screen.

## 7. Notes for the implementer

- **Recompute, don't animate.** Every slider change recomputes the whole diagram in one pass —
  there is no state to integrate. Keep `Rays.ts` a pure function `(f, d, h, kind) → geometry`;
  it is then trivially checkable against the table above.
- **Reuse the `LineRenderer`s.** Fixed set of lines, `setPositions` per update; do not destroy and
  recreate objects when a slider moves, or the scene-graph size becomes input-dependent
  (umbrella §2.6).
- **Out of scope:** chromatic aberration, thick lenses, lens-maker's formula from radii and n,
  total internal reflection. A second scenario on refraction and dispersion would be a good
  eleventh; do not smuggle it into this one.
