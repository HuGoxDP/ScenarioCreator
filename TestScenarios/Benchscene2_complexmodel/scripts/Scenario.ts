// scripts/Scenario.ts  (Benchmark Scene 2 — Complex Model)
// ============================================================
// Plain content scene: one high-poly PBR model, slowly rotating.
// No benchmarking or optimization toggles live here — the engine harness
// (WebEngineTS benchmarks/run.ts) drives maxSize / warmup / KTX2 / measurement
// from the outside. See the WebEngineTS "Single profiling system" policy.
//
// WHY THE TEXTURES ARE LOADED HERE RATHER THAN COMING WITH THE MODEL
//   They used to be embedded in the GLB, and an embedded texture never reaches
//   `Resources`: GLTFLoader hands three.js the decoded image and the engine
//   only wraps the result. The size cap and the KTX2 swap both live on the
//   `Resources` path — `fromArrayBuffer` and `fromKTX2ArrayBuffer`, chosen by
//   file extension — so neither could touch this scene at all. Loading the maps
//   as standalone files is what puts them back on that path. It is the same
//   pattern Scene 3 already uses for its planets.
//
//   The paths below carry NO EXTENSION on purpose. That is what lets
//   `Resources.preferExtension` pick `complex_albedo.ktx2` over
//   `complex_albedo.jpg` without a line of this file changing — which is how
//   the harness A/Bs compressed against uncompressed from one archive.
//
//   All three maps are assigned to uv0. The model's glTF referenced
//   TEXCOORD_1 and TEXCOORD_2 for the metallic-roughness and normal slots, but
//   its three UV sets are bit-identical (compress_model.sh's `dedup` step
//   collapsed them to one stored copy), so this is not a visual change.
//
// SETUP: assets/models/complex_model.glb  +  assets/textures/complex_*.{jpg,ktx2}
// ============================================================

import {
    ScenarioBehaviour, GameObject, Camera, Vector3, Quaternion, Color,
    DirectionalLight, AmbientLight, Resources, Time, CameraClearFlags,
    MeshRenderer, StandardMaterial, Texture2D,
} from "WebEngineTS";

/** Path to the model in the scenario archive (no extension). */
const MODEL_PATH = "models/complex_model";

/** The material slots this model uses, and the file each one comes from. */
const TEXTURE_SLOTS = [
    { path: "textures/complex_albedo", slot: "albedoTexture" },
    { path: "textures/complex_normal", slot: "normalTexture" },
    { path: "textures/complex_metallic", slot: "metallicTexture" },
] as const;

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
            return;
        }

        await this._applyTextures(this._model);
    }

    override update(): void {
        if (this._model) {
            Quaternion.euler(0, Time.time * 20, 0, this._rot);
            this._model.transform.localRotation = this._rot;
        }
    }

    /**
     * Loads the maps and assigns them to every material the model brought.
     *
     * The GLTF importer deduplicates materials, so this model's four meshes
     * share one StandardMaterial and the loop assigns to it once — but it is
     * written per material rather than per model so that a model with several
     * does not silently get textures on one of them.
     */
    private async _applyTextures(model: GameObject): Promise<void> {
        const loaded = await Promise.all(
            TEXTURE_SLOTS.map((entry) => Resources.tryLoad(Texture2D, entry.path))
        );

        const materials = new Set<StandardMaterial>();
        for (const renderer of model.getComponentsInChildren(MeshRenderer, true)) {
            const material = renderer.sharedMaterial;
            if (material instanceof StandardMaterial) materials.add(material);
        }

        if (materials.size === 0) {
            console.error("[Scene2] Model has no StandardMaterial to texture.");
            return;
        }

        TEXTURE_SLOTS.forEach((entry, i) => {
            const texture = loaded[i];
            if (!texture) {
                console.error(
                    `[Scene2] Texture not found at "${entry.path}". ` +
                    `Expected assets/${entry.path}.jpg (and .ktx2 beside it).`
                );
                return;
            }
            for (const material of materials) {
                material[entry.slot] = texture;
            }
        });

        console.log(
            `[Scene2] Applied ${loaded.filter(Boolean).length}/${TEXTURE_SLOTS.length} maps ` +
            `to ${materials.size} material(s).`
        );
    }
}
