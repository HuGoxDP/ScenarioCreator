# Engine gaps found while building scenarios

Things WebEngineTS could not do that a scenario in this repository needed. This is the handover
list: CLAUDE.md rule 2 says rendering, math and scenario-runtime concerns belong in the engine,
and the umbrella task document says to report a missing capability rather than working around it
inside a scenario. So each entry says what was wanted, what actually happens, how it was
established, what the affected scenario does instead, and what an engine-side fix looks like.

**Entries are kept after they are fixed, with the fix recorded.** Deleting one would lose the
reason a scenario is shaped the way it is, and invite the next person to re-derive it from
scratch.

**Every entry was established from the installed engine**, not assumed —
`node_modules/webenginets/dist/WebEngineTS.d.ts` for the API surface and `WebEngineTS.esm.js`
for behaviour, with a behavioural check in a real browser where behaviour was the claim.

| | found against | status against `0.1.0-local.1787254037912` |
|---|---|---|
| 1. `PhysicMaterial.friction` never reaches a contact | `0.1.0-local.1786479071411` | **fixed** |
| 2. `Slider` has no `setValueWithoutNotify` | `0.1.0-local.1786479071411` | **fixed** |
| 3. `maxSize` does nothing on the KTX2 path | `0.1.0-local.1786479071411` | **half** — no longer silent, still a no-op |
| 4. Four `Mesh.create*` primitives are wound inside out | `0.1.0-local.1787254037912` | **fixed** — shared registry `G1` |
| 5. Every texture from `Resources` is tagged sRGB | `0.1.0-local.1787254037912` | **fixed** — shared registry `G3` |

---

## 1. `PhysicMaterial.friction` never reaches a contact — **FIXED**

**Wanted:** a friction slider driving `PhysicMaterial(μ, 0)` on a block and a ramp, so the block
holds until `tan α > μ`.

**What happened:** friction was whatever `world.defaultContactMaterial` said — a hard-coded
**0.3** — regardless of the value set. The slider moved and changed nothing.

**Why.** `PhysicMaterial` wrote `friction` onto a cannon-es `Material`, but cannon only reads a
material's friction through a `ContactMaterial` registered for that **pair** of materials:

```js
if (si.material && sj.material) {
    shapeContactMaterial = world.getContactMaterial(si.material, sj.material) || null;
}
this.currentContactMaterial = shapeContactMaterial || bodyContactMaterial || world.defaultContactMaterial;
```

and the engine never registered one — `addContactMaterial` had **zero call sites** in
`WebEngineTS.esm.js`, the single occurrence being cannon's own method definition.

**The fix**, in the engine: `Physics._registerMaterial` now pairs each material with every other
one already known **and with itself** — two objects sharing a material still need a pairing —
combining by average, which is Unity's default:

```js
_pair(a, b) {
    const contact = new ContactMaterial(a._cannonMaterial, b._cannonMaterial, {
        friction: (a.friction + b.friction) / 2,
        restitution: (a.bounciness + b.bounciness) / 2,
    });
    this._world.addContactMaterial(contact);
}
```

`Physics.defaultFriction` is now exposed too, for the case of a collider with no material at all;
it reads 0.3.

**Verified behaviourally**, headless, a block released on a 30° ramp with matching materials on
both surfaces:

| μ | distance travelled |
|---|---|
| 0.05 | 9.56 |
| 0.90 | 2.15 |

Before the fix these two numbers were identical, because both contacts took the default. (The
probe includes an initial drop onto the ramp, so it shows that friction *changes the motion* —
it is not a measurement of the `tan α > μ` threshold.)

**Effect on this repository:** `mechanics-incline` still integrates
`a = g(sin α − μ cos α)` itself, but the reason changed and is now stated in
`Scenarios/Mechanics/scripts/helpers/Slide.ts`: that equation is *exact* for an inclined plane,
so routing it through a contact solver would replace an exact answer with an approximate one, in
a scenario whose whole readout is the agreement between integrated and textbook values. A
scenario needing genuinely emergent contact behaviour now has a route it did not have.

---

## 2. `Slider` has no `setValueWithoutNotify` — **FIXED**

**Wanted:** move a slider's handle to reflect state the scenario just changed itself, without
firing `onValueChanged`.

**What happened:** `Slider.value`'s setter always notified when the stored value moved. `Toggle`
had `setIsOnWithoutNotify`, `Dropdown` and `Scrollbar` both had `setValueWithoutNotify` —
`Slider` was the one control in the family without a silent path, discoverable only by writing
the call and getting `TS2339`.

**The fix:** `Slider.setValueWithoutNotify(value: number)` exists, matching the other three.

**Effect on this repository:** the workaround is gone. `makeSlider` in the shared `UIKit.ts` used
to carry a suppression flag — the listener fired but skipped the caller's `onChange` — and now
calls the real method. All eight copies of `UIKit.ts` were updated together and remain
byte-identical to each other. (`Molecules` keeps the older, smaller UIKit; it has no sliders.)

Checked before removing it: virtual-lab's own engine tarball is the **same** build
(`0.1.0-local.1787254037912`) and has the method, so a scenario using it cannot compile here and
fail there. That check is the one CLAUDE.md asks for whenever the two tarballs might diverge.

---

## 3. `maxSize` does nothing on the KTX2 path — **HALF FIXED**

No longer silent. Still a no-op.

**Wanted:** the benchmark harness's size cap to apply whichever texture variant
`Resources.preferExtension` selected, so `maxSize` and `ktx2` are independent axes of the same
matrix.

**What happens:** with `preferExtension = ".ktx2"` the cap is still ignored — the texture arrives
at its authored resolution however the cap is set. What changed is that the engine now **says
so**: `fromKTX2ArrayBuffer` calls `Texture2D._warnMaxSizeIgnoredOnce()`, and its doc comment
states the limitation and the reason outright ("selecting a smaller mip level from the container
instead is not implemented").

**Why.** The decoder registered for `Texture2D` dispatches on the file extension:

```js
Resources.registerDecoder(Texture2D, [".png",".jpg",".jpeg",".webp",".gif",".ktx2"],
    async (bytes, path) => path.endsWith(".ktx2")
        ? Texture2D.fromKTX2ArrayBuffer(ab)
        : Texture2D.fromArrayBuffer(ab));
```

`fromArrayBuffer` decodes through an `Image` and resizes on a canvas when
`maxSize > 0 && (width > maxSize || height > maxSize)`. `fromKTX2ArrayBuffer` hands the buffer to
`KTX2Loader.parse` and wraps the result. A transcoded block-compressed texture cannot be resized
on a 2D canvas, so this is a real constraint rather than an oversight.

**Measured**, on `Benchscene2_complexmodel` with three 2048×2048 maps, estimated texture VRAM —
re-run against the current build and unchanged from the previous one:

| | `maxSize=0` | `maxSize=2048` | `maxSize=1024` |
|---|---|---|---|
| `ktx2=0` | 48.00 MB | 48.00 MB | **12.00 MB** |
| `ktx2=1` | 16.00 MB | 16.00 MB | 16.00 MB |

The whole bottom row is still one number, and the warning now fires once on the first cell where
`ktx2=1` meets `maxSize > 0`. A results table with a `maxSize` column and a `ktx2` column still
shows three cells where the cap did nothing — but the console now explains why, which is the
difference between a puzzle and a footnote.

(The top row's first two cells tie for a different and correct reason: the test is strictly
`>`, so a texture exactly at the cap is left alone. That one is content — the sources are
2048×2048 — not an engine gap.)

**What would close it:** apply the cap by selecting a smaller mip level when transcoding. KTX2
carries a mip pyramid, so choosing a smaller base level is the natural equivalent of the canvas
resize on the image path.

---

## 4. `Mesh.createCylinder`, `createCapsule`, `createTorus` and `createPlane` are wound inside out — **FIXED**

**Wanted:** a primitive from `Mesh.create*` to render as a solid object.

**What happens:** four of the seven builders emit triangle indices whose winding is **opposite to
the vertex normals they store alongside them**. three.js draws with `side: FrontSide` by default,
so those faces are back-face culled: the object is drawn only where you are looking at its far
inner surface. On screen it reads as a hollow shell with a dark interior — or, for a plane, as
nothing at all.

**Measured**, by generating each mesh and comparing every face's geometric normal
(`(b−a) × (c−a)`) against the mean of its three stored vertex normals:

| builder | triangles | facing out | facing in | degenerate |
|---|---|---|---|---|
| `createCube(1)` | 12 | 12 | 0 | 0 |
| `createSphere(0.5, 16)` | 256 | 224 | 0 | 32 |
| `createQuad(1, 1)` | 2 | 2 | 0 | 0 |
| `createCylinder(0.4, 1, 16)` | 64 | 32 | **32** | 0 |
| `createCapsule(0.3, 1, 12)` | 216 | 48 | **144** | 24 |
| `createTorus(0.4, 0.15, 16, 24)` | 768 | 0 | **768** | 0 |
| `createPlane(4, 4)` | 2 | 0 | **2** | 0 |

Narrowed by index range: in `createCylinder` it is **only the side wall** — both caps are correct,
which is why a cylinder renders as an open tube with its lids intact. `createCapsule` is inverted
across the hemispheres and part of the body. `createTorus` and `createPlane` are inverted whole.

`createPlane` is small enough to show in full — vertices `(-2,-2,0) (2,-2,0) (-2,2,0) (2,2,0)`,
normals `(0,0,1)`, indices `0,2,1  2,3,1`. Triangle `(0,2,1)` gives `(0,4,0) × (4,0,0) =
(0,0,−16)`, pointing away from the stored `+Z`. The correct indices are `0,1,2  2,1,3`.

**Not a regression.** The identical audit run against the previous build,
`0.1.0-local.1786479071411`, produces exactly the same counts. Both engines have always done
this; it simply had not been looked at.

**Affected here** (production catalogue first):

| scenario | primitive | what it looks like |
|---|---|---|
| `Molecules` | `createCylinder` bonds | bonds hollow |
| `DNA` | `createCylinder` bases, backbone sticks | as above |
| `Crystals` | `createCylinder` instanced bonds | as above |
| `AtomStructure` | `createTorus` electron shells | shells invisible from most angles |
| `solar-system-scenario` | `createTorus` orbit rings / Saturn ring | as above |
| `Benchscene1_N*` | cylinder, capsule, torus **and the floor plane** | see below |
| `Benchscene3_solarsystem` | `createTorus` orbit rings | as above |

**No content workaround exists.** `doubleSided` is a field of `IShaderSource` — the custom-shader
descriptor — and is not exposed on `StandardMaterial`, so a scenario cannot ask for both faces to
be drawn. The only alternative would be for every scenario to hand-build the meshes `Mesh.create*`
exists to provide.

**FIXED in `0.1.0-local.1787378941484`**, and registered as `G1` in the shared registry. The
winding was corrected in all four builders; the engine also found a second defect in
`createCapsule`, whose middle rings were ordered bottom-up between hemispheres ordered top-down,
so one index grid stitched non-adjacent rings. The audit below is now pinned in the engine as
`tests/PrimitiveWinding.test.ts`.

Re-run against the fixed build — every builder, zero inverted faces:

| builder | triangles | facing out | facing in |
|---|---|---|---|
| `createCube` / `createSphere` / `createQuad` | 12 / 256 / 2 | all | 0 |
| `createCylinder(0.4, 1, 16)` | 64 | 64 | **0** |
| `createCapsule(0.3, 1, 12)` | 216 | 168 (+48 degenerate) | **0** |
| `createTorus(0.4, 0.15, 16, 24)` | 768 | 768 | **0** |
| `createPlane(4, 4)` | 2 | 2 | **0** |

**Consequence for the benchmark, and it is not cosmetic.** `Benchscene1`'s floor is a
`createPlane` and has therefore never been drawn in any run, and three of its five object meshes
are shading only their far inner surfaces. The scene is internally consistent and identical
across engine builds, so a comparison *between* builds stands — but its fill cost is not the fill
cost of the scene the archive describes, and any wording that calls it "a grid of primitives over
a floor plane" is describing something the renderer never produced.

---

## 5. Every texture loaded through `Resources` is tagged sRGB — **FIXED**

**Wanted:** load a normal map or a metallic-roughness map as a standalone file and have it shade
correctly. Those maps hold **linear data**, not colour.

**What happens:** `Texture2D.fromArrayBuffer` sets `colorSpace = THREE.SRGBColorSpace`
unconditionally, on both its branches:

```js
const threeTexture = new THREE.Texture(img);
threeTexture.needsUpdate = true;
threeTexture.colorSpace = THREE.SRGBColorSpace;
```

so the GPU applies an sRGB→linear decode to data that was never encoded that way. A normal map
comes out with its X and Y skewed non-linearly; a metallic-roughness map comes out with the wrong
metalness and roughness. On screen the model goes dark and blotchy with false metallic patches.

None of the `StandardMaterial` slot setters corrects it — `set normalTexture` and
`set metallicTexture` just forward to `setTexture("_BumpMap" / "_MetallicGlossMap", value)`.

**Measured at runtime**, reading `colorSpace` off the three.js material behind Benchscene2's
model after loading the archive:

| slot | `ktx2=0` | `ktx2=1` | should be |
|---|---|---|---|
| `map` (albedo) | `srgb` ✓ | `srgb` ✓ | `srgb` |
| `normalMap` | **`srgb`** | `srgb-linear` ✓ | `srgb-linear` |
| `metalnessMap` | **`srgb`** | **`srgb`** | `srgb-linear` |
| `roughnessMap` | **`srgb`** | **`srgb`** | `srgb-linear` |

The material's `metalness` and `roughness` scalars are both 1.0, so the maps drive those channels
completely and the wrong decode has its full effect.

**The KTX2 path does not do this** — `fromKTX2ArrayBuffer` never touches `colorSpace`, so the
container's own transfer function survives. That is why `ktx2=1` gets the normal map right (it is
UASTC/linear) while still getting metallic-roughness wrong (encoded ETC1S/sRGB by
`convert_to_ktx2.sh`).

**No content workaround exists.** The public API has no colour-space control at all: the single
occurrence of "sRGB" in `WebEngineTS.d.ts` is a comment about luminance coefficients. A scenario
cannot say "this texture is data, not colour", and cannot reach the underlying three.js texture
without touching internals.

**Why it did not show before.** With textures embedded in a GLB, three.js's `GLTFLoader` assigns
the colour space per slot — sRGB for base colour and emissive, linear for everything else. S2
moved Benchscene2's maps out of the GLB so `maxSize` and `ktx2` could reach them, and that took
them off the GLTF path and onto this one. The de-embedding is right and the flags now work; this
gap is what it exposed. Benchscene3 has always been on this path for `earth_normal` and has
always had the same defect.

**Two consequences for the measurement, and the second is the serious one:**

1. Scene 2's shading is wrong in both arms — appearance only. Texture count, dimensions, VRAM and
   load time are unaffected, so every number in Table 2 stands.
2. **The two arms of the KTX2 A/B do not shade identically.** The normal map is `srgb` at
   `ktx2=0` and `srgb-linear` at `ktx2=1`, so the flag changes a shading input as well as a
   texture format. Frame time is very unlikely to move, but any wording of the form "the same
   scene with compressed textures" is not strictly true for Scene 2 until this is fixed.

**What content does instead.** Benchscene2 now moves **only** the base colour out of the GLB and
leaves the normal and metallic-roughness maps embedded, where GLTFLoader assigns their colour
space per slot. Verified at runtime: `map` = `srgb`, the three data maps = `NoColorSpace`,
identical in both arms of the KTX2 A/B. `deembed_textures.sh` encodes the rule — a texture may
leave the GLB only if sRGB is its correct colour space. The cost is that `maxSize` and `ktx2`
reach one map instead of three; the day this entry is fixed, one line of that script's slot table
recovers the other two.

**FIXED in `0.1.0-local.1787378941484`**, and registered as `G3` in the shared registry — by the
second route suggested here, which is the one that cannot be forgotten: the `StandardMaterial`
slots now declare what they hold. Albedo and emission are colour; normal, metallic, occlusion and
height are linear, matching `GLTFLoader`. Pinned by the engine's `tests/TextureColorSpace.test.ts`.

Verified behaviourally: a texture that `Resources` hands back tagged `srgb` arrives on
`normalTexture` as `NoColorSpace`. The setter overrides it, so the tag on the loaded texture no
longer matters.

**Not reverted in content, deliberately.** `Benchscene2` still moves only its base colour out of
the GLB. The de-embedding rule — a texture may leave only if sRGB is its correct colour space —
was written against this gap, and moving the other two maps out again is a measurement change:
it would triple the reach of `maxSize` and `ktx2`, which is a decision for the run owner rather
than a tidy-up. `deembed_textures.sh` needs one line of its slot table to do it.

---

## How to add to this file

One section per gap, newest last, with the same five parts: what was wanted, what happens, why
(with the evidence — a file, a line, a grep result, a measurement), what is affected and what the
scenario does instead, and what the engine-side fix would be. A gap without evidence is a rumour,
and a gap without a workaround note leaves the next person to rediscover it.

When one is fixed, keep the entry, mark it in the table at the top, and record what the fix was
and how it was verified. Behaviour claims need a behavioural check: a grep proves an API exists,
not that it does anything.
