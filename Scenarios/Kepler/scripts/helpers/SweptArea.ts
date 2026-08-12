// scripts/helpers/SweptArea.ts
// ============================================================
// Kepler's second law, drawn.
//
// Every T/12 of the period a sector is closed and shaded: a fan of triangles
// from the focus out to the arc the body actually travelled. The sectors near
// periapsis come out short and fat, the ones near apoapsis long and thin, and
// their areas are the same — which is the law.
//
// EVERY TRIANGLE IS WOUND BOTH WAYS. A fan built with the wrong winding is
// backface-culled and simply invisible, which is indistinguishable from "the
// area code never ran". Duplicating the indices costs a few hundred triangles
// and removes the failure mode entirely.
// ============================================================

import {
    GameObject, Vector3, Vector2, Color, Mesh,
    MeshFilter, MeshRenderer, StandardMaterial, MaterialRenderMode,
} from "WebEngineTS";

/** Sectors kept on screen — one orbit's worth. */
export const SECTOR_COUNT = 12;

export interface Sector {
    /** Area actually swept, AU². */
    area: number;
}

export class SweptArea {
    private readonly _slots: GameObject[] = [];
    private readonly _meshes: (Mesh | null)[] = [];
    private readonly _areas: number[] = [];
    private _next = 0;

    private _points: [number, number][] = [];
    private _area = 0;

    constructor(root: GameObject) {
        const material = new StandardMaterial();
        material.albedoColor = new Color(0.42, 0.72, 1.0, 0.30);
        material.emissionColor = new Color(0.10, 0.22, 0.38, 1);
        material.renderMode = MaterialRenderMode.Fade;

        for (let i = 0; i < SECTOR_COUNT; i++) {
            const go = new GameObject(`Sector ${i}`);
            go.transform.parent = root.transform;
            go.addComponent(MeshFilter);
            go.addComponent(MeshRenderer).sharedMaterial = material;
            go.setActive(false);
            this._slots.push(go);
            this._meshes.push(null);
            this._areas.push(0);
        }
    }

    get areas(): number[] {
        return this._areas.filter((area) => area > 0);
    }

    clear(): void {
        for (let i = 0; i < SECTOR_COUNT; i++) {
            this._slots[i].setActive(false);
            this._areas[i] = 0;
        }
        this._next = 0;
        this._points = [];
        this._area = 0;
    }

    /** Adds the body's current position to the sector being swept. */
    sample(x: number, y: number): void {
        const last = this._points[this._points.length - 1];
        if (last) {
            // Twice the triangle area between two successive radii — this is
            // the same quantity as ∫L/2 dt, accumulated geometrically.
            this._area += 0.5 * Math.abs(last[0] * y - last[1] * x);
        }
        this._points.push([x, y]);
    }

    /** Closes the sector under construction and starts the next one. */
    close(): void {
        if (this._points.length < 3) {
            this._points = this._points.slice(-1);
            this._area = 0;
            return;
        }

        const slot = this._next % SECTOR_COUNT;
        const mesh = buildFan(this._points);
        this._slots[slot].getComponent(MeshFilter)!.sharedMesh = mesh;
        this._slots[slot].setActive(true);
        this._meshes[slot] = mesh;
        this._areas[slot] = this._area;
        this._next++;

        // The next sector starts where this one ended, so no gap appears.
        this._points = this._points.slice(-1);
        this._area = 0;
    }
}

/** A triangle fan from the focus at the origin out to `points`. */
function buildFan(points: [number, number][]): Mesh {
    const mesh = new Mesh("Sector");
    const vertices: Vector3[] = [new Vector3(0, 0, 0)];
    for (const [x, y] of points) vertices.push(new Vector3(x, y, 0));

    const triangles: number[] = [];
    for (let i = 1; i < vertices.length - 1; i++) {
        triangles.push(0, i, i + 1);
        // The same triangle the other way round, so it is visible from either
        // side regardless of the winding convention.
        triangles.push(0, i + 1, i);
    }

    mesh.vertices = vertices;
    mesh.uv = vertices.map(() => new Vector2(0, 0));
    mesh.triangles = triangles;
    mesh.recalculateNormals();
    mesh.recalculateBounds();
    return mesh;
}
