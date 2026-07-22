// scripts/Scenario.ts  (Benchmark Scene 2 — Complex Model)
// ============================================================
// Plain content scene: one high-poly PBR-textured GLB model, slowly rotating.
// No benchmarking or optimization toggles live here — the engine harness
// (WebEngineTS benchmarks/run.ts) drives maxSize / warmup / KTX2 / measurement
// from the outside. See the WebEngineTS "Single profiling system" policy.
//
// SETUP: place the model at assets/models/complex_model.glb
// ============================================================

import {
    ScenarioBehaviour, GameObject, Camera, Vector3, Quaternion, Color,
    DirectionalLight, AmbientLight, Resources, Time, CameraClearFlags,
} from "WebEngineTS";

/** Path to the model in the scenario archive (no extension). */
const MODEL_PATH = "models/complex_model";

export default class BenchComplexModel extends ScenarioBehaviour {
    private _model: GameObject | null = null;
    private readonly _rot = new Quaternion();

    override async awake(): Promise<void> {
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

        // ── Model ──
        this._model = await Resources.tryLoad(GameObject, MODEL_PATH);
        if (!this._model) {
            console.error(
                `[Scene2] Model not found at "${MODEL_PATH}". ` +
                `Place the GLB at assets/${MODEL_PATH}.glb`
            );
        }
    }

    override update(): void {
        if (this._model) {
            Quaternion.euler(0, Time.time * 20, 0, this._rot);
            this._model.transform.localRotation = this._rot;
        }
    }
}
