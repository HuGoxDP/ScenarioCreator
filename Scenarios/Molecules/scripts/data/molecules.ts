// scripts/data/molecules.ts
// ============================================================
// The catalogue. Bond lengths are in ångström and bond angles in degrees,
// both taken from standard structural data — the geometry a student measures
// on these models is the geometry in the textbook.
//
// Where a molecule is a resonance hybrid (O₃, NO₂, CO₃²⁻, benzene) the sticks
// draw one Kekulé structure, because a stick model cannot show a half bond.
// The `fact` line says so explicitly rather than letting the picture lie.
// ============================================================

import {
    type Frag, type V3, Sketch,
    add, mul, norm, sp3From1,
    bent3, centre, diatomic, linear3, octahedral, pyramidal, rockSalt,
    squarePlanar, tetrahedral, trigonalBipyramidal, trigonalPlanar,
} from "./geometry";

const RAD = Math.PI / 180;

/** Unit vector at `deg` in the XY plane. */
function xy(deg: number): V3 {
    return [Math.cos(deg * RAD), Math.sin(deg * RAD), 0];
}

export type CategoryKey =
    | "simple" | "inorganic" | "shapes" | "organic" | "acids" | "ions" | "extra";

export interface Category {
    key: CategoryKey;
    label: string;
}

export const CATEGORIES: Category[] = [
    { key: "simple",    label: "Прості" },
    { key: "inorganic", label: "Неорганічні" },
    { key: "shapes",    label: "Форми" },
    { key: "organic",   label: "Органічні" },
    { key: "acids",     label: "Кислоти" },
    { key: "ions",      label: "Йони та солі" },
    { key: "extra",     label: "Додатково" },
];

export interface MoleculeDef {
    formula: string;
    name: string;
    geometry: string;
    bondAngle: string;
    bondType: string;
    fact: string;
    /** A molecule may teach more than one lesson — CH₄ is both shape and organic. */
    categories: CategoryKey[];
    frag: Frag;
}

// ==================== CUSTOM STRUCTURES ====================

/** N≡N⁺–O⁻ — linear and asymmetric, unlike CO₂. */
function nitrousOxide(): Frag {
    const s = new Sketch();
    const nc = s.add("N", [0, 0, 0]);
    const nt = s.add("N", [-1.13, 0, 0]);
    const o = s.add("O", [1.19, 0, 0]);
    s.bond(nc, nt, 3).bond(nc, o, 1);
    return s.build();
}

function ethane(): Frag {
    const s = new Sketch();
    const c1 = s.add("C", [-0.77, 0, 0]);
    const c2 = s.add("C", [0.77, 0, 0]);
    s.bond(c1, c2, 1);
    s.capH(c1, [c2], 1.09, 0);
    s.capH(c2, [c1], 1.09, 60);   // staggered
    return s.build();
}

function ethylene(): Frag {
    const s = new Sketch();
    const c1 = s.add("C", [-0.665, 0, 0]);
    const c2 = s.add("C", [0.665, 0, 0]);
    s.bond(c1, c2, 2);

    // sp² carbon: H–C=C is 121.5°, all six atoms coplanar.
    for (const sign of [1, -1]) {
        const h1 = s.add("H", add(s.pos(c1), mul(xy(sign * 121.5), 1.09)));
        s.bond(c1, h1, 1);
        const h2 = s.add("H", add(s.pos(c2), mul(xy(sign * 58.5), 1.09)));
        s.bond(c2, h2, 1);
    }
    return s.build();
}

function acetylene(): Frag {
    const s = new Sketch();
    const c1 = s.add("C", [-0.60, 0, 0]);
    const c2 = s.add("C", [0.60, 0, 0]);
    const h1 = s.add("H", [-1.66, 0, 0]);
    const h2 = s.add("H", [1.66, 0, 0]);
    s.bond(c1, c2, 3).bond(c1, h1, 1).bond(c2, h2, 1);
    return s.build();
}

/** Zigzag alkane of `n` carbons: C–C 1.54 Å, C–C–C 112°. */
function alkane(n: number): Frag {
    const s = new Sketch();
    const b = 1.54;
    const tilt = 34 * RAD;          // half of (180 − 112)

    const carbons: number[] = [];
    let x = 0;
    for (let i = 0; i < n; i++) {
        carbons.push(s.add("C", [x, i % 2 === 0 ? 0 : b * Math.sin(tilt), 0]));
        x += b * Math.cos(tilt);
    }
    for (let i = 0; i < n - 1; i++) s.bond(carbons[i], carbons[i + 1], 1);

    for (let i = 0; i < n; i++) {
        const nb = [carbons[i - 1], carbons[i + 1]].filter((v) => v !== undefined);
        s.capH(carbons[i], nb, 1.09);
    }
    return s.build();
}

/** Methanol / ethanol: an alkyl chain with a terminal –OH. */
function alcohol(carbons: number): Frag {
    const s = new Sketch();
    const cs: number[] = [];
    for (let i = 0; i < carbons; i++) cs.push(s.add("C", [i * 1.52, 0, 0]));
    for (let i = 0; i < carbons - 1; i++) s.bond(cs[i], cs[i + 1], 1);

    const last = cs[carbons - 1];
    const away: V3 = carbons === 1 ? [1, 0, 0] : sp3From1(s.dir(last, cs[carbons - 2]))[0];
    const o = s.add("O", add(s.pos(last), mul(norm(away), 1.43)));
    s.bond(last, o, 1);

    for (let i = 0; i < carbons; i++) {
        const nb = [cs[i - 1], cs[i + 1] ?? (i === carbons - 1 ? o : undefined)]
            .filter((v) => v !== undefined);
        s.capH(cs[i], nb, 1.09);
    }
    s.capH(o, [last], 0.96, 0, 1);
    return s.build();
}

function aceticAcid(): Frag {
    const s = new Sketch();
    const c1 = s.add("C", [0, 0, 0]);          // methyl
    const c2 = s.add("C", [1.52, 0, 0]);       // carboxyl, sp²
    s.bond(c1, c2, 1);

    const od = s.add("O", add(s.pos(c2), mul(xy(60), 1.21)));    // C=O
    const oh = s.add("O", add(s.pos(c2), mul(xy(-60), 1.36)));   // C–OH
    s.bond(c2, od, 2).bond(c2, oh, 1);

    s.capH(c1, [c2], 1.09);
    s.capH(oh, [c2], 0.97, 0, 1);
    return s.build();
}

function benzene(): Frag {
    const s = new Sketch();
    const r = 1.39;                 // regular hexagon: side === radius
    const cs: number[] = [];
    const hs: number[] = [];

    for (let k = 0; k < 6; k++) {
        const dir = xy(k * 60);
        cs.push(s.add("C", mul(dir, r)));
        hs.push(s.add("H", mul(dir, r + 1.08)));
    }
    for (let k = 0; k < 6; k++) {
        s.bond(cs[k], cs[(k + 1) % 6], k % 2 === 0 ? 2 : 1);
        s.bond(cs[k], hs[k], 1);
    }
    return s.build();
}

/** Oxoacid on a tetrahedral centre: `nDouble` X=O plus the rest as X–O–H. */
function oxoacid(
    centreEl: "S" | "P", nDouble: number, dDouble: number, dSingle: number,
): Frag {
    const s = new Sketch();
    const x = s.add(centreEl, [0, 0, 0]);
    const t = 1 / Math.sqrt(3);
    const dirs: V3[] = [[t, t, t], [t, -t, -t], [-t, t, -t], [-t, -t, t]];

    dirs.forEach((dir, i) => {
        const double = i < nDouble;
        const o = s.add("O", mul(dir, double ? dDouble : dSingle));
        s.bond(x, o, double ? 2 : 1);
        if (!double) s.capH(o, [x], 0.97, 0, 1);
    });
    return s.build();
}

/** HNO₃ — planar: one N=O, one N–O⁻, one N–OH. */
function nitricAcid(): Frag {
    const s = new Sketch();
    const n = s.add("N", [0, 0, 0]);

    const od = s.add("O", mul(xy(90), 1.21));
    const om = s.add("O", mul(xy(210), 1.22));
    const oh = s.add("O", mul(xy(330), 1.41));
    s.bond(n, od, 2).bond(n, om, 1).bond(n, oh, 1);
    s.capH(oh, [n], 0.96, 0, 1);
    return s.build();
}

/** Ozone — drawn as one Kekulé form; both bonds are really 1.5. */
function ozone(): Frag {
    const s = new Sketch();
    const h = (116.8 / 2) * RAD;
    const oc = s.add("O", [0, 0, 0]);
    const o1 = s.add("O", [1.28 * Math.sin(h), 1.28 * Math.cos(h), 0]);
    const o2 = s.add("O", [-1.28 * Math.sin(h), 1.28 * Math.cos(h), 0]);
    s.bond(oc, o1, 2).bond(oc, o2, 1);
    return s.build();
}

/** H₂O₂ — the textbook example of a non-planar molecule (dihedral ≈ 111°). */
function hydrogenPeroxide(): Frag {
    const s = new Sketch();
    const o1 = s.add("O", [-0.735, 0, 0]);
    const o2 = s.add("O", [0.735, 0, 0]);
    s.bond(o1, o2, 1);

    const a = 100 * RAD;
    const dih = 111 * RAD;
    const h1 = s.add("H", add(s.pos(o1), mul([Math.cos(a), Math.sin(a), 0], 0.95)));
    const h2 = s.add("H", add(s.pos(o2), mul(
        [-Math.cos(a), Math.sin(a) * Math.cos(dih), Math.sin(a) * Math.sin(dih)], 0.95,
    )));
    s.bond(o1, h1, 1).bond(o2, h2, 1);
    return s.build();
}

/** Ca²⁺ sitting over a planar CO₃²⁻ — an ion pair, not a covalent molecule. */
function calciumCarbonate(): Frag {
    const s = new Sketch();
    const c = s.add("C", [0, 0, 0]);
    const os: number[] = [];
    for (let k = 0; k < 3; k++) {
        const o = s.add("O", mul(xy(90 + k * 120), 1.29));
        s.bond(c, o, k === 0 ? 2 : 1);
        os.push(o);
    }
    const ca = s.add("Ca", [0, 0, 2.6]);
    for (const o of os) s.bond(ca, o, 1, true);
    return s.build();
}

/** Al₂O₃ formula unit: two Al bridged by O, each with a terminal O. */
function aluminaUnit(): Frag {
    const s = new Sketch();
    const ob = s.add("O", [0, 0, 0]);
    const al1 = s.add("Al", mul(xy(150), 1.86));
    const al2 = s.add("Al", mul(xy(30), 1.86));
    s.bond(al1, ob, 1, true).bond(al2, ob, 1, true);

    const o1 = s.add("O", add(s.pos(al1), mul(xy(200), 1.86)));
    const o2 = s.add("O", add(s.pos(al2), mul(xy(-20), 1.86)));
    s.bond(al1, o1, 1, true).bond(al2, o2, 1, true);
    return s.build();
}

// ==================== CATALOGUE ====================

export const MOLECULES: MoleculeDef[] = [
    // ── Прості речовини ──────────────────────────────────────────
    {
        formula: "H₂", name: "Водень", categories: ["simple"],
        geometry: "Лінійна", bondAngle: "—", bondType: "Ковалентний неполярний",
        fact: "Найпростіша молекула: одна спільна електронна пара утримує два ядра на відстані 0,74 Å.",
        frag: centre(diatomic("H", "H", 0.74, 1)),
    },
    {
        formula: "O₂", name: "Кисень", categories: ["simple"],
        geometry: "Лінійна", bondAngle: "—", bondType: "Подвійний ковалентний",
        fact: "Подвійний зв'язок коротший і міцніший за одинарний — тому кисень значно стійкіший за пероксид.",
        frag: centre(diatomic("O", "O", 1.21, 2)),
    },
    {
        formula: "N₂", name: "Азот", categories: ["simple"],
        geometry: "Лінійна", bondAngle: "—", bondType: "Потрійний ковалентний",
        fact: "Потрійний зв'язок — один із найміцніших у природі. Саме тому азот повітря майже інертний.",
        frag: centre(diatomic("N", "N", 1.10, 3)),
    },
    {
        formula: "Cl₂", name: "Хлор", categories: ["simple"],
        geometry: "Лінійна", bondAngle: "—", bondType: "Ковалентний неполярний",
        fact: "Зв'язок довший за F–F, але міцніший: у Флуору неподілені пари надто тісні й відштовхуються.",
        frag: centre(diatomic("Cl", "Cl", 1.99, 1)),
    },
    {
        formula: "F₂", name: "Фтор", categories: ["simple"],
        geometry: "Лінійна", bondAngle: "—", bondType: "Ковалентний неполярний",
        fact: "Найкоротший зв'язок серед галогенів і водночас найслабший — звідси надзвичайна реакційність.",
        frag: centre(diatomic("F", "F", 1.42, 1)),
    },
    {
        formula: "Br₂", name: "Бром", categories: ["simple"],
        geometry: "Лінійна", bondAngle: "—", bondType: "Ковалентний неполярний",
        fact: "Найдовший зв'язок у трійці F–Cl–Br: зі зростанням радіуса атома зв'язок слабшає.",
        frag: centre(diatomic("Br", "Br", 2.28, 1)),
    },

    // ── Неорганічні ──────────────────────────────────────────────
    {
        formula: "H₂O", name: "Вода", categories: ["inorganic"],
        geometry: "Кутова", bondAngle: "104,5°", bondType: "Ковалентний полярний",
        fact: "Кут менший за тетраедричний через дві неподілені пари на Оксигені — вони відштовхують зв'язки сильніше.",
        frag: centre(bent3("O", "H", 0.96, 104.5, 1)),
    },
    {
        formula: "CO₂", name: "Карбон діоксид", categories: ["inorganic"],
        geometry: "Лінійна", bondAngle: "180°", bondType: "Подвійний ковалентний",
        fact: "Зв'язки полярні, але через симетрію їхні дипольні моменти взаємно компенсуються.",
        frag: centre(linear3("C", "O", 1.16, 2)),
    },
    {
        formula: "CO", name: "Карбон монооксид", categories: ["inorganic"],
        geometry: "Лінійна", bondAngle: "—", bondType: "Потрійний ковалентний",
        fact: "Потрійний зв'язок робить чадний газ схожим на N₂ — і дозволяє йому міцно зв'язувати гемоглобін.",
        frag: centre(diatomic("C", "O", 1.13, 3)),
    },
    {
        formula: "NH₃", name: "Амоніак", categories: ["inorganic"],
        geometry: "Тригональна пірамідальна", bondAngle: "107°", bondType: "Ковалентний полярний",
        fact: "Неподілена пара на Нітрогені стискає кут і робить молекулу донором електронів у реакціях.",
        frag: centre(pyramidal("N", "H", 1.01, 107)),
    },
    {
        formula: "H₂S", name: "Сірководень", categories: ["inorganic"],
        geometry: "Кутова", bondAngle: "92,1°", bondType: "Ковалентний слабополярний",
        fact: "Кут майже прямий: великий атом Сульфуру майже не використовує гібридизацію, зв'язки — чисті p-орбіталі.",
        frag: centre(bent3("S", "H", 1.34, 92.1, 1)),
    },
    {
        formula: "SO₂", name: "Сульфур діоксид", categories: ["inorganic"],
        geometry: "Кутова", bondAngle: "119°", bondType: "Подвійний ковалентний",
        fact: "На відміну від CO₂, неподілена пара на Сульфурі згинає молекулу — тому SO₂ полярний.",
        frag: centre(bent3("S", "O", 1.43, 119, 2)),
    },
    {
        formula: "SO₃", name: "Сульфур триоксид", categories: ["inorganic"],
        geometry: "Тригональна плоска", bondAngle: "120°", bondType: "Подвійний ковалентний",
        fact: "Неподілених пар немає — молекула плоска й неполярна. З водою дає сульфатну кислоту.",
        frag: centre(trigonalPlanar("S", "O", 1.42, 2)),
    },
    {
        formula: "NO", name: "Нітроген монооксид", categories: ["inorganic"],
        geometry: "Лінійна", bondAngle: "—", bondType: "Ковалентний (радикал)",
        fact: "Непарна кількість електронів: NO — стійкий радикал і сигнальна молекула в організмі.",
        frag: centre(diatomic("N", "O", 1.15, 2)),
    },
    {
        formula: "NO₂", name: "Нітроген діоксид", categories: ["inorganic"],
        geometry: "Кутова", bondAngle: "134°", bondType: "Ковалентний (радикал)",
        fact: "Кут широкий, бо на Нітрогені лише один непарний електрон — він відштовхує слабше за цілу пару.",
        frag: centre(bent3("N", "O", 1.20, 134, 2)),
    },
    {
        formula: "N₂O", name: "Нітроген(I) оксид", categories: ["inorganic"],
        geometry: "Лінійна", bondAngle: "180°", bondType: "Потрійний + одинарний",
        fact: "Лінійна, але асиметрична: N≡N⁺–O⁻. Тому, на відміну від CO₂, «звеселяльний газ» полярний.",
        frag: nitrousOxide(),
    },

    // ── Форми (геометрія) ────────────────────────────────────────
    {
        formula: "CH₄", name: "Метан", categories: ["shapes", "organic"],
        geometry: "Тетраедрична", bondAngle: "109,5°", bondType: "Ковалентний неполярний",
        fact: "Усі чотири зв'язки рівноцінні, тому молекула не має дипольного моменту. Еталон sp³-гібридизації.",
        frag: centre(tetrahedral("C", "H", 1.09, 1)),
    },
    {
        formula: "BF₃", name: "Бор трифторид", categories: ["shapes"],
        geometry: "Тригональна плоска", bondAngle: "120°", bondType: "Ковалентний полярний",
        fact: "У Бору лише 6 електронів — октет не добудований. Порожня орбіталь робить BF₃ сильною кислотою Льюїса.",
        frag: centre(trigonalPlanar("B", "F", 1.31, 1)),
    },
    {
        formula: "BeCl₂", name: "Берилій хлорид", categories: ["shapes"],
        geometry: "Лінійна", bondAngle: "180°", bondType: "Ковалентний полярний",
        fact: "Два зв'язки й жодної неподіленої пари — sp-гібридизація дає рівно 180°.",
        frag: centre(linear3("Be", "Cl", 1.75, 1)),
    },
    {
        formula: "PCl₃", name: "Фосфор трихлорид", categories: ["shapes"],
        geometry: "Тригональна пірамідальна", bondAngle: "100°", bondType: "Ковалентний полярний",
        fact: "Та сама форма, що й у NH₃, але кут ще менший: більший атом Фосфору слабше стискає неподілену пару.",
        frag: centre(pyramidal("P", "Cl", 2.04, 100)),
    },
    {
        formula: "PCl₅", name: "Фосфор пентахлорид", categories: ["shapes"],
        geometry: "Тригональна біпірамідальна", bondAngle: "90° і 120°", bondType: "Ковалентний полярний",
        fact: "Розширений октет: 10 електронів навколо Фосфору. Осьові зв'язки довші за екваторіальні.",
        frag: centre(trigonalBipyramidal("P", "Cl", 2.14, 2.02)),
    },
    {
        formula: "SF₆", name: "Сульфур гексафторид", categories: ["shapes"],
        geometry: "Октаедрична", bondAngle: "90°", bondType: "Ковалентний неполярний",
        fact: "Шість Флуорів повністю екранують Сульфур — газ настільки інертний, що ним гасять електричну дугу.",
        frag: centre(octahedral("S", "F", 1.56)),
    },
    {
        formula: "XeF₄", name: "Ксенон тетрафторид", categories: ["shapes"],
        geometry: "Квадратна плоска", bondAngle: "90°", bondType: "Ковалентний полярний",
        fact: "Дві неподілені пари стоять над і під площиною — тому чотири зв'язки лягають у квадрат, а не в тетраедр.",
        frag: centre(squarePlanar("Xe", "F", 1.95)),
    },

    // ── Органічні ────────────────────────────────────────────────
    {
        formula: "C₂H₆", name: "Етан", categories: ["organic"],
        geometry: "Два тетраедри", bondAngle: "109,5°", bondType: "Одинарний C–C",
        fact: "Навколо одинарного зв'язку групи вільно обертаються — показана найвигідніша, загальмована конформація.",
        frag: ethane(),
    },
    {
        formula: "C₂H₄", name: "Етен (етилен)", categories: ["organic"],
        geometry: "Плоска", bondAngle: "≈120°", bondType: "Подвійний C=C",
        fact: "Подвійний зв'язок забороняє обертання — усі шість атомів лежать в одній площині.",
        frag: ethylene(),
    },
    {
        formula: "C₂H₂", name: "Етин (ацетилен)", categories: ["organic"],
        geometry: "Лінійна", bondAngle: "180°", bondType: "Потрійний C≡C",
        fact: "sp-гібридизація витягує молекулу в пряму лінію. Горіння в кисні дає понад 3000 °C.",
        frag: acetylene(),
    },
    {
        formula: "C₃H₈", name: "Пропан", categories: ["organic"],
        geometry: "Зигзаг", bondAngle: "112°", bondType: "Одинарний C–C",
        fact: "Ланцюг не прямий: тетраедричні кути змушують карбони йти зигзагом.",
        frag: alkane(3),
    },
    {
        formula: "C₄H₁₀", name: "Бутан", categories: ["organic"],
        geometry: "Зигзаг", bondAngle: "112°", bondType: "Одинарний C–C",
        fact: "Той самий зигзаг, довший на одну ланку. Має ізомер — ізобутан з розгалуженим ланцюгом.",
        frag: alkane(4),
    },
    {
        formula: "CH₃OH", name: "Метанол", categories: ["organic"],
        geometry: "Тетраедрична біля C", bondAngle: "≈109°", bondType: "Ковалентний полярний",
        fact: "Гідроксильна група утворює водневі зв'язки — тому метанол рідина, а метан газ.",
        frag: alcohol(1),
    },
    {
        formula: "C₂H₅OH", name: "Етанол", categories: ["organic"],
        geometry: "Тетраедрична біля C", bondAngle: "≈109°", bondType: "Ковалентний полярний",
        fact: "Неполярний хвіст C₂H₅ і полярна –OH: молекула змішується і з водою, і з органічними розчинниками.",
        frag: alcohol(2),
    },
    {
        formula: "CH₃COOH", name: "Оцтова кислота", categories: ["organic", "acids"],
        geometry: "Плоска карбоксильна група", bondAngle: "≈120° біля C=O", bondType: "Подвійний + одинарний",
        fact: "Карбоксильна група плоска. Саме Гідроген групи –OH відщеплюється, а не той, що біля Карбону.",
        frag: aceticAcid(),
    },
    {
        formula: "C₆H₆", name: "Бензен", categories: ["organic"],
        geometry: "Плоский шестикутник", bondAngle: "120°", bondType: "Ароматичний",
        fact: "Намальовано одну структуру Кекуле, але насправді всі шість зв'язків однакові (1,39 Å) — електрони делокалізовані.",
        frag: benzene(),
    },

    // ── Кислоти ──────────────────────────────────────────────────
    {
        formula: "HCl", name: "Хлоридна кислота", categories: ["acids"],
        geometry: "Лінійна", bondAngle: "—", bondType: "Ковалентний полярний",
        fact: "Сильно полярний зв'язок: у воді розривається повністю, даючи H⁺ і Cl⁻.",
        frag: centre(diatomic("H", "Cl", 1.27, 1)),
    },
    {
        formula: "H₂SO₄", name: "Сульфатна кислота", categories: ["acids"],
        geometry: "Тетраедрична біля S", bondAngle: "≈109,5°", bondType: "Подвійний + одинарний",
        fact: "Два зв'язки S=O і дві групи –OH. Відщеплюються саме два Гідрогени гідроксогруп — кислота двохосновна.",
        frag: oxoacid("S", 2, 1.42, 1.57),
    },
    {
        formula: "HNO₃", name: "Нітратна кислота", categories: ["acids"],
        geometry: "Плоска", bondAngle: "≈120°", bondType: "Подвійний + одинарний",
        fact: "Нітроген у ступені окиснення +5, уся група плоска. Кислота одноосновна: рухливий лише Гідроген при Оксигені.",
        frag: nitricAcid(),
    },
    {
        formula: "H₃PO₄", name: "Ортофосфатна кислота", categories: ["acids"],
        geometry: "Тетраедрична біля P", bondAngle: "≈109,5°", bondType: "Подвійний + одинарний",
        fact: "Один P=O і три –OH, тому кислота трьохосновна й дисоціює трьома послідовними ступенями.",
        frag: oxoacid("P", 1, 1.48, 1.57),
    },

    // ── Йони та солі ─────────────────────────────────────────────
    {
        formula: "NaCl", name: "Натрій хлорид", categories: ["ions"],
        geometry: "Кубічні ґратки", bondAngle: "90°", bondType: "Йонний",
        fact: "Молекули NaCl не існує: показано фрагмент ґратки, де кожен йон оточений шістьма протилежними.",
        frag: centre(rockSalt("Na", "Cl", 2.82)),
    },
    {
        formula: "KCl", name: "Калій хлорид", categories: ["ions"],
        geometry: "Кубічні ґратки", bondAngle: "90°", bondType: "Йонний",
        fact: "Та сама структура, що й у NaCl, але ґратка ширша — йон Калію помітно більший за Натрій.",
        frag: centre(rockSalt("K", "Cl", 3.14)),
    },
    {
        formula: "CaCO₃", name: "Кальцій карбонат", categories: ["ions"],
        geometry: "Плоский аніон + катіон", bondAngle: "120° у CO₃²⁻", bondType: "Йонний + ковалентний",
        fact: "Усередині аніона зв'язки ковалентні, а Ca²⁺ утримується електростатично. Крейда, мармур і вапняк.",
        frag: calciumCarbonate(),
    },
    {
        formula: "NH₄⁺", name: "Йон амонію", categories: ["ions"],
        geometry: "Тетраедрична", bondAngle: "109,5°", bondType: "Ковалентний + донорно-акцепторний",
        fact: "Четвертий зв'язок утворено за донорно-акцепторним механізмом, але всі чотири стали нерозрізненними.",
        frag: centre(tetrahedral("N", "H", 1.03, 1)),
    },
    {
        formula: "SO₄²⁻", name: "Сульфат-йон", categories: ["ions"],
        geometry: "Тетраедрична", bondAngle: "109,5°", bondType: "Делокалізований ковалентний",
        fact: "Усі чотири зв'язки S–O однакові (1,49 Å): заряд −2 рівномірно розподілений між Оксигенами.",
        frag: centre(tetrahedral("S", "O", 1.49, 1)),
    },

    // ── Додатково ────────────────────────────────────────────────
    {
        formula: "O₃", name: "Озон", categories: ["extra"],
        geometry: "Кутова", bondAngle: "116,8°", bondType: "Делокалізований",
        fact: "Показано одну структуру Кекуле, та обидва зв'язки однакові — порядок 1,5. Тому озон менш стійкий за O₂.",
        frag: ozone(),
    },
    {
        formula: "H₂O₂", name: "Пероксид водню", categories: ["extra"],
        geometry: "Неплоска", bondAngle: "100° (двогранний 111°)", bondType: "Ковалентний полярний",
        fact: "Класичний приклад неплоскої молекули: два Гідрогени лежать у різних площинах, наче напіврозкрита книжка.",
        frag: hydrogenPeroxide(),
    },
    {
        formula: "CS₂", name: "Сірковуглець", categories: ["extra"],
        geometry: "Лінійна", bondAngle: "180°", bondType: "Подвійний ковалентний",
        fact: "Повний аналог CO₂ за будовою, але зв'язки майже неполярні — Карбон і Сульфур мають близьку електронегативність.",
        frag: centre(linear3("C", "S", 1.55, 2)),
    },
    {
        formula: "SiO₂", name: "Силіцій діоксид", categories: ["extra"],
        geometry: "Тетраедрична", bondAngle: "109,5°", bondType: "Ковалентний полярний",
        fact: "Молекули SiO₂ не існує: показано тетраедр SiO₄, а в кварці такі тетраедри з'єднані спільними вершинами в каркас.",
        frag: centre(tetrahedral("Si", "O", 1.61, 1)),
    },
    {
        formula: "Al₂O₃", name: "Алюміній оксид", categories: ["extra"],
        geometry: "Йонний каркас", bondAngle: "≈120° біля містка", bondType: "Йонний з ковалентним внеском",
        fact: "Показано лише формульну одиницю. Справжній корунд — щільна ґратка; з домішками це рубін і сапфір.",
        frag: aluminaUnit(),
    },
];

/** Molecules belonging to `key`, in catalogue order. */
export function byCategory(key: CategoryKey): MoleculeDef[] {
    return MOLECULES.filter((m) => m.categories.includes(key));
}

/** Distance from the centre to the outermost atom, in ångström. */
export function boundingRadius(frag: Frag): number {
    let max = 0;
    for (const a of frag.atoms) {
        const d = Math.sqrt(a.pos[0] ** 2 + a.pos[1] ** 2 + a.pos[2] ** 2);
        if (d > max) max = d;
    }
    return max;
}
