// scripts/data/elements.ts
// ============================================================
// Elements 1…36, H through Kr.
//
// The catalogue stops at krypton on purpose: that covers every shell diagram a
// school course draws, and past it the filling exceptions multiply into a table
// nobody here can proofread.
//
// `shells` and `config` are LITERAL DATA, never generated from the aufbau rule.
// Chromium is [Ar] 3d⁵ 4s¹ and copper is [Ar] 3d¹⁰ 4s¹ — a generated table is
// wrong at exactly the two elements a teacher points at.
//
// `neutrons` is the count in the most abundant isotope, also literal. The
// tempting shortcut `round(mass) − z` gives the right answer for most elements
// and the wrong one for Ni, Cu, Zn, Ge, Se and Br, where the abundance-weighted
// mass rounds past the dominant isotope.
// ============================================================

import { Color } from "WebEngineTS";

export type CategoryKey =
    | "alkali" | "alkaline" | "transition" | "postTransition"
    | "metalloid" | "nonmetal" | "halogen" | "noble";

/** Table colouring, and the word shown in the info panel. */
export const CATEGORY: Record<CategoryKey, { label: string; color: Color }> = {
    alkali:         { label: "Лужний метал",         color: new Color(0.85, 0.35, 0.30, 1) },
    alkaline:       { label: "Лужноземельний метал", color: new Color(0.90, 0.58, 0.28, 1) },
    transition:     { label: "Перехідний метал",     color: new Color(0.86, 0.76, 0.35, 1) },
    postTransition: { label: "Постперехідний метал", color: new Color(0.42, 0.62, 0.45, 1) },
    metalloid:      { label: "Металоїд",             color: new Color(0.35, 0.66, 0.62, 1) },
    nonmetal:       { label: "Неметал",              color: new Color(0.33, 0.55, 0.85, 1) },
    halogen:        { label: "Галоген",              color: new Color(0.55, 0.45, 0.85, 1) },
    noble:          { label: "Інертний газ",         color: new Color(0.75, 0.40, 0.68, 1) },
};

export interface ElementInfo {
    /** Proton count. Also the index into {@link ELEMENTS}, plus one. */
    z: number;
    symbol: string;
    /** Ukrainian (IUPAC-Ukrainian) name. */
    name: string;
    /** Standard atomic weight — measured, not 2×z. */
    mass: number;
    /** Neutrons in the most abundant isotope. */
    neutrons: number;
    /** K, L, M, N occupancy. Must sum to z. */
    shells: number[];
    config: string;
    group: number;
    period: number;
    block: "s" | "p" | "d";
    category: CategoryKey;
    /** One sentence, shown in the info panel. */
    fact: string;
}

// Full configurations up to calcium, [Ar] shorthand past it — which is both
// what the panel has room for and what a textbook prints for the d-block.
export const ELEMENTS: ElementInfo[] = [
    { z: 1, symbol: "H", name: "Гідроген", mass: 1.008, neutrons: 0, shells: [1],
      config: "1s¹", group: 1, period: 1, block: "s", category: "nonmetal",
      fact: "Найпоширеніший елемент у Всесвіті. У ядрі звичайного Гідрогену немає жодного нейтрона — це єдиний такий випадок." },
    { z: 2, symbol: "He", name: "Гелій", mass: 4.0026, neutrons: 2, shells: [2],
      config: "1s²", group: 18, period: 1, block: "s", category: "noble",
      fact: "Другий за поширеністю у Всесвіті, але на Землі рідкісний: він настільки легкий, що назавжди залишає атмосферу." },
    { z: 3, symbol: "Li", name: "Літій", mass: 6.94, neutrons: 4, shells: [2, 1],
      config: "1s² 2s¹", group: 1, period: 2, block: "s", category: "alkali",
      fact: "Найлегший метал — плаває навіть у гасі. Основа акумуляторів смартфонів та електромобілів." },
    { z: 4, symbol: "Be", name: "Берилій", mass: 9.0122, neutrons: 5, shells: [2, 2],
      config: "1s² 2s²", group: 2, period: 2, block: "s", category: "alkaline",
      fact: "Майже прозорий для рентгенівських променів, тому з нього роблять вікна рентгенівських трубок." },
    { z: 5, symbol: "B", name: "Бор", mass: 10.81, neutrons: 6, shells: [2, 3],
      config: "1s² 2s² 2p¹", group: 13, period: 2, block: "p", category: "metalloid",
      fact: "Боровмісне скло витримує різкі перепади температури — саме з нього роблять лабораторний посуд." },
    { z: 6, symbol: "C", name: "Карбон", mass: 12.011, neutrons: 6, shells: [2, 4],
      config: "1s² 2s² 2p²", group: 14, period: 2, block: "p", category: "nonmetal",
      fact: "Утворює більше сполук, ніж усі інші елементи разом: на ньому побудована вся органічна хімія." },
    { z: 7, symbol: "N", name: "Нітроген", mass: 14.007, neutrons: 7, shells: [2, 5],
      config: "1s² 2s² 2p³", group: 15, period: 2, block: "p", category: "nonmetal",
      fact: "78 % повітря. Потрійний зв'язок у молекулі N₂ настільки міцний, що газ поводиться майже як інертний." },
    { z: 8, symbol: "O", name: "Оксиген", mass: 15.999, neutrons: 8, shells: [2, 6],
      config: "1s² 2s² 2p⁴", group: 16, period: 2, block: "p", category: "nonmetal",
      fact: "Основа дихання і найпоширеніший елемент земної кори. У формі O₃ захищає планету від ультрафіолету." },
    { z: 9, symbol: "F", name: "Флуор", mass: 18.998, neutrons: 10, shells: [2, 7],
      config: "1s² 2s² 2p⁵", group: 17, period: 2, block: "p", category: "halogen",
      fact: "Найелектронегативніший елемент: відбирає електрони навіть у благородних газів." },
    { z: 10, symbol: "Ne", name: "Неон", mass: 20.180, neutrons: 10, shells: [2, 8],
      config: "1s² 2s² 2p⁶", group: 18, period: 2, block: "p", category: "noble",
      fact: "Червоно-помаранчеве світло рекламних трубок — це саме неон. Завершена восьмиелектронна оболонка робить його інертним." },
    { z: 11, symbol: "Na", name: "Натрій", mass: 22.990, neutrons: 12, shells: [2, 8, 1],
      config: "1s² 2s² 2p⁶ 3s¹", group: 1, period: 3, block: "s", category: "alkali",
      fact: "Настільки активний, що зберігається під шаром гасу. Віддавши один електрон, стає йоном звичайної солі." },
    { z: 12, symbol: "Mg", name: "Магній", mass: 24.305, neutrons: 12, shells: [2, 8, 2],
      config: "1s² 2s² 2p⁶ 3s²", group: 2, period: 3, block: "s", category: "alkaline",
      fact: "Горить сліпучо-білим полум'ям. Атом магнію стоїть у центрі молекули хлорофілу." },
    { z: 13, symbol: "Al", name: "Алюміній", mass: 26.982, neutrons: 14, shells: [2, 8, 3],
      config: "1s² 2s² 2p⁶ 3s² 3p¹", group: 13, period: 3, block: "p", category: "postTransition",
      fact: "Найпоширеніший метал земної кори. У XIX столітті коштував дорожче за золото, бо його важко було виділити." },
    { z: 14, symbol: "Si", name: "Силіцій", mass: 28.085, neutrons: 14, shells: [2, 8, 4],
      config: "1s² 2s² 2p⁶ 3s² 3p²", group: 14, period: 3, block: "p", category: "metalloid",
      fact: "Основа всієї електроніки й більшої частини земної кори — від піску до гірського кришталю." },
    { z: 15, symbol: "P", name: "Фосфор", mass: 30.974, neutrons: 16, shells: [2, 8, 5],
      config: "1s² 2s² 2p⁶ 3s² 3p³", group: 15, period: 3, block: "p", category: "nonmetal",
      fact: "Білий фосфор світиться у темряві й самозаймається на повітрі. Входить до складу ДНК і кісток." },
    { z: 16, symbol: "S", name: "Сульфур", mass: 32.06, neutrons: 16, shells: [2, 8, 6],
      config: "1s² 2s² 2p⁶ 3s² 3p⁴", group: 16, period: 3, block: "p", category: "nonmetal",
      fact: "Відомий з давнини як «горюча сірка». Входить до складу двох амінокислот і тримає форму білків." },
    { z: 17, symbol: "Cl", name: "Хлор", mass: 35.45, neutrons: 18, shells: [2, 8, 7],
      config: "1s² 2s² 2p⁶ 3s² 3p⁵", group: 17, period: 3, block: "p", category: "halogen",
      fact: "Жовто-зелений отруйний газ, який у сполуці з натрієм стає їстівним. Йому бракує одного електрона до восьмірки." },
    { z: 18, symbol: "Ar", name: "Аргон", mass: 39.948, neutrons: 22, shells: [2, 8, 8],
      config: "1s² 2s² 2p⁶ 3s² 3p⁶", group: 18, period: 3, block: "p", category: "noble",
      fact: "Майже 1 % повітря. Ним заповнюють лампи розжарювання, щоб не згоряла вольфрамова нитка." },
    { z: 19, symbol: "K", name: "Калій", mass: 39.098, neutrons: 20, shells: [2, 8, 8, 1],
      config: "1s² 2s² 2p⁶ 3s² 3p⁶ 4s¹", group: 1, period: 4, block: "s", category: "alkali",
      fact: "Разом з натрієм створює електричний імпульс у нервах. Зверніть увагу: 4s заповнюється раніше за 3d." },
    { z: 20, symbol: "Ca", name: "Кальцій", mass: 40.078, neutrons: 20, shells: [2, 8, 8, 2],
      config: "1s² 2s² 2p⁶ 3s² 3p⁶ 4s²", group: 2, period: 4, block: "s", category: "alkaline",
      fact: "Основа кісток, черепашок і мармуру. У земній корі — п'ятий за поширеністю елемент." },
    { z: 21, symbol: "Sc", name: "Скандій", mass: 44.956, neutrons: 24, shells: [2, 8, 9, 2],
      config: "[Ar] 3d¹ 4s²", group: 3, period: 4, block: "d", category: "transition",
      fact: "Перший d-елемент. Настільки розсіяний у природі, що концентрованих руд практично не існує." },
    { z: 22, symbol: "Ti", name: "Титан", mass: 47.867, neutrons: 26, shells: [2, 8, 10, 2],
      config: "[Ar] 3d² 4s²", group: 4, period: 4, block: "d", category: "transition",
      fact: "Міцний, як сталь, але майже вдвічі легший, і не боїться морської води." },
    { z: 23, symbol: "V", name: "Ванадій", mass: 50.942, neutrons: 28, shells: [2, 8, 11, 2],
      config: "[Ar] 3d³ 4s²", group: 5, period: 4, block: "d", category: "transition",
      fact: "Додають до сталі, щоб вона витримувала удари: з ванадієвої сталі роблять інструмент." },
    { z: 24, symbol: "Cr", name: "Хром", mass: 51.996, neutrons: 28, shells: [2, 8, 13, 1],
      config: "[Ar] 3d⁵ 4s¹", group: 6, period: 4, block: "d", category: "transition",
      fact: "ВИНЯТОК із правила заповнення: 3d⁵ 4s¹, а не 3d⁴ 4s². Наполовину заповнена d-оболонка вигідніша за пару в 4s." },
    { z: 25, symbol: "Mn", name: "Манган", mass: 54.938, neutrons: 30, shells: [2, 8, 13, 2],
      config: "[Ar] 3d⁵ 4s²", group: 7, period: 4, block: "d", category: "transition",
      fact: "Без нього сталь була б крихкою. У природі — руда піролюзит, відома ще з кам'яного віку як чорна фарба." },
    { z: 26, symbol: "Fe", name: "Ферум", mass: 55.845, neutrons: 30, shells: [2, 8, 14, 2],
      config: "[Ar] 3d⁶ 4s²", group: 8, period: 4, block: "d", category: "transition",
      fact: "Ядро Землі здебільшого залізне. У гемоглобіні саме атом заліза захоплює й переносить кисень." },
    { z: 27, symbol: "Co", name: "Кобальт", mass: 58.933, neutrons: 32, shells: [2, 8, 15, 2],
      config: "[Ar] 3d⁷ 4s²", group: 9, period: 4, block: "d", category: "transition",
      fact: "Дає склу та кераміці глибокий синій колір — той самий «кобальтовий»." },
    { z: 28, symbol: "Ni", name: "Нікель", mass: 58.693, neutrons: 30, shells: [2, 8, 16, 2],
      config: "[Ar] 3d⁸ 4s²", group: 10, period: 4, block: "d", category: "transition",
      fact: "Монети, акумулятори та жароміцні сплави турбін. Разом із залізом складає ядро планети." },
    { z: 29, symbol: "Cu", name: "Купрум", mass: 63.546, neutrons: 34, shells: [2, 8, 18, 1],
      config: "[Ar] 3d¹⁰ 4s¹", group: 11, period: 4, block: "d", category: "transition",
      fact: "ВИНЯТОК із правила заповнення: 3d¹⁰ 4s¹. Перший метал, який людина навчилася обробляти." },
    { z: 30, symbol: "Zn", name: "Цинк", mass: 65.38, neutrons: 34, shells: [2, 8, 18, 2],
      config: "[Ar] 3d¹⁰ 4s²", group: 12, period: 4, block: "d", category: "transition",
      fact: "Захищає сталь від іржі. Необхідний для роботи сотень ферментів людського організму." },
    { z: 31, symbol: "Ga", name: "Галій", mass: 69.723, neutrons: 38, shells: [2, 8, 18, 3],
      config: "[Ar] 3d¹⁰ 4s² 4p¹", group: 13, period: 4, block: "p", category: "postTransition",
      fact: "Плавиться просто в долоні — температура плавлення лише 29.8 °C." },
    { z: 32, symbol: "Ge", name: "Германій", mass: 72.630, neutrons: 42, shells: [2, 8, 18, 4],
      config: "[Ar] 3d¹⁰ 4s² 4p²", group: 14, period: 4, block: "p", category: "metalloid",
      fact: "Саме з германію зробили перший транзистор — кремній прийшов пізніше." },
    { z: 33, symbol: "As", name: "Арсен", mass: 74.922, neutrons: 42, shells: [2, 8, 18, 5],
      config: "[Ar] 3d¹⁰ 4s² 4p³", group: 15, period: 4, block: "p", category: "metalloid",
      fact: "Класична отрута детективних романів і водночас важлива домішка у напівпровідниках." },
    { z: 34, symbol: "Se", name: "Селен", mass: 78.971, neutrons: 46, shells: [2, 8, 18, 6],
      config: "[Ar] 3d¹⁰ 4s² 4p⁴", group: 16, period: 4, block: "p", category: "nonmetal",
      fact: "Потрібен організму в мікродозах, у більших — отруйний. Змінює опір на світлі, тому працював у фотоелементах." },
    { z: 35, symbol: "Br", name: "Бром", mass: 79.904, neutrons: 44, shells: [2, 8, 18, 7],
      config: "[Ar] 3d¹⁰ 4s² 4p⁵", group: 17, period: 4, block: "p", category: "halogen",
      fact: "Єдиний неметал, рідкий за кімнатної температури. Назва означає «сморід»." },
    { z: 36, symbol: "Kr", name: "Криптон", mass: 83.798, neutrons: 48, shells: [2, 8, 18, 8],
      config: "[Ar] 3d¹⁰ 4s² 4p⁶", group: 18, period: 4, block: "p", category: "noble",
      fact: "Інертний, але не абсолютно: з фтором усе-таки утворює сполуки. Довгий час його лінією визначали метр." },
];

/** Lookup by atomic number. `ELEMENTS` is dense and ordered, so this is an index. */
export function byZ(z: number): ElementInfo {
    return ELEMENTS[z - 1];
}

/**
 * Development guard: every record's shells must sum to its proton count.
 *
 * A typo here is invisible on screen — the diagram still draws — and wrong in
 * the readout, which is the worst combination. Called once from `awake`.
 */
export function validateShells(): string[] {
    const problems: string[] = [];
    for (const e of ELEMENTS) {
        const sum = e.shells.reduce((a, b) => a + b, 0);
        if (sum !== e.z) problems.push(`${e.symbol}: shells sum to ${sum}, z is ${e.z}`);
    }
    return problems;
}
