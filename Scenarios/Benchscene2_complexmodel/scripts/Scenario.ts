// scripts/Scenario.ts  (Benchmark Scene 2 — Complex Model)
// ============================================================
// Tests: polygon throughput, shader warmup, texture maxSize impact.
// Loads a single GLB model (100K+ triangles) with PBR textures.
//
// SETUP:
//   Place your model at: assets/models/complex_model.glb
//   (or change MODEL_PATH below)
//
// CONFIGURATION:
//   TEXTURE_MAX_SIZE — 0 (no limit) / 1024 / 2048 / 4096
//   SHADER_WARMUP — false / true
//   ROTATE — true (dynamic) / false (static)
// ============================================================

import {
    ScenarioBehaviour, GameObject, Camera, Vector3, Quaternion, Color,
    DirectionalLight, AmbientLight,
    Texture2D, Resources,
    Time, MemoryProfiler, CameraClearFlags,
    Application,
} from "WebEngineTS";

import { BenchmarkHarness } from "./helpers/BenchmarkHarness";

// ==================== CONFIGURATION ====================

/** Path to the model in the scenario archive (no extension). */
const MODEL_PATH = "models/complex_model";

/** Texture resolution limit. 0 = no limit. Try: 0, 1024, 2048, 4096. */
const TEXTURE_MAX_SIZE = 1024;

/** Pre-compile shaders before first frame. */
const SHADER_WARMUP = true;

/** Whether the model rotates (dynamic vs static scene). */
const ROTATE = true;

/** Release ZIP archive after loading. */
const RELEASE_ARCHIVE = true;

/** Show MemoryProfiler overlay. Disable for paper-quality numbers. */
const SHOW_OVERLAY = false;

/** Benchmark timing. */
const WARMUP = 120;
const SAMPLES = 600;

// ==================== SCENE ====================

export default class BenchComplexModel extends ScenarioBehaviour {
    private _bench!: BenchmarkHarness;
    private _model: GameObject | null = null;
    private readonly _rot = new Quaternion();

    override async awake(): Promise<void> {
        const loadStart = performance.now();

        const label = `Scene2`
            + (TEXTURE_MAX_SIZE ? `_max${TEXTURE_MAX_SIZE}` : "_nomax")
            + (SHADER_WARMUP ? "_warmup" : "");

        console.log(`[Scene2] ${label}`);

        // ── Texture limit (must be set BEFORE loading) ──
        if (TEXTURE_MAX_SIZE > 0) {
            Texture2D.maxSize = TEXTURE_MAX_SIZE;
            console.log(`[Scene2] Texture2D.maxSize = ${TEXTURE_MAX_SIZE}`);
        }

        // ── Camera ──
        const camGo = new GameObject("Main Camera");
        camGo.tag = "MainCamera";
        const cam = camGo.addComponent(Camera);
        cam.fieldOfView = 45;
        cam.clearFlags = CameraClearFlags.SolidColor;
        cam.backgroundColor = new Color(0.12, 0.12, 0.15);
        camGo.transform.position = new Vector3(3, 2.5, 6);
        camGo.transform.lookAt(Vector3.zero);

        // ── Lights ──
        const keyGo = new GameObject("Key Light");
        const key = keyGo.addComponent(DirectionalLight);
        key.intensity = 1.5;
        key.color = new Color(1, 0.97, 0.92);
        keyGo.transform.rotation = Quaternion.euler(45, -45, 0);

        const fillGo = new GameObject("Fill Light");
        const fill = fillGo.addComponent(DirectionalLight);
        fill.intensity = 0.4;
        fill.color = new Color(0.6, 0.7, 1.0);
        fillGo.transform.rotation = Quaternion.euler(30, 135, 0);

        const ambGo = new GameObject("Ambient");
        const amb = ambGo.addComponent(AmbientLight);
        amb.intensity = 0.25;
        amb.color = new Color(0.5, 0.55, 0.7);

        // ── Load model via Resources API ──
        console.log("[Scene2] Loading model...");
        this._model = await Resources.tryLoad(GameObject, MODEL_PATH);

        if (!this._model) {
            console.error(
                `[Scene2] Model not found at "${MODEL_PATH}". ` +
                `Place your GLB file at assets/${MODEL_PATH}.glb`
            );
            return;
        }

        // ── Memory snapshot BEFORE optimizations ──
        console.log("[Scene2] Heap BEFORE optimizations:");
        MemoryProfiler.logReport();

        // ── Release archive ──
        if (RELEASE_ARCHIVE) {
            this.context.assets.releaseArchive();
            console.log("[Scene2] Archive released");
        }

        // ── Shader warmup ──
        if (SHADER_WARMUP) {
            Application.current?.warmupShaders();
            console.log("[Scene2] Shader warmup done");
        }

        const loadTime = performance.now() - loadStart;
        console.log(`[Scene2] Loaded in ${loadTime.toFixed(0)}ms`);

        this._bench = new BenchmarkHarness({
            warmup: WARMUP, sample: SAMPLES, label,
            firstFrameCount: 60,
        });
        this._bench.loadTimeMs = loadTime;

        if (SHOW_OVERLAY) MemoryProfiler.showOverlay();
    }

    override start(): void {
        console.log("[Scene2] Heap AFTER first render:");
        MemoryProfiler.logReport();
    }

    override update(): void {
        if (ROTATE && this._model) {
            Quaternion.euler(0, Time.time * 20, 0, this._rot);
            this._model.transform.localRotation = this._rot;
        }

        this._bench?.tick();
        if (this._bench?.isDone && !this._bench.reported) {
            this._bench.report();
        }
    }

    override onDestroy(): void {
        Texture2D.maxSize = 0;
        if (SHOW_OVERLAY) MemoryProfiler.hideOverlay();
        Resources.unloadUnused();
    }
}