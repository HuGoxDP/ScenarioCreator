# TASK — build the `UIShowcase` scenario

**Origin:** WebEngineTS, 2026-08-04. The Canvas UI toolkit was rewritten and extended over
seventeen commits (`ef385e1` … `5a85746`). Every feature has unit tests, but nothing exercises
them *together*, on screen, where a human can click them. That demo belongs here, not in the
engine: the engine repo is engine-only, and a first attempt to put it there was removed for
exactly that reason.

**Deliverable:** one scenario, `Scenarios/UIShowcase/`, that puts every new UI feature on a page
you can interact with, so a reviewer can confirm each one works rather than trusting a test name.

---

## 1. What to create

```
Scenarios/UIShowcase/
└── scripts/
    ├── Scenario.ts              ← the single ScenarioBehaviour subclass
    ├── helpers/
    │   ├── Showcase.ts          ← page host, nav bar, status line
    │   ├── Build.ts             ← node/place/label/panel/button helpers
    │   └── Textures.ts          ← procedurally generated sprites
    └── pages/
        ├── AnchorsPage.ts
        ├── TransformPage.ts
        ├── LayoutPage.ts
        ├── ImagesPage.ts
        ├── TextPage.ts
        ├── ControlsPage.ts
        ├── ScrollPage.ts
        └── InteractionPage.ts
```

A directory under `Scenarios/` is only discovered by the builder if it contains `scripts/`, so
the folder is inert until that exists.

Build with `npm run build` from the repo root; the archive lands in
`ReleaseScenarios/UIShowcase.zip`.

## 2. Hard constraints

These are the ones that are easy to break here specifically.

1. **Exactly one `class … extends ScenarioBehaviour`** in the whole scenario. The builder greps
   for it and fails the build on zero or several matches. Put it in `Scenario.ts`; every page
   module must export plain functions, not behaviours.
2. **Content only.** No benchmark harness, no timing code, no optimization toggles. Performance
   measurement lives in the engine's own harness and a scenario that measures itself invalidates
   it.
3. **No assets.** Generate every sprite procedurally at load (see §4). The scenario must ship as
   a ZIP with no image files, which also keeps it immune to the asset-pipeline work in flight.
4. **No engine code.** If something is missing from the engine API, say so in the handover rather
   than working around it inside the scenario.

## 3. Engine version

The engine tarball already installed here (`node_modules/webenginets`) was verified on
2026-08-04 to contain the **full** new API — `Slider`, `Toggle`, `ToggleGroup`, `Scrollbar`,
`Dropdown`, `ScrollRect`, `RectMask2D`, `CanvasGroup`, the layout groups, `ContentSizeFitter`,
`Sprite`/`SpriteBorder`, `ImageType`, radial fill, `SelectableTransition`, `ColorBlock`,
`SpriteState`, `Navigation`, focus and `EventSystem.keyboardNavigation`.

No `release:local` is required. If a symbol turns out to be missing anyway, re-run
`npm run release:local` in WebEngineTS before treating it as an engine bug — and note that
`SelectableTransition` and friends are **enums**, so a `grep "class X"` check will report them
missing when they are present.

## 4. Procedural sprites (`helpers/Textures.ts`)

Draw into an offscreen `<canvas>`, then copy into a `Texture2D` through `setPixel` + `apply` —
public API only, no reaching into engine internals.

| Sprite | Size | Purpose |
|---|---|---|
| Panel | 48×48 | Rounded box with a bright 4px border, `border.setAll(16)`. Proves nine-slice keeps its corners. |
| Tile | 16×16 | Diagonal stripe. Tiling is only obvious if the seam would show. |
| Atlas | 128×32 | Four 32×32 numbered cells in different colours. Each demo sprite names one cell. |
| Disc | 64×64 | Flat circle. Radial fills read clearly against a known shape. |

## 5. Pages

One page per feature group, switched by a top nav bar of `Button`s. Build each page on first
visit and keep it — switching away and back must not reset state a reviewer just set up.

### AnchorsPage
- Nine boxes on the nine anchor presets inside one parent. **Check:** resize the window; each
  stays welded to its corner.
- Three boxes at increasing `anchoredPosition.y`, labelled with their value. **Check:** larger Y
  is visibly *lower* — the Y-down contract.
- A stretched box using `offsetMin` / `offsetMax` as margins.
- A header placed with `setInsetAndSizeFromParentEdge(RectTransformEdge.Top, …)` plus
  `setSizeWithCurrentAnchors`. **Check:** `Top` is the *upper* edge, inverting Unity.

### TransformPage
- A parent box with a child offset to its right. Sliders drive `localRotation`, `localScale` and
  the child's own `localRotation`.
- **Check:** a positive angle turns **clockwise**; the child orbits with the parent; clicking the
  child still works while rotated (hit-testing goes through the inverse transform); a readout of
  `getScreenRect` shows the AABB growing as it turns.

### LayoutPage
- `VerticalLayoutGroup` with `LayoutElement.preferredHeight`, the last row `flexibleHeight = 1`.
- `HorizontalLayoutGroup` with `childForceExpandWidth`.
- A group with `childAlignment = LayoutAnchor.LowerRight`.
- `GridLayoutGroup`, `FixedColumnCount = 4`, twelve numbered cells.
- `ContentSizeFitter` on a label with a button that appends words. **Check:** the box grows to
  the text rather than clipping it.

### ImagesPage
- Four `UIImage`s, each a different 32×32 cell of the **same** atlas texture.
- The panel sprite drawn `Sliced` at four different sizes, next to the same sprite drawn `Simple`
  for contrast. **Check:** corners stay 16px in the first, smear in the second.
- The tile sprite drawn `Tiled`.
- Five discs: `Horizontal`, `Vertical`, `Radial90`, `Radial180`, `Radial360`, with a shared
  `fillAmount` slider and a `fillClockwise` toggle. **Check:** clockwise on screen is
  *increasing* angle.
- One box with `borderRadius` to show it clips sprites and solid fills alike.

### TextPage
- A narrow box holding a very long unbroken word. **Check:** it splits between characters instead
  of running off the edge.
- Three boxes with the same text at `TextOverflow.Clip`, `.Ellipsis`, `.Overflow`.
- A label with buttons that lengthen the text and raise the font size, printing
  `preferredWidth` / `getPreferredHeight` live.
- One label with `outlineWidth` set, for legibility over a bright scene.

### ControlsPage
- `Button`: normal / hover / pressed, one disabled with a button that toggles it, and **two**
  listeners on the same `onClick` (the old single-callback API silently lost the first).
- `Slider` in all four directions; the vertical pair with `wholeNumbers`.
- A standalone `Toggle`, plus three in a `ToggleGroup` with `borderRadius` set so they read as
  radio buttons. **Check:** the last selection cannot be cleared by clicking it.
- `Dropdown` with seven options and `maxVisibleItems = 4`. **Check:** the list scrolls to the
  current selection when opened, and rows below the closed field are clickable.
- `VirtualJoystick` with a live value readout. **Check:** its corners are *not* clickable.

### ScrollPage
- `ScrollRect` + `RectMask2D` over a `VerticalLayoutGroup` of ~24 rows, each row a `Button`, with
  a `ContentSizeFitter` sizing the content.
- A `Scrollbar` wired both ways: bar → `verticalNormalizedPosition`, view →
  `setValueWithoutNotify` (silent, or the two fight), and `bar.size` from
  `getScrollableSize`.
- **Check:** clipped rows cannot be clicked; elastic overshoot rubber-bands and springs back;
  a flick coasts and then stops dead at the end with no residual drift; pressing the bar's track
  pages rather than jumping.

### InteractionPage
- A `CanvasGroup` over a panel containing a button, with an `alpha` slider and `interactable` /
  `blocksRaycasts` toggles, and a second button placed *behind* it. **Check:** `interactable`
  off is still modal; `blocksRaycasts` off lets the pointer reach the button behind.
- A draggable box logging every pointer event by name. **Check:** a short press is a click; past
  the threshold it becomes a drag and **no click follows**; `delta` is per-frame.
- Two composed buttons — a `Button` whose visuals come from a child `UIImage` set as
  `targetGraphic` — one on `SelectableTransition.ColorTint` with `fadeDuration` (the tint should
  visibly *fade*, not snap) and one on `SpriteSwap`.
- A row of five buttons for keyboard navigation. **Check:** Tab cycles, arrows move by position,
  Enter/Space activates, Escape drops focus, and a disabled control is skipped.

## 6. Status line

A persistent line at the bottom, updated every frame, showing: frame count, repaint count,
`Canvas.drawnGraphicCount`, canvas size and `scaleFactor`, `EventSystem.isPointerOverUI`,
`Touch.count`, and the name of `EventSystem.currentSelected`.

Set `Canvas.repaintMode = Always` so the readouts cannot be mistaken for a stalled canvas, and
say so in a comment — flipping it to `OnDemand` is itself worth demonstrating, since the repaint
counter should then stop climbing when nothing moves.

## 7. Notes for the implementer

- **`Scenarios/Molecules/scripts/helpers/UIKit.ts` already solves the anchor ergonomics** and
  documents the Y-down convention. Reuse its `Anchor` preset idea rather than reinventing it, but
  do not import across scenarios — copy what is useful into `helpers/Build.ts`. Its own comments
  predate `offsetMin`/`offsetMax` and the layout groups, so do not treat it as current.
- Prefer many small pages over one dense screen. The point is that each feature can be confirmed
  *individually*; a reviewer who cannot tell which control proves which claim gets nothing from
  the demo.
- Every "**Check:**" above is the observable that makes the feature verifiable. If a page cannot
  show its check, the page is not finished.
- Mobile is worth one pass: two-finger interaction (drag a box with one thumb while moving a
  slider with the other) is a real feature of the new EventSystem and only testable by hand.
