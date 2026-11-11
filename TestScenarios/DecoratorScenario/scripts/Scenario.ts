// scripts/Scenario.ts  (A11 fixture — a scenario that uses the engine's decorators)
// ============================================================
// Feature fixture for the legacy-decorator compile flag (A11 phase 3,
// `PLAN.md` §4.8): the engine's serialization API is the decorator kind
// (`@Serializable`, `@SerializedField`), and the builder invokes `tsc` with
// `--ignoreConfig` and no tsconfig, so the flag has to be named on the
// command line for a scenario that uses them to compile at all.
//
// The class below is the smallest thing that proves the flag: a serializable
// component holding two fields, instantiated on a box in the scene. If the
// flag is missing, `tsc` refuses the whole build (TS1219 in TypeScript 6) —
// which is the failure recorded in the task notes — and nothing else about
// the pipeline changes.
// ============================================================

import {
    ScenarioBehaviour, GameObject, Camera, DirectionalLight, Vector3, Color,
    MeshFilter, MeshRenderer, StandardMaterial, Mesh, Quaternion,
    ScriptableBehaviour, Serializable, SerializedField, Range, Time,
} from "WebEngineTS";

/** A serializable component: the shape a scenario uses to carry its own state. */
@Serializable({ typeName: "DecoratorFixture.Spinner" })
export class Spinner extends ScriptableBehaviour {
    @SerializedField()
    public speed = 90;

    @SerializedField()
    @Range(10, 180)
    public amplitude = 45;

    public override update(): void {
        this.transform.rotation = Quaternion.euler(0, Time.time * this.speed, 0);
    }
}

export default class DecoratorScenario extends ScenarioBehaviour {

    override awake(): void {
        const camera = new GameObject("Camera");
        camera.addComponent(Camera);
        camera.transform.position = new Vector3(0, 1.6, -4);
        camera.transform.lookAt(new Vector3(0, 0.5, 0));

        const sun = new GameObject("Sun");
        sun.addComponent(DirectionalLight);
        sun.transform.rotation = Quaternion.euler(50, -30, 0);

        const box = new GameObject("SpinningBox");
        box.transform.position = new Vector3(0, 0.5, 0);
        box.addComponent(MeshFilter).sharedMesh = Mesh.createCube(1);
        const material = new StandardMaterial();
        material.albedoColor = new Color(0.7, 0.8, 0.9);
        box.addComponent(MeshRenderer).sharedMaterial = material;
        box.addComponent(Spinner);
    }
}
