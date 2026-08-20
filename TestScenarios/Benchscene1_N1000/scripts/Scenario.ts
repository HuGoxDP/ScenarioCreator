// scripts/Scenario.ts  (Benchmark Scene 1 — Primitives Grid)
// ============================================================
// Plain content scene: a grid of untextured primitives over a floor plane,
// slowly rotating. No benchmarking or optimization toggles live here — the
// engine harness (WebEngineTS benchmarks/run.ts) drives warmup / dirty
// transforms / measurement from the outside. See the WebEngineTS
// "Single profiling system" policy.
//
// ONE SCENE, FOUR ARCHIVES
//   This file is shared verbatim by Benchscene1_N100, _N500, _N1000 and _N5000.
//   The ONLY difference between them is the value of OBJECT_COUNT below; a diff
//   between any two of these files shows exactly one changed line, and that is
//   the property the count sweep depends on.
//
//   Four archives rather than one parameterised scene because a scenario has no
//   parameter channel and should not have one: `IScenarioContext` exposes
//   `manifest`, `assets` and `importScript`, and nothing from the URL reaches
//   scenario code. Reading a count from the query string would be a benchmark
//   knob inside content, which is the thing the single-profiling-system policy
//   forbids.
//
// WHAT THIS SCENE COSTS PER FRAME, since that is what makes a dirty-transform
// measurement interpretable:
//   - ONE transform write per object per frame: `localRotation`, and nothing
//     else. No position, no scale, no parent pivot, no world-space read.
//   - The Quaternion is computed once and shared by every object, so the loop
//     is a pure write loop.
//   One write per transform is the LEAST favourable workload a write-coalescing
//   optimization can be given — it breaks even around three to four writes. That
//   is a property of this scene, not a defect, and it is stated here rather than
//   tuned away. Changing it is task S1.2 and needs a decision about what the
//   scene is meant to represent first.
//
// GameObjects: OBJECT_COUNT + 4 (camera, sun, ambient, floor).
// Deterministic: no randomness, fixed object order, fixed initial angle.
// No textures: the scene is geometry, material and lighting only.
// ============================================================

import {
    ScenarioBehaviour, GameObject, Camera, Vector3, Quaternion, Color,
    MeshFilter, MeshRenderer, Mesh, StandardMaterial,
    DirectionalLight, AmbientLight, Time, CameraClearFlags,
} from "WebEngineTS";

/** Objects in the grid. Scene content, not a benchmark knob. */
const OBJECT_COUNT = 1000;

/** Spacing between grid cells, in world units. */
const SPACING = 2.5;

export default class BenchPrimitives extends ScenarioBehaviour {
    private _objects: GameObject[] = [];

    // Cached — zero allocation in update()
    private readonly _rot = new Quaternion();

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
        for (let i = 0; i < OBJECT_COUNT; i++) {
            const col = i % cols;
            const row = Math.floor(i / cols);

            const go = new GameObject(`P_${i}`);
            go.transform.position = new Vector3(col * SPACING, 0, row * SPACING);
            go.addComponent(MeshFilter).sharedMesh = meshes[i % meshes.length];
            go.addComponent(MeshRenderer).sharedMaterial = materials[(i + row) % materials.length];
            this._objects[i] = go;
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

    override update(): void {
        Quaternion.euler(0, Time.time * 30, 0, this._rot);
        for (let i = 0; i < this._objects.length; i++) {
            this._objects[i].transform.localRotation = this._rot;
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
