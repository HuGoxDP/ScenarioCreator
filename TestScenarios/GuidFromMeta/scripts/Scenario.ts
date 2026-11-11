// scripts/Scenario.ts  (A11 fixture — an asset's guid may come from its .meta)
// ============================================================
// Feature fixture for the `.meta` guid contract (A11 phase 2,
// `WebEngineTSEditor/docs/unity-editor-plan.md` §3.3): an asset whose
// `<file>.meta` sidecar states a guid keeps it across a rename, and an asset
// without a sidecar keeps the guid derived from the scenario id and the path.
//
// The scene is deliberately minimal — it exists to carry two assets into the
// manifest, one of each kind, so the manifests' guids can be checked:
//
//   assets/textures/stated.png    a 1x1 PNG with a `.meta` beside it
//   assets/textures/derived.png   a 1x1 PNG with no sidecar
//
// Both are loaded as albedo textures on two boxes, the way a real scene
// resolves them (Resources.tryLoad, the path without the `assets/` prefix).
// The guids themselves are asserted from the manifests the builders write,
// not from here — that check lives in the build diff.
// ============================================================

import {
    ScenarioBehaviour, GameObject, Camera, DirectionalLight, Vector3, Color,
    MeshFilter, MeshRenderer, StandardMaterial, Texture2D, Mesh, Resources, Quaternion,
} from "WebEngineTS";

export default class GuidFromMeta extends ScenarioBehaviour {

    override async awake(): Promise<void> {
        const camera = new GameObject("Camera");
        camera.addComponent(Camera);
        camera.transform.position = new Vector3(0, 1.6, -4);
        camera.transform.lookAt(new Vector3(0, 0.5, 0));

        const sun = new GameObject("Sun");
        sun.addComponent(DirectionalLight);
        sun.transform.rotation = Quaternion.euler(50, -30, 0);

        const boxes: Array<[string, string]> = [
            ["StatedAsset", "textures/stated"],
            ["DerivedAsset", "textures/derived"],
        ];
        for (let i = 0; i < boxes.length; i++) {
            const [name, path] = boxes[i];
            const box = new GameObject(name);
            box.transform.position = new Vector3(i === 0 ? -1.2 : 1.2, 0.5, 0);
            box.addComponent(MeshFilter).sharedMesh = Mesh.createCube(1);
            const material = new StandardMaterial();
            material.albedoColor = new Color(0.85, 0.85, 0.85);
            const texture = await Resources.tryLoad(Texture2D, path);
            if (!texture) console.warn(`[GuidFromMeta] ${path} missing — box drawn flat`);
            else material.albedoTexture = texture;
            box.addComponent(MeshRenderer).sharedMaterial = material;
        }
    }
}
