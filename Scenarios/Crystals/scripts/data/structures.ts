// scripts/data/structures.ts
// ============================================================
// Eight crystal structures, from their real lattice constants and bases.
//
// Fractional coordinates only. `frac × lattice vectors` happens in the builder;
// storing world positions would make the table unreadable and impossible to
// check against a reference.
//
// The density is NOT stored. It is computed on screen from ρ = Z·M/(N_A·V_cell)
// and compared against the handbook value in `density`, which is there to be
// checked against — if a structure comes out wrong by a factor of two or four,
// `perCell` is counting atoms where it should count formula units.
// ============================================================

export type Bonding = "ionic" | "covalent" | "metallic" | "molecular";

export const BONDING_LABEL: Record<Bonding, string> = {
    ionic: "Йонний",
    covalent: "Ковалентний",
    metallic: "Металічний",
    molecular: "Молекулярний (Ван-дер-Ваальс)",
};

export interface Site {
    element: string;
    /** Fractional coordinates along a1, a2, a3. */
    frac: [number, number, number];
}

export interface Structure {
    key: string;
    name: string;
    /** Lattice type, Ukrainian. */
    type: string;
    /** Lattice constant a, ångström. */
    a: number;
    /** Second constant for hexagonal cells; equals `a` for cubic ones. */
    c: number;
    hexagonal: boolean;
    basis: Site[];
    /** Coordination number — countable on screen with bonds on. */
    coordination: number;
    /** Formula units per unit cell. */
    perCell: number;
    /** Molar mass of one formula unit, g/mol. */
    molarMass: number;
    /** Handbook density, г/см³ — the target the computed value must hit. */
    density: number;
    bonding: Bonding;
    /** Neighbours closer than this (ångström) get a bond drawn. */
    bondCutoff: number;
    fact: string;
}

const FCC: [number, number, number][] = [
    [0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5],
];

function fcc(element: string): Site[] {
    return FCC.map((frac) => ({ element, frac }));
}

export const STRUCTURES: Structure[] = [
    {
        key: "nacl",
        name: "Кухонна сіль NaCl",
        type: "Гранецентрована кубічна (ГЦК)",
        a: 5.640, c: 5.640, hexagonal: false,
        basis: [
            ...fcc("Na"),
            ...FCC.map((f) => ({ element: "Cl", frac: [f[0] + 0.5, f[1], f[2]] as [number, number, number] })),
        ],
        coordination: 6, perCell: 4, molarMass: 58.44, density: 2.16,
        bonding: "ionic", bondCutoff: 2.9,
        fact: "Кожен йон Натрію оточений шістьма хлоридами, і навпаки. Увімкніть «Йонні радіуси» — хлорид удвічі більший, а натрій сидить у проміжках між ними.",
    },
    {
        key: "cscl",
        name: "Хлорид цезію CsCl",
        type: "Проста кубічна, йонна",
        a: 4.110, c: 4.110, hexagonal: false,
        basis: [
            { element: "Cs", frac: [0, 0, 0] },
            { element: "Cl", frac: [0.5, 0.5, 0.5] },
        ],
        coordination: 8, perCell: 1, molarMass: 168.36, density: 3.99,
        bonding: "ionic", bondCutoff: 3.7,
        fact: "Цезій завеликий, щоб уміститися у проміжки ГЦК-ґратки, тому бере вісім сусідів замість шести. Це НЕ об'ємноцентрована ґратка: у центрі інший елемент.",
    },
    {
        key: "diamond",
        name: "Алмаз C",
        type: "Кубічна алмазна",
        a: 3.567, c: 3.567, hexagonal: false,
        basis: [
            ...fcc("C"),
            ...FCC.map((f) => ({ element: "C", frac: [f[0] + 0.25, f[1] + 0.25, f[2] + 0.25] as [number, number, number] })),
        ],
        coordination: 4, perCell: 8, molarMass: 12.011, density: 3.51,
        bonding: "covalent", bondCutoff: 1.6,
        fact: "Кожен атом Карбону зв'язаний з чотирма іншими під кутом 109.5°. Суцільна сітка міцних ковалентних зв'язків — тому алмаз найтвердіший.",
    },
    {
        key: "graphite",
        name: "Графіт C",
        type: "Гексагональна шарувата",
        a: 2.460, c: 6.708, hexagonal: true,
        basis: [
            // Layer A: the honeycomb pair. Layer B: one atom directly above an
            // A atom, the other over the centre of an A hexagon — the AB
            // stacking that makes graphite slide.
            { element: "C", frac: [0, 0, 0] },
            { element: "C", frac: [1 / 3, 1 / 3, 0] },
            { element: "C", frac: [0, 0, 0.5] },
            { element: "C", frac: [2 / 3, 2 / 3, 0.5] },
        ],
        coordination: 3, perCell: 4, molarMass: 12.011, density: 2.27,
        bonding: "covalent", bondCutoff: 1.5,
        fact: "Той самий Карбон, що й алмаз, але шарами: три міцні зв'язки в площині й майже нічого між шарами. Тому графіт залишає слід на папері.",
    },
    {
        key: "copper",
        name: "Мідь Cu",
        type: "Гранецентрована кубічна (ГЦК)",
        a: 3.615, c: 3.615, hexagonal: false,
        basis: fcc("Cu"),
        coordination: 12, perCell: 4, molarMass: 63.546, density: 8.96,
        bonding: "metallic", bondCutoff: 2.7,
        fact: "Найщільніша можлива упаковка куль: дванадцять сусідів у кожного атома, 74 % простору зайнято. Шари ковзають один по одному — тому мідь кується.",
    },
    {
        key: "iron",
        name: "Залізо α-Fe",
        type: "Об'ємноцентрована кубічна (ОЦК)",
        a: 2.866, c: 2.866, hexagonal: false,
        basis: [
            { element: "Fe", frac: [0, 0, 0] },
            { element: "Fe", frac: [0.5, 0.5, 0.5] },
        ],
        coordination: 8, perCell: 2, molarMass: 55.845, density: 7.87,
        bonding: "metallic", bondCutoff: 2.6,
        fact: "Вісім сусідів замість дванадцяти й лише 68 % заповнення. Вище 911 °C залізо перебудовується у ГЦК — і саме на цьому тримається загартування сталі.",
    },
    {
        key: "magnesium",
        name: "Магній Mg",
        type: "Гексагональна щільна (ГЩУ)",
        a: 3.209, c: 5.211, hexagonal: true,
        basis: [
            { element: "Mg", frac: [0, 0, 0] },
            { element: "Mg", frac: [1 / 3, 1 / 3, 0.5] },
        ],
        coordination: 12, perCell: 2, molarMass: 24.305, density: 1.738,
        bonding: "metallic", bondCutoff: 3.4,
        fact: "Друга щільна упаковка: теж 74 % і теж дванадцять сусідів, але шари чергуються ABAB замість ABC, як у міді.",
    },
    {
        key: "argon",
        name: "Твердий аргон Ar",
        type: "Гранецентрована кубічна (ГЦК)",
        a: 5.311, c: 5.311, hexagonal: false,
        basis: fcc("Ar"),
        coordination: 12, perCell: 4, molarMass: 39.948, density: 1.77,
        bonding: "molecular", bondCutoff: 0,
        fact: "Атоми тримаються лише слабким притяганням Ван-дер-Ваальса, тому кристал плавиться за −189 °C. Зв'язків не намальовано — їх фактично немає.",
    },
];

/** Lattice vectors in ångström, for a cubic or a hexagonal cell. */
export function latticeVectors(structure: Structure): [number, number, number][] {
    if (!structure.hexagonal) {
        return [[structure.a, 0, 0], [0, structure.a, 0], [0, 0, structure.a]];
    }
    // c along Y, the hexagonal plane in XZ, so the layers stack visibly upward.
    //
    // a1 and a2 are 60° apart, NOT the 120° of the usual crystallographic
    // setting. That choice moves the basis: the honeycomb partner and the HCP
    // second atom both sit at (1/3, 1/3) here, where a 120° cell would put them
    // at (1/3, 2/3). Getting this wrong leaves the structure looking plausible
    // and the coordination number wrong, which is why the guard below counts
    // neighbours rather than trusting the table.
    return [
        [structure.a, 0, 0],
        [structure.a / 2, 0, structure.a * Math.sqrt(3) / 2],
        [0, structure.c, 0],
    ];
}

/** Volume of one unit cell, ångström³ — the scalar triple product. */
export function cellVolume(structure: Structure): number {
    const [a1, a2, a3] = latticeVectors(structure);
    const cross: [number, number, number] = [
        a2[1] * a3[2] - a2[2] * a3[1],
        a2[2] * a3[0] - a2[0] * a3[2],
        a2[0] * a3[1] - a2[1] * a3[0],
    ];
    return Math.abs(a1[0] * cross[0] + a1[1] * cross[1] + a1[2] * cross[2]);
}

export const AVOGADRO = 6.02214076e23;

/**
 * ρ = Z·M / (N_A · V), in г/см³.
 *
 * The unit cell volume is in ångström³ and 1 Å³ = 1e-24 cm³.
 */
export function computedDensity(structure: Structure): number {
    return (structure.perCell * structure.molarMass) / (AVOGADRO * cellVolume(structure) * 1e-24);
}

/** Cartesian position of a fractional coordinate, ångström. */
export function toCartesian(structure: Structure, u: number, v: number, w: number): [number, number, number] {
    const [a1, a2, a3] = latticeVectors(structure);
    return [
        u * a1[0] + v * a2[0] + w * a3[0],
        u * a1[1] + v * a2[1] + w * a3[1],
        u * a1[2] + v * a2[2] + w * a3[2],
    ];
}

/** Neighbours of one basis atom inside `bondCutoff`, searched over ±2 cells. */
export function neighboursOf(structure: Structure, siteIndex: number): number {
    const site = structure.basis[siteIndex];
    const at = toCartesian(structure, site.frac[0], site.frac[1], site.frac[2]);
    let count = 0;

    for (let i = -2; i <= 2; i++) {
        for (let j = -2; j <= 2; j++) {
            for (let k = -2; k <= 2; k++) {
                for (const other of structure.basis) {
                    const q = toCartesian(structure, other.frac[0] + i, other.frac[1] + j, other.frac[2] + k);
                    const distance = Math.hypot(q[0] - at[0], q[1] - at[1], q[2] - at[2]);
                    if (distance > 1e-6 && distance <= structure.bondCutoff) count++;
                }
            }
        }
    }
    return count;
}

/**
 * Development guard, run once at load.
 *
 * Two things are checked, and both are invisible on screen when wrong:
 *
 *  - **Density.** A factor of two or four means `perCell` is counting atoms
 *    where it should count formula units — the classic error.
 *  - **Coordination.** The readout claims a number the student is invited to
 *    count with bonds turned on, so it has to be the number the geometry
 *    actually produces. This caught a real mistake: the hexagonal basis was
 *    written for a 120° cell while `latticeVectors` builds a 60° one, which
 *    left graphite with one neighbour instead of three and magnesium with ten
 *    instead of twelve — and both structures still looked plausible.
 */
export function validateStructures(): string[] {
    const problems: string[] = [];

    for (const structure of STRUCTURES) {
        const computed = computedDensity(structure);
        const error = Math.abs(computed - structure.density) / structure.density;
        if (error > 0.02) {
            problems.push(`${structure.key}: computed ρ = ${computed.toFixed(3)}, handbook ${structure.density}`);
        }
        if (structure.basis.length === 0) problems.push(`${structure.key}: empty basis`);
        if (structure.bondCutoff <= 0) continue;

        for (let i = 0; i < structure.basis.length; i++) {
            const found = neighboursOf(structure, i);
            if (found !== structure.coordination) {
                problems.push(`${structure.key}: site ${i} has ${found} neighbours, stated coordination ${structure.coordination}`);
            }
        }
    }
    return problems;
}
