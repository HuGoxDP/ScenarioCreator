// scripts/Scenario.ts  (Benchmark Scene 1 — Primitives Grid)
// ============================================================
// Plain content scene: a grid of untextured primitives over a floor plane,
// slowly rotating. No benchmarking or optimization toggles live here — the
// engine harness (WebEngineTS benchmarks/run.ts) drives object counts /
// warmup / dirty transforms / measurement from the outside. See the
// WebEngineTS "Single profiling system" policy.
//
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
