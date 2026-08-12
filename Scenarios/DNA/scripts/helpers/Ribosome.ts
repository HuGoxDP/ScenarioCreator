// scripts/helpers/Ribosome.ts
// ============================================================
// The machinery that moves along the strands: RNA polymerase for
// transcription, and the ribosome, its tRNA and the growing peptide for
// translation.
//
// Everything here is pooled and repositioned, never created per step. A
// twelve-codon run that allocated a tRNA per codon would leak twelve objects
// and make the scene-graph size depend on how far the student had stepped —
// which the render check compares between load paths.
// ============================================================

import {
    GameObject, Vector3, Quaternion, Color,
    MeshFilter, MeshRenderer, Mesh, StandardMaterial, MaterialRenderMode,
} from "WebEngineTS";

import { MRNA_X } from "./HelixBuilder";
import { CLASS_COLOR, type AcidClass } from "../data/genetic-code";

/** Beads the peptide pool can hold — the longest sequence is twelve codons. */
const PEPTIDE_CAPACITY = 24;
const BEAD_SPACING = 0.44;
const BEAD_RADIUS = 0.22;

function translucent(color: Color, alpha: number): StandardMaterial {
    const mat = new StandardMaterial();
    mat.albedoColor = new Color(color.r, color.g, color.b, alpha);
    mat.renderMode = MaterialRenderMode.Fade;
    mat.smoothness = 0.35;
    return mat;
}

function solid(color: Color, smoothness = 0.5): StandardMaterial {
    const mat = new StandardMaterial();
    mat.albedoColor = color;
    mat.smoothness = smoothness;
    return mat;
}

function blob(parent: GameObject, mesh: Mesh, mat: StandardMaterial, at: Vector3, scale: Vector3): GameObject {
    const go = new GameObject("Blob");
    go.transform.parent = parent.transform;
    go.transform.localPosition = at;
    go.transform.localScale = scale;
    go.addComponent(MeshFilter).sharedMesh = mesh;
    go.addComponent(MeshRenderer).sharedMaterial = mat;
    return go;
}

/** The enzyme that travels the double helix and reads the template strand. */
export class Polymerase {
    readonly root: GameObject;

    constructor(mesh: Mesh) {
        this.root = new GameObject("RNA polymerase");
        blob(this.root, mesh, translucent(new Color(0.55, 0.85, 0.70, 1), 0.42),
            Vector3.zero, new Vector3(2.4, 1.7, 2.4));
        this.root.setActive(false);
    }

    /** Rides the helix axis; a negative y parks it. */
    moveTo(y: number): void {
        this.root.setActive(y >= 0);
        if (y >= 0) this.root.transform.localPosition = new Vector3(0, y, 0);
    }
}

/** Ribosome, one tRNA and the peptide it is stringing together. */
export class Ribosome {
    readonly root: GameObject;

    private readonly _body: GameObject;
    private readonly _tRna: GameObject;
    private readonly _tRnaBead: GameObject;
    private readonly _beads: GameObject[] = [];
    private readonly _classMats = new Map<AcidClass, StandardMaterial>();

    constructor(sphere: Mesh, cylinder: Mesh) {
        this.root = new GameObject("Ribosome");

        // Two subunits clamped around the mRNA, translucent so the codon being
        // read stays visible through them.
        this._body = new GameObject("Subunits");
        this._body.transform.parent = this.root.transform;
        const bodyMat = translucent(new Color(0.72, 0.66, 0.85, 1), 0.45);
        blob(this._body, sphere, bodyMat, new Vector3(MRNA_X + 0.15, 0.75, 0), new Vector3(1.7, 1.35, 1.6));
        blob(this._body, sphere, bodyMat, new Vector3(MRNA_X + 0.15, -0.55, 0), new Vector3(1.35, 1.0, 1.3));
        this._body.setActive(false);

        // tRNA: a stem into the codon, an anticodon triplet at the bottom of it,
        // and the amino acid it carries at the top.
        this._tRna = new GameObject("tRNA");
        this._tRna.transform.parent = this.root.transform;
        const stemMat = solid(new Color(0.55, 0.72, 0.62, 1), 0.3);

        const stem = new GameObject("Stem");
        stem.transform.parent = this._tRna.transform;
        stem.transform.localPosition = new Vector3(0.8, 0.55, 0);
        stem.transform.localRotation = Quaternion.euler(0, 0, -42);
        stem.transform.localScale = new Vector3(0.07, 1.25, 0.07);
        stem.addComponent(MeshFilter).sharedMesh = cylinder;
        stem.addComponent(MeshRenderer).sharedMaterial = stemMat;

        for (let i = 0; i < 3; i++) {
            const anticodon = new GameObject("Anticodon");
            anticodon.transform.parent = this._tRna.transform;
            anticodon.transform.localPosition = new Vector3(0.28, (i - 1) * 0.16, 0);
            anticodon.transform.localRotation = Quaternion.euler(0, 0, 90);
            anticodon.transform.localScale = new Vector3(0.035, 0.32, 0.035);
            anticodon.addComponent(MeshFilter).sharedMesh = cylinder;
            anticodon.addComponent(MeshRenderer).sharedMaterial = stemMat;
        }

        this._tRnaBead = blob(this._tRna, sphere, solid(Color.white),
            new Vector3(1.45, 1.15, 0), new Vector3(BEAD_RADIUS, BEAD_RADIUS, BEAD_RADIUS));
        this._tRna.setActive(false);

        for (let i = 0; i < PEPTIDE_CAPACITY; i++) {
            const bead = blob(this.root, sphere, solid(new Color(0.8, 0.8, 0.8, 1)),
                Vector3.zero, new Vector3(BEAD_RADIUS, BEAD_RADIUS, BEAD_RADIUS));
            bead.setActive(false);
            this._beads.push(bead);
        }
    }

    show(visible: boolean): void {
        this._body.setActive(visible);
        if (!visible) {
            this._tRna.setActive(false);
            for (const bead of this._beads) bead.setActive(false);
        }
    }

    /** Clamps onto the codon whose first base sits at world `y`. */
    moveTo(y: number): void {
        this._body.transform.localPosition = new Vector3(0, y, 0);
    }

    /** Docks the tRNA at `y` carrying an acid of the given class. */
    showTRna(y: number, cls: AcidClass): void {
        this._tRna.setActive(true);
        this._tRna.transform.localPosition = new Vector3(MRNA_X, y, 0);
        this._tRnaBead.getComponent(MeshRenderer)!.sharedMaterial = this._classMaterial(cls);
    }

    hideTRna(): void {
        this._tRna.setActive(false);
    }

    /**
     * Redraws the whole chain from the class list.
     *
     * Rebuilt rather than appended so stepping backwards is the same code path
     * as stepping forwards — a chain that can only grow makes «Назад» a lie.
     */
    setPeptide(classes: AcidClass[], anchorY: number): void {
        this._beads.forEach((bead, i) => {
            const active = i < classes.length;
            bead.setActive(active);
            if (!active) return;

            bead.getComponent(MeshRenderer)!.sharedMaterial = this._classMaterial(classes[i]);
            // The chain trails out of the exit tunnel and hangs below it, so the
            // oldest residue is the furthest away.
            const fromEnd = classes.length - 1 - i;
            bead.transform.localPosition = new Vector3(
                MRNA_X + 1.9 + (fromEnd % 2) * 0.18,
                anchorY + 1.1 - fromEnd * BEAD_SPACING,
                (fromEnd % 2 === 0 ? 0.16 : -0.16),
            );
        });
    }

    private _classMaterial(cls: AcidClass): StandardMaterial {
        let mat = this._classMats.get(cls);
        if (!mat) {
            mat = solid(CLASS_COLOR[cls], 0.6);
            this._classMats.set(cls, mat);
        }
        return mat;
    }
}
