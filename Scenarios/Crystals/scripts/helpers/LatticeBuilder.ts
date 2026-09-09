// scripts/helpers/LatticeBuilder.ts
// ============================================================
// Turns a structure plus a cell count into instances.
//
// Two instanced renderers do the whole job — one for atoms, one for bonds —
// with fixed capacities, so a five-cell block of a thousand ions costs two
// draw calls and the scene-graph size never depends on which structure is
// selected. Rebuilding is a rewrite of instance transforms, not a rebuild of
// the scene.
// ============================================================

import {
    GameObject, Vector3, Quaternion, Color, Mesh,
    InstancedMeshRenderer, StandardMaterial, LineRenderer,
} from "WebEngineTS";

import { elementInfo } from "../data/elements";
import { latticeVectors, toCartesian, type Structure } from "../data/structures";

/** Ångström → world units. */
export const SCALE = 0.62;

/** A fractional coordinate folded into [0, 1); 1 is the same site as 0. */
function wrapFrac(f: number): number {
    return f - Math.floor(f + 1e-6);
}

const ATOM_CAPACITY = 1300;
const BOND_CAPACITY = 2600;

/** Bonds stop being drawn past this many cells — see `bondsDrawn`. */
export const BOND_CELL_LIMIT = 3;

const BOND_RADIUS = 0.055;
const OUTSIDE_DIM = 0.34;

export interface LatticeOptions {
    cells: number;
    /** Draw ions at their true relative radii, touching. */
    spaceFilling: boolean;
    bonds: boolean;
    /** Highlight the cell at the origin and dim everything else. */
    highlightCell: boolean;
    /** 0…1 — hide everything past this fraction along X. */
    cut: number;
}

export interface LatticeResult {
    atoms: number;
    bonds: number;
    /** Half-diagonal of the block, world units — the camera frames on it. */
    extent: number;
    /** False when bonds were asked for but suppressed by the cell limit. */
    bondsDrawn: boolean;
}

export class LatticeBuilder {
    private readonly _atoms: InstancedMeshRenderer;
    private readonly _bonds: InstancedMeshRenderer;
    private readonly _cellEdges: LineRenderer[] = [];

    private readonly _scratch = new Vector3(0, 0, 0);
    private readonly _scale = new Vector3(1, 1, 1);

    constructor(root: GameObject) {
        const atomsGo = new GameObject("Atoms");
        atomsGo.transform.parent = root.transform;
        this._atoms = atomsGo.addComponent(InstancedMeshRenderer);
        this._atoms.mesh = Mesh.createSphere(1, 12);
        this._atoms.sharedMaterial = solid(new Color(1, 1, 1, 1), 0.5);
        this._atoms.count = ATOM_CAPACITY;

        const bondsGo = new GameObject("Bonds");
        bondsGo.transform.parent = root.transform;
        this._bonds = bondsGo.addComponent(InstancedMeshRenderer);
        this._bonds.mesh = Mesh.createCylinder(1, 1, 8);
        this._bonds.sharedMaterial = solid(new Color(0.72, 0.75, 0.82, 1), 0.35);
        this._bonds.count = BOND_CAPACITY;

        const cellGo = new GameObject("Unit cell");
        cellGo.transform.parent = root.transform;
        for (let i = 0; i < 12; i++) {
            const go = new GameObject(`Cell edge ${i}`);
            go.transform.parent = cellGo.transform;
            const line = go.addComponent(LineRenderer);
            line.useWorldSpace = false;
            line.startWidth = 0.05;
            line.endWidth = 0.05;
            line.startColor = new Color(1, 0.85, 0.35, 1);
            line.endColor = line.startColor;
            this._cellEdges.push(line);
        }
    }

    build(structure: Structure, options: LatticeOptions): LatticeResult {
        const cells = Math.max(1, Math.round(options.cells));
        const vectors = latticeVectors(structure);

        // Centre the block on the origin so the camera orbits its middle.
        const centre: [number, number, number] = [0, 0, 0];
        for (const v of vectors) {
            centre[0] += v[0] * cells / 2;
            centre[1] += v[1] * cells / 2;
            centre[2] += v[2] * cells / 2;
        }

        const positions: number[][] = [];
        const elements: string[] = [];
        const inOriginCell: boolean[] = [];

        // One past the last cell on every axis, keeping only what lands on or
        // inside the block. Tiling the basis alone leaves every site at a
        // fractional coordinate below 1, so a single cell drew eight ions bunched
        // in one octant of a box eight times their volume — the outline looked
        // unrelated to the contents, and no ion had the six neighbours the
        // scenario's own caption promises. The extra copies are the periodic
        // images sitting on the far faces, edges and corners, which is how a unit
        // cell is drawn anywhere it is drawn at all.
        for (let i = 0; i <= cells; i++) {
            for (let j = 0; j <= cells; j++) {
                for (let k = 0; k <= cells; k++) {
                    for (const site of structure.basis) {
                        // Wrapped into [0, 1) first. A basis may legitimately name
                        // a site at fraction 1 — NaCl's does, for two of its
                        // chlorides — and that is the same site as 0 one cell over.
                        // Tiled as written it can only ever land on the far face,
                        // so the near one came out four ions short of a full grid.
                        const u = wrapFrac(site.frac[0]) + i;
                        const v = wrapFrac(site.frac[1]) + j;
                        const w = wrapFrac(site.frac[2]) + k;
                        if (u > cells + 1e-6 || v > cells + 1e-6 || w > cells + 1e-6) continue;

                        const at = toCartesian(structure, u, v, w);
                        positions.push([
                            (at[0] - centre[0]) * SCALE,
                            (at[1] - centre[1]) * SCALE,
                            (at[2] - centre[2]) * SCALE,
                        ]);
                        elements.push(site.element);
                        // On or inside the origin cell, boundary images included:
                        // they belong to it as much as to the neighbour they came
                        // from, and the highlight is about which box you are
                        // looking at.
                        inOriginCell.push(u <= 1 + 1e-6 && v <= 1 + 1e-6 && w <= 1 + 1e-6);
                    }
                }
            }
        }

        const cutX = this._cutPlane(positions, options.cut);
        const visible = positions.map((p) => p[0] <= cutX);

        let extent = 0;
        let drawn = 0;
        for (let i = 0; i < positions.length && drawn < ATOM_CAPACITY; i++) {
            if (!visible[i]) continue;

            const info = elementInfo(elements[i]);
            const radius = (options.spaceFilling ? info.real : info.stick) * SCALE;
            const p = positions[i];

            this._scratch.set(p[0], p[1], p[2]);
            this._scale.set(radius, radius, radius);
            this._atoms.setInstanceTransform(drawn, this._scratch, Quaternion.identity, this._scale);

            const dim = options.highlightCell && !inOriginCell[i];
            this._atoms.setInstanceColor(drawn, dim ? dimmed(info.color) : info.color);

            extent = Math.max(extent, Math.hypot(p[0], p[1], p[2]) + radius);
            drawn++;
        }
        this._park(this._atoms, drawn, ATOM_CAPACITY);
        this._atoms.apply();

        const bondsDrawn = options.bonds && structure.bondCutoff > 0 && cells <= BOND_CELL_LIMIT;
        const bondCount = bondsDrawn
            ? this._buildBonds(structure, positions, visible)
            : 0;
        this._park(this._bonds, bondCount, BOND_CAPACITY);
        this._bonds.apply();

        this._drawCell(structure, centre, options.highlightCell);

        return { atoms: drawn, bonds: bondCount, extent, bondsDrawn };
    }

    // ── internals ───────────────────────────────────────────────────

    /** X coordinate the cross-section cuts at; `cut = 1` keeps everything. */
    private _cutPlane(positions: number[][], cut: number): number {
        if (cut >= 0.999) return Number.POSITIVE_INFINITY;
        let min = Number.POSITIVE_INFINITY;
        let max = Number.NEGATIVE_INFINITY;
        for (const p of positions) {
            min = Math.min(min, p[0]);
            max = Math.max(max, p[0]);
        }
        return min + (max - min) * cut;
    }

    private _buildBonds(structure: Structure, positions: number[][], visible: boolean[]): number {
        const cutoff = structure.bondCutoff * SCALE;
        let count = 0;

        for (let i = 0; i < positions.length && count < BOND_CAPACITY; i++) {
            if (!visible[i]) continue;
            for (let j = i + 1; j < positions.length && count < BOND_CAPACITY; j++) {
                if (!visible[j]) continue;

                const dx = positions[j][0] - positions[i][0];
                const dy = positions[j][1] - positions[i][1];
                const dz = positions[j][2] - positions[i][2];
                const length = Math.hypot(dx, dy, dz);
                if (length > cutoff || length < 1e-6) continue;

                this._scratch.set(
                    positions[i][0] + dx / 2,
                    positions[i][1] + dy / 2,
                    positions[i][2] + dz / 2,
                );
                this._scale.set(BOND_RADIUS, length, BOND_RADIUS);
                // The cylinder mesh is Y-up; turn that axis onto the bond.
                const rotation = Quaternion.fromToRotation(
                    Vector3.up, new Vector3(dx, dy, dz).normalized,
                );
                this._bonds.setInstanceTransform(count, this._scratch, rotation, this._scale);
                count++;
            }
        }
        return count;
    }

    /** The unit cell at the origin, as a wireframe parallelepiped. */
    private _drawCell(structure: Structure, centre: [number, number, number], show: boolean): void {
        for (const edge of this._cellEdges) edge.gameObject.setActive(show);
        if (!show) return;

        const corner = (u: number, v: number, w: number): Vector3 => {
            const at = toCartesian(structure, u, v, w);
            return new Vector3(
                (at[0] - centre[0]) * SCALE,
                (at[1] - centre[1]) * SCALE,
                (at[2] - centre[2]) * SCALE,
            );
        };

        const edges: [Vector3, Vector3][] = [
            [corner(0, 0, 0), corner(1, 0, 0)],
            [corner(0, 0, 0), corner(0, 1, 0)],
            [corner(0, 0, 0), corner(0, 0, 1)],
            [corner(1, 0, 0), corner(1, 1, 0)],
            [corner(1, 0, 0), corner(1, 0, 1)],
            [corner(0, 1, 0), corner(1, 1, 0)],
            [corner(0, 1, 0), corner(0, 1, 1)],
            [corner(0, 0, 1), corner(1, 0, 1)],
            [corner(0, 0, 1), corner(0, 1, 1)],
            [corner(1, 1, 0), corner(1, 1, 1)],
            [corner(1, 0, 1), corner(1, 1, 1)],
            [corner(0, 1, 1), corner(1, 1, 1)],
        ];
        edges.forEach((edge, i) => this._cellEdges[i].setPositions([edge[0], edge[1]]));
    }

    /**
     * Shrinks the unused instances to nothing instead of resizing the batch.
     *
     * `count` stays at capacity so the renderer never reallocates, and a
     * zero-scale instance draws nothing.
     */
    private _park(renderer: InstancedMeshRenderer, from: number, capacity: number): void {
        this._scale.set(0, 0, 0);
        for (let i = from; i < capacity; i++) {
            renderer.setInstanceTransform(i, Vector3.zero, Quaternion.identity, this._scale);
        }
    }
}

function solid(color: Color, smoothness: number): StandardMaterial {
    const material = new StandardMaterial();
    material.albedoColor = color;
    material.smoothness = smoothness;
    material.metallic = 0.1;
    return material;
}

function dimmed(color: Color): Color {
    return new Color(color.r * OUTSIDE_DIM, color.g * OUTSIDE_DIM, color.b * OUTSIDE_DIM, 1);
}
