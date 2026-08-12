// scripts/helpers/Ramp.ts
// ============================================================
// The bench: a ramp at a settable angle, a flat run after it, the blocks that
// slide down, and the force arrows.
//
// The RAMP is rotated and gravity stays vertical. Tilting gravity instead is
// easier to write and teaches the wrong model — a student who has seen the
// world tilt rather than the plane has learned that "downhill" is a direction
// gravity chooses.
//
// One world unit is one metre, everywhere in this scenario.
// ============================================================

import {
    GameObject, Vector3, Quaternion, Color,
    MeshFilter, MeshRenderer, LineRenderer, Mesh, StandardMaterial,
} from "WebEngineTS";

const RAD = Math.PI / 180;

const RAMP_THICKNESS = 0.35;
const BENCH_WIDTH = 3;

export interface Bench {
    root: GameObject;
    /** Re-lays the ramp for a new angle. */
    setAngle(angleDeg: number): void;
    /** Point on the block's path `s` metres from the start, on the surface. */
    surfaceAt(distance: number): Vector3;
    /** Outward normal of whichever surface the block is on at `s`. */
    normalAt(distance: number): Vector3;
    /** Unit vector pointing down the slope at `s`. */
    downhillAt(distance: number): Vector3;
}

function box(name: string, parent: GameObject, mesh: Mesh, material: StandardMaterial): GameObject {
    const go = new GameObject(name);
    go.transform.parent = parent.transform;
    go.addComponent(MeshFilter).sharedMesh = mesh;
    go.addComponent(MeshRenderer).sharedMaterial = material;
    return go;
}

function material(color: Color, smoothness: number): StandardMaterial {
    const mat = new StandardMaterial();
    mat.albedoColor = color;
    mat.smoothness = smoothness;
    mat.metallic = 0.05;
    return mat;
}

/**
 * Builds the bench.
 *
 * The foot of the ramp sits at the origin and the ramp rises to the left, so
 * the flat run extends along +X and the whole path is one increasing distance.
 */
export function createBench(slopeLength: number, groundLength: number): Bench {
    const root = new GameObject("Bench");
    const cube = Mesh.createCube(1);

    const ramp = box("Ramp", root, cube, material(new Color(0.42, 0.46, 0.55, 1), 0.25));
    const ground = box("Ground", root, cube, material(new Color(0.30, 0.34, 0.40, 1), 0.15));
    ground.transform.localScale = new Vector3(groundLength, RAMP_THICKNESS, BENCH_WIDTH);
    ground.transform.localPosition = new Vector3(groundLength / 2, -RAMP_THICKNESS / 2, 0);

    let angle = 30;

    const bench: Bench = {
        root,

        setAngle(angleDeg: number): void {
            angle = angleDeg;
            const normal = bench.normalAt(0);
            const top = bench.surfaceAt(0);

            ramp.transform.localScale = new Vector3(slopeLength, RAMP_THICKNESS, BENCH_WIDTH);
            ramp.transform.localRotation = Quaternion.euler(0, 0, -angleDeg);
            // Centre of the slab: midway along the surface, half a thickness in
            // along the inward normal.
            ramp.transform.localPosition = new Vector3(
                top.x / 2 - normal.x * RAMP_THICKNESS / 2,
                top.y / 2 - normal.y * RAMP_THICKNESS / 2,
                0,
            );
        },

        surfaceAt(distance: number): Vector3 {
            if (distance >= slopeLength) return new Vector3(distance - slopeLength, 0, 0);
            const cos = Math.cos(angle * RAD);
            const sin = Math.sin(angle * RAD);
            // Top of the ramp, then `distance` metres down it.
            return new Vector3(-slopeLength * cos + distance * cos, slopeLength * sin - distance * sin, 0);
        },

        normalAt(distance: number): Vector3 {
            if (distance >= slopeLength) return new Vector3(0, 1, 0);
            return new Vector3(Math.sin(angle * RAD), Math.cos(angle * RAD), 0);
        },

        downhillAt(distance: number): Vector3 {
            if (distance >= slopeLength) return new Vector3(1, 0, 0);
            return new Vector3(Math.cos(angle * RAD), -Math.sin(angle * RAD), 0);
        },
    };

    bench.setAngle(angle);
    return bench;
}

// ==================== BLOCK ====================

export interface Block {
    root: GameObject;
    /** Places the block on the surface at path distance `s`. */
    place(bench: Bench, distance: number, offsetZ: number): void;
    /** Appends to the trail, or clears it when `distance` is 0. */
    trail(point: Vector3, clear: boolean): void;
    setSize(size: number): void;
    setVisible(visible: boolean): void;
    readonly centre: Vector3;
}

const TRAIL_CAPACITY = 240;

export function createBlock(parent: GameObject, color: Color): Block {
    const root = new GameObject("Block");
    root.transform.parent = parent.transform;

    const body = box("Body", root, Mesh.createCube(1), material(color, 0.4));
    let size = 0.8;
    let centre = new Vector3(0, 0, 0);

    const trailGo = new GameObject("Trail");
    trailGo.transform.parent = parent.transform;
    const trailLine = trailGo.addComponent(LineRenderer);
    // Bench-local, like everything else here: the whole bench is shifted to
    // centre it on the camera's orbit point, and world-space lines would stay
    // behind when it moves.
    trailLine.useWorldSpace = false;
    trailLine.startWidth = 0.04;
    trailLine.endWidth = 0.04;
    trailLine.startColor = new Color(color.r, color.g, color.b, 0.8);
    trailLine.endColor = trailLine.startColor;
    const points: Vector3[] = [];

    return {
        root,
        get centre(): Vector3 { return centre; },

        setSize(next: number): void {
            size = next;
            body.transform.localScale = new Vector3(size, size, size);
        },

        setVisible(visible: boolean): void {
            root.setActive(visible);
            trailGo.setActive(visible && points.length > 1);
        },

        place(bench: Bench, distance: number, offsetZ: number): void {
            const surface = bench.surfaceAt(distance);
            const normal = bench.normalAt(distance);
            centre = new Vector3(
                surface.x + normal.x * size / 2,
                surface.y + normal.y * size / 2,
                offsetZ,
            );
            root.transform.localPosition = centre;
            // The block lies flat on whatever it is standing on.
            root.transform.localRotation = Quaternion.fromToRotation(Vector3.up, normal);
        },

        trail(point: Vector3, clear: boolean): void {
            if (clear) {
                points.length = 0;
                trailGo.setActive(false);
                return;
            }
            const last = points[points.length - 1];
            if (last && Math.abs(last.x - point.x) < 0.05 && Math.abs(last.y - point.y) < 0.05) return;

            points.push(point.clone());
            // Fixed capacity: an unbounded trail is a memory leak with a nice
            // appearance.
            if (points.length > TRAIL_CAPACITY) points.shift();
            if (points.length > 1) {
                trailGo.setActive(true);
                trailLine.setPositions(points);
            }
        },
    };
}

// ==================== FORCE ARROWS ====================

/**
 * One labelled force, drawn as a shaft and two head strokes in the XY plane.
 *
 * Lines rather than a cone mesh: the whole diagram lives in one plane, the
 * head reads correctly from the side the camera starts on, and there is no
 * winding to get wrong on geometry nobody can inspect here.
 */
export class VectorArrow {
    private readonly _shaft: LineRenderer;
    private readonly _headA: LineRenderer;
    private readonly _headB: LineRenderer;

    constructor(parent: GameObject, name: string, public readonly color: Color) {
        const make = (suffix: string): LineRenderer => {
            const go = new GameObject(`${name} ${suffix}`);
            go.transform.parent = parent.transform;
            const line = go.addComponent(LineRenderer);
            line.useWorldSpace = false;
            line.startWidth = 0.05;
            line.endWidth = 0.05;
            line.startColor = color;
            line.endColor = color;
            return line;
        };
        this._shaft = make("shaft");
        this._headA = make("head A");
        this._headB = make("head B");
        this.hide();
    }

    hide(): void {
        this._shaft.gameObject.setActive(false);
        this._headA.gameObject.setActive(false);
        this._headB.gameObject.setActive(false);
    }

    /** @param length metres of arrow, already scaled from newtons by the caller. */
    show(from: Vector3, direction: Vector3, length: number): void {
        if (length < 0.05) { this.hide(); return; }

        const dir = direction.clone().normalized;
        const tip = new Vector3(from.x + dir.x * length, from.y + dir.y * length, from.z + dir.z * length);
        const head = Math.min(0.3, length * 0.35);
        // Perpendicular in the XY plane — the plane the whole bench lives in.
        const side = new Vector3(-dir.y, dir.x, 0);

        this._shaft.gameObject.setActive(true);
        this._headA.gameObject.setActive(true);
        this._headB.gameObject.setActive(true);

        this._shaft.setPositions([from.clone(), tip]);
        this._headA.setPositions([tip.clone(), new Vector3(
            tip.x - dir.x * head + side.x * head * 0.6,
            tip.y - dir.y * head + side.y * head * 0.6,
            tip.z,
        )]);
        this._headB.setPositions([tip.clone(), new Vector3(
            tip.x - dir.x * head - side.x * head * 0.6,
            tip.y - dir.y * head - side.y * head * 0.6,
            tip.z,
        )]);
    }
}
