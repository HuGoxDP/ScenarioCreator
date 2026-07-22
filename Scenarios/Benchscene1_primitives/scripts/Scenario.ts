// scripts/Scenario.ts  (Benchmark Scene 1 — Primitives Grid)
// ============================================================
// Tests: draw call scaling, dirty-flag transforms, baseline CPU cost.
// No textures — isolates geometry/material/lighting overhead.
//
// CONFIGURATION:
//   OBJECT_COUNT — 100 / 500 / 1000 / 5000
//   ANIMATE_PERCENT — 0 (static) / 5 / 100 (all rotate)
//   SHADER_WARMUP — false / true
//   DIRTY_TRANSFORMS — false / true
// ============================================================

import {
    ScenarioBehaviour, GameObject, Camera, Vector3, Quaternion, Color,
    MeshFilter, MeshRenderer, Mesh, StandardMaterial,
    DirectionalLight, AmbientLight,
    Transform,
    Time,
    Application,
    MemoryProfiler, CameraClearFlags,
} from "WebEngineTS";

import { BenchmarkHarness } from "./helpers/BenchmarkHarness";

// ==================== CONFIGURATION ====================
// Change these between runs and record the results.

/** Total objects to spawn. Run with: 100, 500, 1000, 5000. */
const OBJECT_COUNT = 5000;

/** Percentage of objects that rotate each frame: 0, 5, or 100. */
const ANIMATE_PERCENT = 5;

/** Enable shader pre-compilation before first frame. */
const SHADER_WARMUP = false;

/** Enable dirty-flag transform optimization. */
const DIRTY_TRANSFORMS = true;

/** Show MemoryProfiler overlay. Disable for paper-quality numbers
 *  (the overlay drives its own RAF loop and writes to DOM each frame). */
const SHOW_OVERLAY = false;

/** Benchmark timing. */
const WARMUP = 120;
const SAMPLES = 600;

// ==================== SCENE ====================

export default class BenchPrimitives extends ScenarioBehaviour {
    private _bench!: BenchmarkHarness;
    private _objects: GameObject[] = [];
    private _animatedIndices: number[] = [];

    // Cached — zero allocation in update()
    private readonly _rot = new Quaternion();

    override async awake(): Promise<void> {
        const loadStart = performance.now();

        const label = `Scene1_${OBJECT_COUNT}obj_${ANIMATE_PERCENT}pct`
            + (SHADER_WARMUP ? "_warmup" : "")
            + (DIRTY_TRANSFORMS ? "_dirty" : "");

        console.log(`[Scene1] ${label}`);

        // ── Enable dirty-flag transforms ──
        if (DIRTY_TRANSFORMS) {
            Transform._setDirtyTransformsEnabled(true);
            console.log("[Scene1] Dirty transforms enabled");
        }

        // ── Camera ──
        const camGo = new GameObject("Main Camera");
        camGo.tag = "MainCamera";
        const cam = camGo.addComponent(Camera);
        cam.fieldOfView = 60;
        cam.clearFlags = CameraClearFlags.SolidColor;
        cam.backgroundColor = new Color(0.05, 0.05, 0.08);

        const cols = Math.ceil(Math.sqrt(OBJECT_COUNT));
        const gridSize = cols * 2.5;
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
            go.transform.position = new Vector3(col * 2.5, 0, row * 2.5);
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

        // ── Determine which objects animate ──
        if (ANIMATE_PERCENT > 0) {
            const step = ANIMATE_PERCENT >= 100 ? 1 : Math.round(100 / ANIMATE_PERCENT);
            for (let i = 0; i < OBJECT_COUNT; i++) {
                if (i % step === 0) this._animatedIndices.push(i);
            }
        }

        // ── Shader warmup ──
        if (SHADER_WARMUP) {
            Application.current?.warmupShaders();
            console.log("[Scene1] Shader warmup done");
        }

        const loadTime = performance.now() - loadStart;
        console.log(
            `[Scene1] ${OBJECT_COUNT} objects (${this._animatedIndices.length} animated) ` +
            `in ${loadTime.toFixed(0)}ms`
        );

        this._bench = new BenchmarkHarness({
            warmup: WARMUP, sample: SAMPLES, label,
        });
        this._bench.loadTimeMs = loadTime;

        if (SHOW_OVERLAY) MemoryProfiler.showOverlay();
    }

    override update(): void {
        // ── Animate subset ──
        if (this._animatedIndices.length > 0) {
            const angle = Time.time * 30;
            Quaternion.euler(0, angle, 0, this._rot);
            for (let i = 0; i < this._animatedIndices.length; i++) {
                this._objects[this._animatedIndices[i]].transform.localRotation = this._rot;
            }
        }

        // ── Benchmark ──
        this._bench.tick();
        if (this._bench.isDone && !this._bench.reported) {
            this._bench.report();
        }
    }

    override onDestroy(): void {
        if (DIRTY_TRANSFORMS) {
            Transform._setDirtyTransformsEnabled(false);
        }
        if (SHOW_OVERLAY) MemoryProfiler.hideOverlay();
    }

    private _mat(r: number, g: number, b: number, met: number, smooth: number): StandardMaterial {
        const m = new StandardMaterial();
        m.albedoColor = new Color(r, g, b);
        m.metallic = met;
        m.smoothness = smooth;
        return m;
    }
}