# TASK — build the `AtomStructure` scenario

**Read [`TASK-catalogue-expansion.md`](TASK-catalogue-expansion.md) first.** It holds the
constraints shared by all eight, the `scenario.meta.json` shape, and the `UIKit.ts` factories.

**Deliverable:** `Scenarios/AtomStructure/` — «Будова атома». A periodic table you click, and the
selected element rendered as a nucleus with electron shells. The teaching point is the one
students reliably get wrong: **an isotope changes the nucleus, an ion changes the electrons.**

**This is the first scenario of the batch**, so it also carries the `UIKit.ts` extension
(§4 of the umbrella document). Write those factories here, well, and copy them forward.

## 1. What to create

```
Scenarios/AtomStructure/
├── scenario.meta.json           id: atom-structure, name: "Будова атома", category: education
└── scripts/
    ├── Scenario.ts              ← the single ScenarioBehaviour subclass
    ├── components/
    │   └── ElectronOrbit.ts     ← advances one electron along its shell
    ├── helpers/
    │   ├── UIKit.ts             ← copy from Molecules, + makeSlider/makeToggle/makeReadout
    │   ├── CameraSetup.ts       ← copy from Molecules
    │   ├── AtomBuilder.ts       ← nucleus, shells, electrons; rebuilt on selection
    │   └── TableLayout.ts       ← group/period → button position
    └── data/
        └── elements.ts          ← Z = 1…36, one record per element
```

## 2. The data is the scenario

`data/elements.ts` exports one record per element for **Z = 1…36 (H … Kr)**. Stop at krypton:
that covers every shell diagram a school course draws, and past it the filling exceptions
multiply into a table nobody here can check.

```ts
export interface ElementInfo {
    z: number;              // protons
    symbol: string;         // "Fe"
    name: string;           // "Ферум" — Ukrainian, IUPAC-Ukrainian naming
    mass: number;           // standard atomic weight, e.g. 55.845
    neutrons: number;       // most abundant isotope: round(mass) - z
    shells: number[];       // K, L, M, N occupancy, e.g. [2, 8, 14, 2]
    config: string;         // "1s² 2s² 2p⁶ 3s² 3p⁶ 3d⁶ 4s²"
    group: number;          // 1…18
    period: number;         // 1…4
    block: "s" | "p" | "d";
    category: string;       // "лужний метал", "інертний газ", …  → drives the table colours
    fact: string;           // one sentence, Ukrainian
}
```

**Store `shells` and `config` as literal data. Do not generate them from the aufbau rule.**
Chromium (Z = 24) is `[Ar] 3d⁵ 4s¹` and copper (Z = 29) is `[Ar] 3d¹⁰ 4s¹`; a generated table is
wrong precisely at the two elements a teacher points at. The same applies to `mass`: these are
measured standard atomic weights, not `2 × z`.

**Check:** the sum of `shells` equals `z` for all 36 records. Worth a one-off assertion at load
in development; a typo here is invisible on screen but wrong in the readout.

## 3. What is on screen

### The atom (centre)

- **Nucleus** — `z` red spheres and `neutrons` grey ones, packed into a cluster by a
  **deterministic** spherical Fibonacci distribution (golden angle), radius ∝ ∛(z + n). No
  randomness: the same element must produce the same nucleus every run (umbrella §2.6). Krypton
  is 36 + 48 = 84 spheres, which is nothing.
- **Shells** — one `Mesh.createTorus` ring per occupied shell, radii spaced so the outermost is
  still on screen for Kr. Tilt each ring differently (0°, 60°, −45°, 25° about X/Z) so four rings
  do not read as one disc.
- **Electrons** — small blue spheres, evenly spaced on their ring, angular speed falling with
  radius. One `ElectronOrbit` component per electron holding `{ shellIndex, phase, speed }`.
- Rebuild on selection. Do **not** cache 36 atoms: unlike `Molecules`, the nucleus of one atom is
  most of the object count, and rebuilding 84 spheres is cheaper than keeping 36 of them alive.

### The periodic table (UI, top)

18 columns × 4 rows of `Button`s, positioned by `TableLayout.ts` from `group` and `period` — not
by `GridLayoutGroup`, because the table's shape *is* its holes. Colour each button by `category`.

**Check:** period 1 shows hydrogen at group 1 and helium at group 18 with a gap between them;
period 4's d-block occupies groups 3…12. If the table has no gaps, the layout is wrong.

### Panels

- **Left** — symbol (large, accent colour), Ukrainian name, `Z`, mass number `A`, `config`,
  shell occupancy as `2, 8, 18, 7`, category, and `fact`.
- **Bottom-left** — the clicked particle: «протон», «нейтрон», «електрон (оболонка L)».
- **Bottom-centre** — the hint line, in the shape `Molecules` uses.

## 4. Controls

| Control | Range | Effect |
|---|---|---|
| Slider «Нейтронів (N)» | ±4 around the natural value | Adds/removes grey spheres. Updates `A = Z + N` and the isotope name («Карбон‑14»). |
| Slider «Заряд іона» | −3 … +3, `wholeNumbers` | Adds/removes outer-shell electrons. Updates the ion label («Na⁺», «Cl⁻»). |
| Toggle «Обертання» | — | Freezes the electrons. |
| Toggle «Модель орбіталей» | — | Swaps the rings for a point cloud (§5). |
| Buttons «◀ / ▶», keys ←/→ | — | Previous/next element. |

**Check — the whole point of the scenario:** moving the neutron slider changes `A` and the
nucleus and leaves the shell diagram identical; moving the charge slider changes the shells and
leaves the nucleus identical. If either slider touches both, the model is wrong.

**Check:** at charge +1 sodium shows `2, 8` — the neon configuration — and the readout says so.
At −1 chlorine shows `2, 8, 8`.

## 5. The orbital-cloud toggle

The Bohr rings are a lie students are told on purpose; the toggle is where the scenario admits
it. Replace the rings and electrons with an `InstancedMeshRenderer` of ~4000 tiny spheres, one
per sampled point:

- **s** — sample radius from a shell-appropriate radial distribution, direction uniform on the
  sphere.
- **p** — a two-lobed cloud along each of x, y, z (density ∝ cos²θ), one lobe pair per occupied
  p orbital.
- d-block elements may show their d electrons as a generic sphere; say so in the readout rather
  than drawing a wrong shape.

Seed the sampler with `z` so the cloud is identical every run. `InstancedMeshRenderer` exposes
`setInstanceTransform`, `setInstanceColor` and `apply` — build once per element, not per frame.

**Check:** the cloud has no sharp edge, and switching back and forth does not accumulate objects
(the old cloud must be destroyed, not hidden and re-created).

## 6. Notes for the implementer

- **Camera:** `createCameraRig({ useSkybox: false, orbitDistance: 12, orbitMaxDistance: 60 })`,
  and call `setOrbitDistance` on selection — hydrogen and krypton differ by a factor of three in
  drawn radius, and framing hydrogen at krypton's distance renders a dot.
- **Picking:** `Physics.raycast` with a reused `RaycastHit`, and a `Map<GameObject, ParticleKind>`
  filled by `AtomBuilder` — exactly the pattern in `Molecules/scripts/Scenario.ts:141`. Skip the
  raycast when `EventSystem.isPointerOverUI`, or clicking the periodic table also picks whatever
  is behind it.
- **Out of scope, and say so in the readout rather than faking it:** elements past Kr, hyperfine
  structure, nuclear binding energy, and any claim that the orbital cloud is to scale against the
  nucleus. It is not — a nucleus drawn to scale would be invisible, and the readout should state
  that ratio (~1:100 000) in words instead.
