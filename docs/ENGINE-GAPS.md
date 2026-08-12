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

## How to add to this file

One section per gap, newest last, with the same five parts: what was wanted, what happens, why
(with the evidence — a file, a line, a grep result), what is affected and what the scenario does
instead, and what the engine-side fix would be. A gap without evidence is a rumour, and a gap
without a workaround note leaves the next person to rediscover it.
