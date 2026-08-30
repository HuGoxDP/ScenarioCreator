// scripts/Scenario.ts  (Benchmark Scene 1 — Primitives Grid, multi-write variant)
// ============================================================
// Plain content scene: a grid of untextured primitives over a floor plane,
// rotating, bobbing and pulsing. No benchmarking or optimization toggles live
// here — the engine harness (WebEngineTS benchmarks/run.ts) drives warmup /
// dirty transforms / measurement from the outside. See the WebEngineTS
// "Single profiling system" policy.
//
// WHY THIS ARCHIVE EXISTS — task S1.2
//   `Benchscene1_N5000` writes ONE property per transform per frame
//   (`localRotation`). That is the least favourable workload a write-coalescing
//   optimization can be given, and it measured as one: dirty transforms made
//   Scene 1 at N5000 ~13% SLOWER on the RTX 3050. This archive is the same
//   scene with the write count raised to THREE — position, rotation and scale
//   in one `update()` — so the sweep has a second point on the axis that
//   actually governs the mechanism.
//
//   The axis is writes per transform per frame, NOT the fraction of the scene
//   that stays static. `Transform._syncAllDirty()` is called before render in
//   both modes and walks the dirty set; a transform nobody writes is never in
//   that set and costs nothing either way. Saving appears only where SEVERAL
//   writes to ONE transform collapse into a single sync.
//
// THE ARITHMETIC, from `Transform.ts` — read this before interpreting a result.
//   Every setter does `this._localX.copy(value)` and then either syncs
//   immediately or marks dirty:
//
//     dirty=0   W writes  ->  W copies into Three.js
//     dirty=1   W writes  ->  1 Set insert + ONE `_syncToThree()`, and that
//                             always copies all three of position, rotation
//                             and scale — 3 copies, whatever W was.
//
//   So the coalescer trades W copies for 3 copies plus set bookkeeping, and
//   break-even is W = 4, not W = 3:
//
//     W = 1   1 vs 3 + overhead   clear loss   <- Benchscene1_N5000
//     W = 3   3 vs 3 + overhead   still a loss, by the bookkeeping   <- HERE
//     W = 4   4 vs 3 + overhead   about break-even
//     W = 6   6 vs 3 + overhead   clear win
//
//   THIS ARCHIVE IS EXPECTED TO SHOW THE LOSS SHRINKING TOWARDS ZERO, NOT A
//   WIN. That is the honest reading of three writes and it is stated up front
//   so nobody reports a null result as a failed optimization. Two points on the
//   axis — W=1 here and W=3 — establish the direction and the slope; a win
//   needs W >= 5, which means writing one property more than once per frame,
//   and the S1.2 brief explicitly forbids adding writes to cross the break-even
//   point. If a W>=5 archive is wanted it needs a content justification first,
//   not a benchmark one.
//
// WHAT THIS SCENE COSTS PER FRAME
//   - THREE transform writes per object per frame: `localPosition`,
//     `localRotation`, `localScale`. No world-space read, no `translate()`,
//     no parent pivot — reading world position or calling `translate()` forces
//     a flush of that transform and would turn the batching into pure overhead,
//     which is a different effect and does not belong in the same archive.
//   - The rotation, the bob offset and the scale are each computed ONCE per
//     frame and shared by every object, so the loop stays a pure write loop and
//     `update_ms` moves with the write count rather than with arithmetic. Only
//     the per-object base position is read back, from an array built in awake().
//
// EVERYTHING ELSE IS `Benchscene1_N5000` UNCHANGED — same count, spacing,
// meshes, materials, lights, camera and floor — so a diff against that archive
// isolates the transform workload. The bob is +-0.25 and the pulse +-8%, small
// enough that triangles, draw calls and fill cost stay where they were.
//
// GameObjects: OBJECT_COUNT + 4 (camera, sun, ambient, floor).
// Deterministic: no randomness, fixed object order, fixed initial angle; every
// per-frame value is a pure function of Time.time.
// No textures: the scene is geometry, material and lighting only.
// ============================================================

import {
    ScenarioBehaviour, GameObject, Camera, Vector3, Quaternion, Color,
    MeshFilter, MeshRenderer, Mesh, StandardMaterial,
    DirectionalLight, AmbientLight, Time, CameraClearFlags,
} from "WebEngineTS";

/** Objects in the grid. Scene content, not a benchmark knob. */
const OBJECT_COUNT = 5000;

/** Spacing between grid cells, in world units. */
const SPACING = 2.5;

/** Vertical travel of the bob, in world units. Small on purpose — see header. */
const BOB_AMPLITUDE = 0.25;

/** Peak deviation of the scale pulse, as a fraction of 1. */
const PULSE_AMPLITUDE = 0.08;

export default class BenchPrimitivesMultiWrite extends ScenarioBehaviour {
    private _objects: GameObject[] = [];

    /** Grid position each object returns to. Read in update(), never written. */
    private _basePositions: Vector3[] = [];

    // Cached — zero allocation in update()
    private readonly _rot = new Quaternion();
    private readonly _pos = new Vector3();
    private readonly _scale = new Vector3();

    override async awake(): Promise<void> {
        const cols = Math.ceil(Math.sqrt(OBJECT_COUNT));
        const gridSize = cols * SPACING;

        // ── Camera ──
        const camGo = new GameObject("Main Camera");
        camGo.tag = "MainCamera";
        const cam = camGo.addComponent(Camera);
        cam.fieldOfView = 60;
        cam.clearFlags = CameraClearFlags.SolidColor;
        cam.backgroundColor = new Color(0.05, 0.05, 0.08);
        camGo.transform.position = new Vector3(gridSize / 2, gridSize * 0.4, gridSize * 0.9);
        camGo.transform.lookAt(new Vector3(gridSize / 2, 0, gridSize / 2));

        // ── Lights ──
        const sunGo = new GameObject("Sun");
        const sun = sunGo.addComponent(DirectionalLight);
        sun.intensity = 1.2;
        sun.color = new Color(1, 0.98, 0.95);
        sunGo.transform.rotation = Quaternion.euler(50, -30, 0);

        const ambGo = new GameObject("Ambient");
        const amb = ambGo.addComponent(AmbientLight);
        amb.intensity = 0.3;
        amb.color = new Color(0.6, 0.7, 0.9);

        // ── Shared resources (reuse = fewer GPU objects) ──
        const meshes = [
            Mesh.createCube(1),
            Mesh.createSphere(0.5, 16),
            Mesh.createCylinder(0.4, 1, 16),
            Mesh.createTorus(0.4, 0.15, 16, 24),
            Mesh.createCapsule(0.3, 1, 12),
        ];

        const materials = [
            this._mat(0.8, 0.2, 0.2, 0.0, 0.7),
            this._mat(0.2, 0.6, 0.9, 0.9, 0.3),
            this._mat(0.1, 0.8, 0.3, 0.0, 0.5),
            this._mat(0.9, 0.8, 0.2, 0.7, 0.4),
            this._mat(0.95, 0.95, 0.95, 1.0, 0.1),
        ];

        // ── Spawn grid ──
        this._objects = new Array(OBJECT_COUNT);
        this._basePositions = new Array(OBJECT_COUNT);
        for (let i = 0; i < OBJECT_COUNT; i++) {
            const col = i % cols;
            const row = Math.floor(i / cols);

            const go = new GameObject(`P_${i}`);
            const base = new Vector3(col * SPACING, 0, row * SPACING);
            go.transform.position = base.clone();
            go.addComponent(MeshFilter).sharedMesh = meshes[i % meshes.length];
            go.addComponent(MeshRenderer).sharedMaterial = materials[(i + row) % materials.length];
            this._objects[i] = go;
            this._basePositions[i] = base;
        }

        // ── Floor ──
        const floor = new GameObject("Floor");
        floor.addComponent(MeshFilter).sharedMesh = Mesh.createPlane(gridSize + 4, gridSize + 4);
        const floorMat = new StandardMaterial();
        floorMat.albedoColor = new Color(0.15, 0.15, 0.18);
        floorMat.smoothness = 0.3;
        floor.addComponent(MeshRenderer).sharedMaterial = floorMat;
        floor.transform.position = new Vector3(gridSize / 2, -0.5, gridSize / 2);
    }

    /**
     * Three writes per transform, one shared value each.
     *
     * The three values are computed before the loop so that what scales with
     * OBJECT_COUNT is the writing, not the arithmetic — the same reason
     * `Benchscene1_N5000` shares one Quaternion across all 5000 objects.
     */
    override update(): void {
        const t = Time.time;

        Quaternion.euler(0, t * 30, 0, this._rot);
        const bob = Math.sin(t * 2) * BOB_AMPLITUDE;
        const pulse = 1 + Math.sin(t * 3) * PULSE_AMPLITUDE;
        this._scale.set(pulse, pulse, pulse);

        for (let i = 0; i < this._objects.length; i++) {
            const base = this._basePositions[i];
            this._pos.set(base.x, base.y + bob, base.z);

            const transform = this._objects[i].transform;
            transform.localPosition = this._pos;
            transform.localRotation = this._rot;
            transform.localScale = this._scale;
        }
    }

    private _mat(r: number, g: number, b: number, met: number, smooth: number): StandardMaterial {
        const m = new StandardMaterial();
        m.albedoColor = new Color(r, g, b);
        m.metallic = met;
        m.smoothness = smooth;
        return m;
    }
}
