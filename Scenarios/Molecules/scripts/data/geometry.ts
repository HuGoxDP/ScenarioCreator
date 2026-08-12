// scripts/data/geometry.ts
// ============================================================
// Builders that turn VSEPR shape names into real 3D coordinates.
//
// Everything here works in ångström on plain [x, y, z] tuples — the display
// scale and the engine's Vector3 are applied later, in MoleculeBuilder. Keeping
// the chemistry in physical units means bond lengths stay comparable between
// molecules instead of each one being normalised to look nice.
//
// Planar molecules are laid out in the XY plane on purpose: the Rotator spins
// around Y, so a flat molecule turns from face-on to edge-on as it rotates,
// which is exactly the view a student needs to see that it *is* flat.
// ============================================================

import type { ElementKey } from "./elements";

export type V3 = readonly [number, number, number];

export interface Atom {
    element: ElementKey;
    /** Position in ångström. */
    pos: V3;
}

export interface Bond {
    a: number;
    b: number;
    /** Sticks drawn in parallel: 1 single, 2 double, 3 triple. */
    order: number;
    /** Ionic bonds are drawn thinner and paler — they are not shared pairs. */
    ionic?: boolean;
}

export interface Frag {
    atoms: Atom[];
    bonds: Bond[];
}

// ==================== TUPLE MATH ====================

const RAD = Math.PI / 180;

export function add(a: V3, b: V3): V3 { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
export function sub(a: V3, b: V3): V3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
export function mul(a: V3, s: number): V3 { return [a[0] * s, a[1] * s, a[2] * s]; }

export function len(a: V3): number {
    return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
}

export function norm(a: V3): V3 {
    const m = len(a);
    return m > 1e-9 ? [a[0] / m, a[1] / m, a[2] / m] : [0, 0, 0];
}

export function cross(a: V3, b: V3): V3 {
    return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ];
}

/** Any unit vector perpendicular to `a`. Used to seed azimuthal fans. */
function anyPerp(a: V3): V3 {
    const ref: V3 = Math.abs(a[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    return norm(cross(a, ref));
}

export function atom(element: ElementKey, pos: V3): Atom {
    return { element, pos };
}

// ==================== sp³ COMPLETION ====================
//
// These answer "where do the *remaining* bonds of a tetrahedral atom point,
// given the ones already placed?". Chains and alcohols are built almost
// entirely out of them, which keeps every C–H sensible without hand-typing
// hundreds of coordinates.

const TET = 109.47 * RAD;

/**
 * Three directions completing a tetrahedral atom that already has one bond.
 * @param toNeighbour unit vector from the atom towards its known neighbour
 * @param phase azimuthal twist in degrees — offset by 60 for a staggered chain
 */
export function sp3From1(toNeighbour: V3, phase: number = 0): V3[] {
    const axis = norm(toNeighbour);
    const u = anyPerp(axis);
    const w = cross(axis, u);

    const cosT = Math.cos(TET);
    const sinT = Math.sin(TET);

    const out: V3[] = [];
    for (let k = 0; k < 3; k++) {
        const phi = (phase + k * 120) * RAD;
        out.push(norm(add(
            mul(axis, cosT),
            add(mul(u, sinT * Math.cos(phi)), mul(w, sinT * Math.sin(phi))),
        )));
    }
    return out;
}

/**
 * Two directions completing a tetrahedral atom that already has two bonds
 * (a -CH2- in a chain, or the two lone-pair-free slots of an ether oxygen).
 */
export function sp3From2(toA: V3, toB: V3): V3[] {
    const a = norm(toA);
    const b = norm(toB);

    // The remaining pair sits in the plane that bisects the known pair,
    // opening away from it.
    const bisector = norm(add(a, b));
    const perp = norm(cross(a, b));

    const half = TET / 2;
    const back = mul(bisector, -Math.cos(half));
    const side = mul(perp, Math.sin(half));

    return [norm(add(back, side)), norm(sub(back, side))];
}

/** The single direction completing a tetrahedral atom with three bonds placed. */
export function sp3From3(toA: V3, toB: V3, toC: V3): V3 {
    return norm(mul(add(add(norm(toA), norm(toB)), norm(toC)), -1));
}

// ==================== VSEPR SHAPES ====================

/** A–B, two atoms on the X axis. */
export function diatomic(e1: ElementKey, e2: ElementKey, d: number, order: number): Frag {
    return {
        atoms: [atom(e1, [-d / 2, 0, 0]), atom(e2, [d / 2, 0, 0])],
        bonds: [{ a: 0, b: 1, order }],
    };
}

/** B–A–B at 180°, e.g. CO₂, BeCl₂, CS₂. */
export function linear3(c: ElementKey, l: ElementKey, d: number, order: number): Frag {
    return {
        atoms: [atom(c, [0, 0, 0]), atom(l, [d, 0, 0]), atom(l, [-d, 0, 0])],
        bonds: [{ a: 0, b: 1, order }, { a: 0, b: 2, order }],
    };
}

/** B–A–B bent by `angle`, e.g. H₂O, SO₂, O₃. Opens along +Y, flat in XY. */
export function bent3(c: ElementKey, l: ElementKey, d: number, angle: number, order: number): Frag {
    const h = (angle / 2) * RAD;
    return {
        atoms: [
            atom(c, [0, 0, 0]),
            atom(l, [d * Math.sin(h), d * Math.cos(h), 0]),
            atom(l, [-d * Math.sin(h), d * Math.cos(h), 0]),
        ],
        bonds: [{ a: 0, b: 1, order }, { a: 0, b: 2, order }],
    };
}

/** Three ligands at 120° in the XY plane, e.g. BF₃, SO₃. */
export function trigonalPlanar(c: ElementKey, l: ElementKey, d: number, order: number): Frag {
    const atoms = [atom(c, [0, 0, 0])];
    const bonds: Bond[] = [];
    for (let k = 0; k < 3; k++) {
        const a = (90 + k * 120) * RAD;
        atoms.push(atom(l, [d * Math.cos(a), d * Math.sin(a), 0]));
        bonds.push({ a: 0, b: k + 1, order });
    }
    return { atoms, bonds };
}

/**
 * Three ligands in a pyramid, e.g. NH₃, PCl₃. For three equivalent bonds at
 * mutual angle α, each makes angle β with the symmetry axis where
 * cos α = 1.5·cos²β − 0.5.
 */
export function pyramidal(c: ElementKey, l: ElementKey, d: number, angle: number): Frag {
    const cosB = Math.sqrt((Math.cos(angle * RAD) + 0.5) / 1.5);
    const sinB = Math.sqrt(Math.max(0, 1 - cosB * cosB));

    const atoms = [atom(c, [0, 0, 0])];
    const bonds: Bond[] = [];
    for (let k = 0; k < 3; k++) {
        const a = k * 120 * RAD;
        atoms.push(atom(l, [d * sinB * Math.cos(a), -d * cosB, d * sinB * Math.sin(a)]));
        bonds.push({ a: 0, b: k + 1, order: 1 });
    }
    return { atoms, bonds };
}

/** Four ligands at 109.5°, e.g. CH₄, NH₄⁺, SO₄²⁻. */
export function tetrahedral(c: ElementKey, l: ElementKey, d: number, order: number): Frag {
    const t = d / Math.sqrt(3);
    const dirs: V3[] = [[t, t, t], [t, -t, -t], [-t, t, -t], [-t, -t, t]];
    return {
        atoms: [atom(c, [0, 0, 0]), ...dirs.map((p) => atom(l, p))],
        bonds: dirs.map((_, i) => ({ a: 0, b: i + 1, order })),
    };
}

/** Four ligands in a square, e.g. XeF₄. */
export function squarePlanar(c: ElementKey, l: ElementKey, d: number): Frag {
    const atoms = [atom(c, [0, 0, 0])];
    const bonds: Bond[] = [];
    for (let k = 0; k < 4; k++) {
        const a = k * 90 * RAD;
        atoms.push(atom(l, [d * Math.cos(a), d * Math.sin(a), 0]));
        bonds.push({ a: 0, b: k + 1, order: 1 });
    }
    return { atoms, bonds };
}

/** Two axial + three equatorial ligands, e.g. PCl₅. */
export function trigonalBipyramidal(c: ElementKey, l: ElementKey, dAx: number, dEq: number): Frag {
    const atoms = [atom(c, [0, 0, 0]), atom(l, [0, dAx, 0]), atom(l, [0, -dAx, 0])];
    const bonds: Bond[] = [{ a: 0, b: 1, order: 1 }, { a: 0, b: 2, order: 1 }];
    for (let k = 0; k < 3; k++) {
        const a = k * 120 * RAD;
        atoms.push(atom(l, [dEq * Math.cos(a), 0, dEq * Math.sin(a)]));
        bonds.push({ a: 0, b: k + 3, order: 1 });
    }
    return { atoms, bonds };
}

/** Six ligands along ±X, ±Y, ±Z, e.g. SF₆. */
export function octahedral(c: ElementKey, l: ElementKey, d: number): Frag {
    const dirs: V3[] = [[d, 0, 0], [-d, 0, 0], [0, d, 0], [0, -d, 0], [0, 0, d], [0, 0, -d]];
    return {
        atoms: [atom(c, [0, 0, 0]), ...dirs.map((p) => atom(l, p))],
        bonds: dirs.map((_, i) => ({ a: 0, b: i + 1, order: 1 })),
    };
}

/**
 * A rock-salt fragment: a 2×2×2 block of alternating ions. A single ion pair
 * would misrepresent NaCl — the point of the lesson is that there are no
 * discrete molecules, only a lattice.
 */
export function rockSalt(cation: ElementKey, anion: ElementKey, d: number): Frag {
    const atoms: Atom[] = [];
    const index = new Map<string, number>();

    for (let i = 0; i < 2; i++) {
        for (let j = 0; j < 2; j++) {
            for (let k = 0; k < 2; k++) {
                index.set(`${i}${j}${k}`, atoms.length);
                atoms.push(atom((i + j + k) % 2 === 0 ? cation : anion, [i * d, j * d, k * d]));
            }
        }
    }

    const bonds: Bond[] = [];
    for (let i = 0; i < 2; i++) {
        for (let j = 0; j < 2; j++) {
            for (let k = 0; k < 2; k++) {
                const from = index.get(`${i}${j}${k}`)!;
                if (i === 0) bonds.push({ a: from, b: index.get(`1${j}${k}`)!, order: 1, ionic: true });
                if (j === 0) bonds.push({ a: from, b: index.get(`${i}1${k}`)!, order: 1, ionic: true });
                if (k === 0) bonds.push({ a: from, b: index.get(`${i}${j}1`)!, order: 1, ionic: true });
            }
        }
    }

    return { atoms, bonds };
}

// ==================== ASSEMBLY ====================

/** Shifts a fragment so its centroid sits at the origin. */
export function centre(frag: Frag): Frag {
    const n = frag.atoms.length;
    if (n === 0) return frag;

    let cx = 0, cy = 0, cz = 0;
    for (const a of frag.atoms) { cx += a.pos[0]; cy += a.pos[1]; cz += a.pos[2]; }
    const c: V3 = [cx / n, cy / n, cz / n];

    return {
        atoms: frag.atoms.map((a) => atom(a.element, sub(a.pos, c))),
        bonds: frag.bonds,
    };
}

/**
 * Incremental builder for the molecules that no single VSEPR shape covers —
 * chains, alcohols, acids, rings.
 */
export class Sketch {
    readonly atoms: Atom[] = [];
    readonly bonds: Bond[] = [];

    /** Adds an atom and returns its index. */
    add(element: ElementKey, pos: V3): number {
        this.atoms.push(atom(element, pos));
        return this.atoms.length - 1;
    }

    bond(a: number, b: number, order: number = 1, ionic: boolean = false): this {
        this.bonds.push(ionic ? { a, b, order, ionic } : { a, b, order });
        return this;
    }

    pos(i: number): V3 {
        return this.atoms[i].pos;
    }

    /** Unit vector from atom `i` towards atom `j`. */
    dir(i: number, j: number): V3 {
        return norm(sub(this.pos(j), this.pos(i)));
    }

    /**
     * Caps atom `i` with hydrogens on the tetrahedral slots its existing
     * neighbours leave free.
     * @param neighbours indices already bonded to `i`
     * @param max stop after this many — an -OH oxygen takes 1 of its 3 slots
     */
    capH(i: number, neighbours: number[], d: number, phase: number = 0, max: number = 3): number[] {
        const all = neighbours.length === 1
            ? sp3From1(this.dir(i, neighbours[0]), phase)
            : neighbours.length === 2
                ? sp3From2(this.dir(i, neighbours[0]), this.dir(i, neighbours[1]))
                : [sp3From3(this.dir(i, neighbours[0]), this.dir(i, neighbours[1]), this.dir(i, neighbours[2]))];

        const dirs = all.slice(0, max);
        const made: number[] = [];
        for (const dir of dirs) {
            const h = this.add("H", add(this.pos(i), mul(dir, d)));
            this.bond(i, h, 1);
            made.push(h);
        }
        return made;
    }

    build(): Frag {
        return centre({ atoms: this.atoms, bonds: this.bonds });
    }
}
