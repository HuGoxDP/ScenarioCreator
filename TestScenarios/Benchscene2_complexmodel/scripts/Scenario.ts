// scripts/Scenario.ts  (Benchmark Scene 2 — Complex Model)
// ============================================================
// Plain content scene: one high-poly PBR model, slowly rotating.
// No benchmarking or optimization toggles live here — the engine harness
// (WebEngineTS benchmarks/run.ts) drives maxSize / warmup / KTX2 / measurement
// from the outside. See the WebEngineTS "Single profiling system" policy.
//
// WHY THE BASE COLOUR IS LOADED HERE AND THE OTHER MAPS ARE NOT
//   An embedded texture never reaches `Resources`: GLTFLoader hands three.js
//   the decoded image and the engine only wraps the result. The size cap and
//   the KTX2 swap both live on the `Resources` path — `fromArrayBuffer` and
//   `fromKTX2ArrayBuffer`, chosen by file extension — so with everything
//   embedded neither flag could touch this scene at all. Moving a map out is
//   what puts it on that path. It is the same pattern Scene 3 uses.
//
//   Only the base colour moves. `Texture2D.fromArrayBuffer` tags every image it
//   decodes as sRGB and no material setter corrects it. That is right for base
//   colour and wrong for the normal and metallic-roughness maps, which hold
//   linear data — decoded as sRGB they skew the normals and the metalness, and
//   the model renders dark and blotchy. Measured: with all three external, all
//   three came back tagged `srgb`. See entry 5 of docs/ENGINE-GAPS.md.
//
//   So the linear maps stay inside the GLB, where GLTFLoader assigns their
//   colour space per slot and gets it right. The cap and the format swap reach
//   one map instead of three — weaker, and correct. It also keeps both arms of
//   the KTX2 A/B shading IDENTICALLY, so that flag varies a texture format and
//   nothing else; with the normal map external it came out `srgb` at ktx2=0 and
//   `srgb-linear` at ktx2=1, which made the A/B compare two different scenes.
//
//   The path below carries NO EXTENSION on purpose. That is what lets
//   `Resources.preferExtension` pick `complex_albedo.ktx2` over
//   `complex_albedo.jpg` without a line of this file changing.
//
// WHY THE ORIENTATION IS SET BELOW
//   Moving a map out of the GLB changes its UV orientation as well as its
//   colour space. glTF puts the UV origin at the TOP-left, so GLTFLoader
//   uploads every texture it creates with `flipY = false`;
//   `Texture2D.fromArrayBuffer` leaves three.js's default `flipY = true` in
//   place. A map that renders correctly embedded therefore arrives UPSIDE DOWN
//   once it is served as a standalone file. On this model's colour map — a
//   tightly packed atlas of fur swatches separated by black gutters — a
//   vertical flip lands a different swatch on every surface, and the pug comes
//   out dark and covered in black patches. See entry 6 of docs/ENGINE-GAPS.md.
//
//   `Texture.flipVertically` is the engine's answer to that: content states the
//   orientation it wants. The two conventions are NOT unified — a KTX2 texture
//   is always `false` because block-compressed data cannot be flipped on upload
//   at all — so this stays until `unity-coordinates-plan.md` lands.
//
// SETUP: assets/models/complex_model.glb  +  assets/textures/complex_albedo.{jpg,ktx2}
// ============================================================

import {
    ScenarioBehaviour, GameObject, Camera, Vector3, Quaternion, Color,
    DirectionalLight, AmbientLight, Resources, Time, CameraClearFlags,
    MeshRenderer, StandardMaterial, Texture2D,
} from "WebEngineTS";

/** Path to the model in the scenario archive (no extension). */
const MODEL_PATH = "models/complex_model";

/**
 * The slots served from standalone files.
 *
 * Base colour only — see the header. Normal and metallic-roughness stay in the
 * GLB because this path would tag them sRGB.
 */
const TEXTURE_SLOTS = [
    { path: "textures/complex_albedo", slot: "albedoTexture" },
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

            BenchComplexModel._matchGltfOrientation(texture);

            for (const material of materials) {
                material[entry.slot] = texture;
            }
        });

        console.log(
            `[Scene2] Applied ${loaded.filter(Boolean).length}/${TEXTURE_SLOTS.length} standalone ` +
            `map(s) to ${materials.size} material(s); the linear maps came with the model.`
        );
    }

    /**
     * Uploads a standalone map the way GLTFLoader uploads an embedded one.
     *
     * glTF UV space has its origin at the top-left, so every texture the model
     * brought with it is uploaded `flipY = false`. `Texture2D.fromArrayBuffer`
     * keeps three.js's `flipY = true` default, so a de-embedded map is sampled
     * upside down against UVs authored for the other convention.
     *
     * Set unconditionally, and that is the point: the KTX2 variant already
     * arrives `false` — block-compressed data cannot be flipped on upload — so
     * this is a no-op there. Both arms of the KTX2 A/B end up in one
     * orientation, which is what lets that flag vary a texture format and
     * nothing else. A branch on "did we get a .ktx2?" would reintroduce exactly
     * the arm-dependent difference the header argues against.
     */
    private static _matchGltfOrientation(texture: Texture2D): void {
        texture.flipVertically = false;
    }
}
