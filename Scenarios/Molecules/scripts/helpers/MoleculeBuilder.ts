// scripts/helpers/MoleculeBuilder.ts
// ============================================================
// Turns a Frag (chemistry) into GameObjects (rendering).
//
// Two meshes serve the entire catalogue — one sphere, one cylinder — and every
// atom of a given element shares one material. Without that cache a 46-molecule
// scene would allocate hundreds of identical StandardMaterials, each its own
// GPU state.
//
// Molecules are built on first use rather than up front: opening the scenario
// should not pay for 46 structures the student may never look at.
// ============================================================

import {
    GameObject, Vector3, Quaternion, Color,
    MeshFilter, MeshRenderer, Mesh, StandardMaterial, SphereCollider,
} from "WebEngineTS";

import { ELEMENT, type ElementKey } from "../data/elements";
import type { Bond, Frag, V3 } from "../data/geometry";
import { Rotator } from "../components/Rotator";

/** Ångström → world units. Exported so the camera can frame by real size. */
export const SCALE = 2.2;

/** Stick radius in world units. */
const BOND_RADIUS = 0.075;
const IONIC_RADIUS = 0.035;

/** Half-separation between the parallel sticks of a multiple bond. */
const MULTI_OFFSET = 0.13;

export interface BuiltMolecule {
    root: GameObject;
    rotator: Rotator;
}

export class MoleculeBuilder {
    private readonly _atomMesh: Mesh;
    private readonly _bondMesh: Mesh;
    private readonly _atomMaterials = new Map<ElementKey, StandardMaterial>();
    private readonly _bondMaterial: StandardMaterial;
    private readonly _ionicMaterial: StandardMaterial;

    constructor() {
        // Unit primitives: per-atom and per-bond size comes from transform scale,
        // so no molecule needs a mesh of its own.
        this._atomMesh = Mesh.createSphere(1, 20);
        this._bondMesh = Mesh.createCylinder(1, 1, 10);

        this._bondMaterial = new StandardMaterial();
        this._bondMaterial.albedoColor = new Color(0.72, 0.74, 0.80, 1);
        this._bondMaterial.smoothness = 0.4;

        this._ionicMaterial = new StandardMaterial();
        this._ionicMaterial.albedoColor = new Color(0.55, 0.62, 0.78, 1);
        this._ionicMaterial.smoothness = 0.2;
    }

    /**
     * Builds one molecule, inactive, centred on the origin.
     * @param elementOf receives every atom GameObject so a click can be named
     */
    build(name: string, frag: Frag, elementOf: Map<GameObject, ElementKey>): BuiltMolecule {
        const root = new GameObject(name);
        const rot = root.addComponent(Rotator) as Rotator;
        rot.speed = 14;

        for (const a of frag.atoms) {
            const info = ELEMENT[a.element];
            const go = new GameObject(a.element);
            go.transform.parent = root.transform;
            go.transform.localPosition = this._toWorld(a.pos);
            go.transform.localScale = new Vector3(info.radius, info.radius, info.radius);

            go.addComponent(MeshFilter).sharedMesh = this._atomMesh;
            go.addComponent(MeshRenderer).sharedMaterial = this._material(a.element);

            // Unit radius: the uniform localScale above gives it the right size.
            const col = go.addComponent(SphereCollider);
            col.radius = 1;

            elementOf.set(go, a.element);
        }

        for (const bond of frag.bonds) {
            this._buildBond(root, frag, bond);
        }

        root.setActive(false);
        return { root, rotator: rot };
    }

    // ── internals ───────────────────────────────────────────────────

    private _toWorld(p: V3): Vector3 {
        return new Vector3(p[0] * SCALE, p[1] * SCALE, p[2] * SCALE);
    }

    private _material(element: ElementKey): StandardMaterial {
        let mat = this._atomMaterials.get(element);
        if (!mat) {
            mat = new StandardMaterial();
            mat.albedoColor = ELEMENT[element].color;
            mat.smoothness = 0.55;
            mat.metallic = 0.05;
            this._atomMaterials.set(element, mat);
        }
        return mat;
    }

    private _buildBond(root: GameObject, frag: Frag, bond: Bond): void {
        const from = this._toWorld(frag.atoms[bond.a].pos);
        const to = this._toWorld(frag.atoms[bond.b].pos);

        const radius = bond.ionic ? IONIC_RADIUS : BOND_RADIUS;
        const mat = bond.ionic ? this._ionicMaterial : this._bondMaterial;
        const order = bond.ionic ? 1 : bond.order;

        // A double bond is two parallel sticks; a triple keeps one on the axis
        // and pushes the other two out, which reads better than three in a row.
        const offsets: number[] =
            order === 2 ? [MULTI_OFFSET, -MULTI_OFFSET]
                : order === 3 ? [0, MULTI_OFFSET * 1.5, -MULTI_OFFSET * 1.5]
                    : [0];

        const perp = this._perpendicular(from, to);
        for (const k of offsets) {
            this._stick(root, from, to, perp.clone().multiplyScalar(k), radius, mat);
        }
    }

    private _stick(
        root: GameObject, from: Vector3, to: Vector3,
        offset: Vector3, radius: number, mat: StandardMaterial,
    ): void {
        const dir = to.clone().subtract(from);
        const length = dir.magnitude();
        if (length <= 1e-6) return;

        const go = new GameObject("Bond");
        go.transform.parent = root.transform;
        go.transform.localPosition = from.clone().add(to).multiplyScalar(0.5).add(offset);

        // The cylinder mesh is Y-up; rotate that axis onto the bond direction.
        go.transform.localRotation = Quaternion.fromToRotation(Vector3.up, dir.normalized);
        go.transform.localScale = new Vector3(radius, length, radius);

        go.addComponent(MeshFilter).sharedMesh = this._bondMesh;
        go.addComponent(MeshRenderer).sharedMaterial = mat;
    }

    /** Any unit vector perpendicular to the bond, used to offset extra sticks. */
    private _perpendicular(from: Vector3, to: Vector3): Vector3 {
        const dir = to.clone().subtract(from).normalized;
        const reference = Math.abs(dir.y) > 0.9 ? Vector3.right : Vector3.up;
        return Vector3.cross(dir, reference).normalized;
    }
}
