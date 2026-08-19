# Engine gaps found while building scenarios

Things WebEngineTS cannot currently do that a scenario in this repository needed. This is the
handover list: CLAUDE.md rule 2 says rendering, math and scenario-runtime concerns belong in the
engine, and the umbrella task document says to report a missing capability rather than working
around it inside a scenario. So each entry says what was wanted, what actually happens, how it
was established, what the affected scenario does instead, and what an engine-side fix looks like.

**Every entry was established from the installed engine**, not assumed —
`node_modules/webenginets/dist/WebEngineTS.d.ts` for the API surface and `WebEngineTS.esm.js`
for behaviour. The engine tarball here can lag the one in virtual-lab, so re-check against a
newer build before acting on any of these.

Engine version these were found against: **`0.1.0-local.1786479071411`**.

---

## 1. `PhysicMaterial.friction` never reaches a contact

**Wanted:** a friction slider driving `PhysicMaterial(μ, 0)` on a block and a ramp, so the block
holds until `tan α > μ`.

**What happens:** friction is whatever `world.defaultContactMaterial` says — a hard-coded
**0.3** — regardless of the value set. The slider would move and change nothing.

**Why.** `PhysicMaterial` writes `friction` onto a cannon-es `Material`. cannon only reads a
material's friction through a `ContactMaterial` registered for that **pair** of materials:

```js
if (si.material && sj.material) {
    shapeContactMaterial = world.getContactMaterial(si.material, sj.material) || null;
}
this.currentContactMaterial = shapeContactMaterial || bodyContactMaterial || world.defaultContactMaterial;
```

and the engine never registers one — `addContactMaterial` has **zero call sites** in
`WebEngineTS.esm.js`; the single occurrence is cannon's own method definition. So
`getContactMaterial` always returns undefined and every contact falls through to the default,
which cannon constructs as `{ friction: 0.3, restitution: 0.0 }`.

**Affected:** any scenario with a friction or bounciness control. `mechanics-incline` integrates
`a = g(sin α − μ cos α)` itself instead — no loss there, since that equation is exact for an
inclined plane, but a scenario that genuinely needs emergent contact behaviour has no route.

**Engine-side fix:** register a `ContactMaterial` for each pair of `PhysicMaterial`s as they are
assigned (combining friction the way Unity does, by average or minimum), or at minimum expose
`world.defaultContactMaterial` so a scenario can set the global value.

---

## 2. `Slider` has no `setValueWithoutNotify`

**Wanted:** move a slider's handle to reflect state the scenario just changed itself, without
firing `onValueChanged`.

**What happens:** `Slider.value`'s setter always notifies when the stored value moves. `Toggle`
has `setIsOnWithoutNotify`, `Dropdown` and `Scrollbar` both have `setValueWithoutNotify` —
`Slider` is the one control in the family without the silent path, which is easy to discover only
by writing the call and getting `TS2339`.

**Affected:** every scenario using the shared `UIKit.ts`. `makeSlider` works around it with a
suppression flag: the row's value readout still refreshes, the caller's `onChange` does not fire,
and a scenario echoing a value it just set cannot drive itself in a loop.

**Engine-side fix:** add `setValueWithoutNotify(value: number)` to `Slider`, matching the three
controls that already have it.

---

## 3. `Texture2D.maxSize` silently does nothing on the KTX2 path

**Wanted:** the benchmark harness's size cap to apply whichever texture variant
`Resources.preferExtension` selected, so `maxSize` and `ktx2` are independent axes of the same
matrix.

**What happens:** with `preferExtension = ".ktx2"` the cap is ignored entirely. No error, no
warning, no `[Texture2D] Downscaled …` line — the texture simply arrives at full size.

**Why.** The decoder registered for `Texture2D` dispatches on the file extension:

```js
Resources.registerDecoder(Texture2D, [".png",".jpg",".jpeg",".webp",".gif",".ktx2"],
    async (bytes, path) => path.endsWith(".ktx2")
        ? Texture2D.fromKTX2ArrayBuffer(ab)
        : Texture2D.fromArrayBuffer(ab));
```

`fromArrayBuffer` decodes through an `Image` and resizes on a canvas when
`maxSize > 0 && (width > maxSize || height > maxSize)`. `fromKTX2ArrayBuffer` hands the buffer to
`KTX2Loader.parse` and wraps the result — it never reads `Texture2D.maxSize`. Which is
unsurprising, since a transcoded block-compressed texture cannot be resized on a 2D canvas; the
gap is that nothing says so.

**Measured**, on `Benchscene2_complexmodel` with three 2048×2048 maps, estimated texture VRAM:

| | `maxSize=0` | `maxSize=2048` | `maxSize=1024` |
|---|---|---|---|
| `ktx2=0` | 48.00 MB | 48.00 MB | **12.00 MB** |
| `ktx2=1` | 16.00 MB | 16.00 MB | 16.00 MB |

The whole bottom row is one number. A results table with a `maxSize` column and a `ktx2` column
will show three cells that look like "the cap did nothing here", and the reason is not in the
content.

(The top row's first two cells tie for a different and correct reason: the test is strictly
`>`, so a texture exactly at the cap is left alone. That one is content — the sources are
2048×2048 — not an engine gap.)

**Engine-side fix:** either apply the cap by dropping mip levels when transcoding — KTX2 carries
a mip pyramid, so selecting a smaller base level is the natural equivalent — or, at minimum, warn
once when `maxSize > 0` and a `.ktx2` is loaded, so a silent no-op becomes a visible one.

---

## How to add to this file

One section per gap, newest last, with the same five parts: what was wanted, what happens, why
(with the evidence — a file, a line, a grep result), what is affected and what the scenario does
instead, and what the engine-side fix would be. A gap without evidence is a rumour, and a gap
without a workaround note leaves the next person to rediscover it.
