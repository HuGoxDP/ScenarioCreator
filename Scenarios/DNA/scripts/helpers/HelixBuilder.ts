// scripts/helpers/HelixBuilder.ts
// ============================================================
// B-DNA geometry, from the real numbers rather than "a spiral".
//
//   rise            3.4 Å per base pair
//   twist           360° / 10.5 bp  =  34.29° per base pair
//   diameter        20 Å
//   strand offset   240°, NOT 180°
//
// That last constant is the one that matters. Put the two backbones opposite
// each other and the model is a ladder twisted at random; offset them by 240°
// and the major and minor grooves appear on their own, because the two chords
// between the strands are then 240° and 120° apart.
//
// Unwinding is interpolation, not physics: every base knows its wound position
// and its open one, and `setOpen` lerps between them. A rigid-body simulation
// of a helix would be a different scenario and a worse one.
// ============================================================

import {
    GameObject, Vector3, Quaternion, Color,
    MeshFilter, MeshRenderer, LineRenderer, Mesh, StandardMaterial, SphereCollider,
} from "WebEngineTS";

import { BASE_COLOR, bondCount, templateFor } from "../data/sequences";

/** Ångström → world units. Exported so the camera can frame by real size. */
export const SCALE = 0.12;

const RISE = 3.4;
const TWIST = 360 / 10.5;
const HELIX_RADIUS = 10;

/** Backbone phase offset. See the header — this is where the grooves come from. */
const STRAND_PHASE = 240;

/** Half the gap between the two bases of a pair, world units. */
const PAIR_GAP = 0.16;
/** How far apart the strands bow inside the open window. */
const SEPARATION = 1.15;
/** Bases over which the window ramps open, so the bubble has shoulders. */
const RAMP = 1.4;

const BACKBONE_WIDTH = 0.13;
const BASE_RADIUS = 0.085;
const BOND_RADIUS = 0.022;
/** Backbone points per base — 10.5 bases to a turn is visibly faceted at 1. */
const SUBDIVISIONS = 4;

/** Where the mRNA strand is built, clear of the helix. */
export const MRNA_X = 4.2;

export interface BasePair {
    index: number;
    /** Letter on the coding strand, and its partner on the template. */
    coding: string;
    template: string;
    /** Base sticks, one per strand. */
    sticks: [GameObject, GameObject];
    bonds: GameObject[];
    /** How far this pair is currently opened, 0…1. */
    open: number;
}

export interface BaseRef {
    strand: "coding" | "template" | "mrna";
    index: number;
    base: string;
}

export interface BuiltHelix {
    root: GameObject;
    pairs: BasePair[];
    /** World height of the whole strand — the camera frames on it. */
    height: number;
    /** Opens a window of pairs centred on `center`; a negative centre closes it. */
    setOpen(center: number, halfWidth: number): void;
}

/** Shared geometry, so 36 base pairs do not allocate 36 meshes. */
export class HelixBuilder {
    private readonly _stickMesh: Mesh;
    private readonly _pickMesh: Mesh;
    private readonly _bondMat: StandardMaterial;
    private readonly _baseMats = new Map<string, StandardMaterial>();

    constructor() {
        this._stickMesh = Mesh.createCylinder(1, 1, 10);
        this._pickMesh = Mesh.createSphere(1, 8);

        this._bondMat = new StandardMaterial();
        this._bondMat.albedoColor = new Color(0.80, 0.84, 0.92, 1);
        this._bondMat.smoothness = 0.3;
    }

    // ── the double helix ────────────────────────────────────────────

    build(coding: string, refs: Map<GameObject, BaseRef>): BuiltHelix {
        const template = templateFor(coding);
        const count = coding.length;

        const root = new GameObject("DNA");
        const pairs: BasePair[] = [];

        const spines: LineRenderer[] = [0, 1].map((strand) => {
            const go = new GameObject(strand === 0 ? "Backbone (coding)" : "Backbone (template)");
            go.transform.parent = root.transform;
            const line = go.addComponent(LineRenderer);
            line.useWorldSpace = false;
            line.startWidth = BACKBONE_WIDTH;
            line.endWidth = BACKBONE_WIDTH;
            line.numCornerVertices = 4;
            const tint = strand === 0
                ? new Color(0.62, 0.70, 0.88, 1)
                : new Color(0.52, 0.60, 0.78, 1);
            line.startColor = tint;
            line.endColor = tint;
            return line;
        });

        for (let i = 0; i < count; i++) {
            const pair: BasePair = {
                index: i,
                coding: coding[i],
                template: template[i],
                sticks: [
                    this._makeStick(root, BASE_COLOR[coding[i]]),
                    this._makeStick(root, BASE_COLOR[template[i]]),
                ],
                bonds: [],
                open: 0,
            };

            const bonds = bondCount(coding[i]);
            for (let b = 0; b < bonds; b++) {
                const go = new GameObject("H-bond");
                go.transform.parent = root.transform;
                go.addComponent(MeshFilter).sharedMesh = this._stickMesh;
                go.addComponent(MeshRenderer).sharedMaterial = this._bondMat;
                pair.bonds.push(go);
            }

            // Pickable target on each base's inner end. A collider around the
            // whole stick would overlap its partner's and make the click
            // ambiguous exactly where the two bases meet.
            refs.set(this._makePick(pair.sticks[0]), { strand: "coding", index: i, base: coding[i] });
            refs.set(this._makePick(pair.sticks[1]), { strand: "template", index: i, base: template[i] });

            pairs.push(pair);
        }

        const helix: BuiltHelix = {
            root,
            pairs,
            height: (count - 1) * RISE * SCALE,
            setOpen: (center: number, halfWidth: number) => {
                for (const pair of pairs) {
                    pair.open = center < 0 ? 0 : clamp01((halfWidth - Math.abs(pair.index - center)) / RAMP);
                }
                this._layout(pairs, spines, center, halfWidth);
            },
        };

        helix.setOpen(-1, 0);
        return helix;
    }

    // ── layout ──────────────────────────────────────────────────────

    /** Recomputes every transform for the current open window. */
    private _layout(
        pairs: BasePair[], spines: LineRenderer[],
        center: number, halfWidth: number,
    ): void {
        const openAt = (u: number): number =>
            center < 0 ? 0 : clamp01((halfWidth - Math.abs(u - center)) / RAMP);

        for (const pair of pairs) {
            const t = pair.open;
            const outer0 = nodeAt(pair.index, 0, t);
            const outer1 = nodeAt(pair.index, 1, t);
            const mid = outer0.clone().add(outer1).multiplyScalar(0.5);

            const dir0 = mid.clone().subtract(outer0).normalized;
            const dir1 = mid.clone().subtract(outer1).normalized;
            const inner0 = mid.clone().subtract(dir0.clone().multiplyScalar(PAIR_GAP));
            const inner1 = mid.clone().subtract(dir1.clone().multiplyScalar(PAIR_GAP));

            orient(pair.sticks[0], outer0, inner0, BASE_RADIUS);
            orient(pair.sticks[1], outer1, inner1, BASE_RADIUS);

            // Hydrogen bonds break as soon as the strands part, which is the
            // whole point of the unwinding step.
            const bonded = t < 0.15;
            const spacing = 0.055;
            pair.bonds.forEach((bond, b) => {
                bond.setActive(bonded);
                if (!bonded) return;
                const lift = (b - (pair.bonds.length - 1) / 2) * spacing;
                const from = inner0.clone(); from.y += lift;
                const to = inner1.clone(); to.y += lift;
                orient(bond, from, to, BOND_RADIUS);
            });
        }

        const last = pairs.length - 1;
        for (const strand of [0, 1] as const) {
            const points: Vector3[] = [];
            for (let j = 0; j <= last * SUBDIVISIONS; j++) {
                const u = j / SUBDIVISIONS;
                points.push(nodeAt(u, strand, openAt(u)));
            }
            spines[strand].setPositions(points);
        }
    }

    // ── parts ───────────────────────────────────────────────────────

    private _makeStick(root: GameObject, color: Color): GameObject {
        const go = new GameObject("Base");
        go.transform.parent = root.transform;
        go.addComponent(MeshFilter).sharedMesh = this._stickMesh;
        go.addComponent(MeshRenderer).sharedMaterial = this._baseMaterial(color);
        return go;
    }

    private _makePick(stick: GameObject): GameObject {
        const go = new GameObject("Pick");
        go.transform.parent = stick.transform;
        // The stick is scaled (radius, length, radius); a child at the tip in
        // local space rides along with it for free.
        go.transform.localPosition = new Vector3(0, 0.42, 0);
        go.transform.localScale = new Vector3(1.6, 0.18, 1.6);
        go.addComponent(MeshFilter).sharedMesh = this._pickMesh;
        go.addComponent(SphereCollider).radius = 1;
        return go;
    }

    private _baseMaterial(color: Color): StandardMaterial {
        const key = `${color.r},${color.g},${color.b}`;
        let mat = this._baseMats.get(key);
        if (!mat) {
            mat = new StandardMaterial();
            mat.albedoColor = color;
            mat.smoothness = 0.45;
            this._baseMats.set(key, mat);
        }
        return mat;
    }

    // ── the messenger strand ────────────────────────────────────────

    /**
     * mRNA is built straight, not helical, and off to the side. Real mRNA is a
     * floppy single strand; drawn as a ruler it can be read letter by letter,
     * which is what the codon table needs from it.
     */
    buildMessenger(rna: string, refs: Map<GameObject, BaseRef>): MessengerStrand {
        const root = new GameObject("mRNA");
        const bases: GameObject[] = [];

        const spineGo = new GameObject("mRNA backbone");
        spineGo.transform.parent = root.transform;
        const spine = spineGo.addComponent(LineRenderer);
        spine.useWorldSpace = false;
        spine.startWidth = BACKBONE_WIDTH;
        spine.endWidth = BACKBONE_WIDTH;
        spine.startColor = new Color(0.85, 0.72, 0.55, 1);
        spine.endColor = new Color(0.85, 0.72, 0.55, 1);

        for (let i = 0; i < rna.length; i++) {
            const go = this._makeStick(root, BASE_COLOR[rna[i]]);
            const y = i * RISE * SCALE;
            orient(go, new Vector3(MRNA_X, y, 0), new Vector3(MRNA_X - 0.75, y, 0), BASE_RADIUS);
            go.setActive(false);
            refs.set(this._makePick(go), { strand: "mrna", index: i, base: rna[i] });
            bases.push(go);
        }

        return {
            root,
            bases,
            yOf: (index: number) => index * RISE * SCALE,
            setLength(length: number): void {
                bases.forEach((go, i) => go.setActive(i < length));
                const points: Vector3[] = [];
                for (let i = 0; i < Math.max(length, 2); i++) {
                    points.push(new Vector3(MRNA_X, i * RISE * SCALE, 0));
                }
                spine.setPositions(points);
                spineGo.setActive(length > 1);
            },
        };
    }
}

export interface MessengerStrand {
    root: GameObject;
    bases: GameObject[];
    /** World Y of base `index` — the ribosome and polymerase ride on this. */
    yOf(index: number): number;
    setLength(length: number): void;
}

// ==================== GEOMETRY ====================

/**
 * Backbone node for a (possibly fractional) base index.
 *
 * Fractional indices are what lets the backbone be subdivided: the helix is a
 * continuous curve, and the base pairs are just the integer samples of it.
 */
function nodeAt(u: number, strand: 0 | 1, open: number): Vector3 {
    const a0 = u * TWIST * Math.PI / 180;
    const a1 = a0 + STRAND_PHASE * Math.PI / 180;
    const y = u * RISE * SCALE;
    const r = HELIX_RADIUS * SCALE;

    const p0 = new Vector3(Math.cos(a0) * r, y, Math.sin(a0) * r);
    const p1 = new Vector3(Math.cos(a1) * r, y, Math.sin(a1) * r);
    const point = strand === 0 ? p0 : p1;
    if (open <= 0) return point;

    // Both strands bow outward along the chord between them, so the pair opens
    // in the middle while each base stays attached to its own backbone.
    const mid = p0.clone().add(p1).multiplyScalar(0.5);
    const outward = point.clone().subtract(mid).normalized;
    return point.add(outward.multiplyScalar(open * SEPARATION));
}

/** Places a unit cylinder so it spans `from` → `to`. */
function orient(go: GameObject, from: Vector3, to: Vector3, radius: number): void {
    const dir = to.clone().subtract(from);
    const length = dir.magnitude();
    if (length <= 1e-6) return;

    go.transform.localPosition = from.clone().add(to).multiplyScalar(0.5);
    // The cylinder mesh is Y-up; rotate that axis onto the span.
    go.transform.localRotation = Quaternion.fromToRotation(Vector3.up, dir.normalized);
    go.transform.localScale = new Vector3(radius, length, radius);
}

function clamp01(value: number): number {
    return value < 0 ? 0 : value > 1 ? 1 : value;
}
