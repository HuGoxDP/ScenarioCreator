// scripts/data/genetic-code.ts
// ============================================================
// The standard genetic code, all 64 codons written out.
//
// Not derived from wobble rules: a generated table is a table nobody can
// proofread, and this one is the thing a student checks the animation against.
// The order below is the order a textbook prints — grouped by first base, then
// second, then third — so it can be read against a printed copy line by line.
// ============================================================

import { Color } from "WebEngineTS";

/** Chemical class of the side chain — this is what colours the peptide beads. */
export type AcidClass = "hydrophobic" | "polar" | "acidic" | "basic" | "stop";

export interface AminoAcid {
    /** Three-letter code, as printed in the codon table. */
    code: string;
    /** Ukrainian name. */
    name: string;
    cls: AcidClass;
}

export const CLASS_COLOR: Record<AcidClass, Color> = {
    hydrophobic: new Color(0.95, 0.78, 0.35, 1),
    polar:       new Color(0.45, 0.80, 0.95, 1),
    acidic:      new Color(0.90, 0.40, 0.38, 1),
    basic:       new Color(0.55, 0.60, 0.95, 1),
    stop:        new Color(0.55, 0.55, 0.60, 1),
};

export const CLASS_LABEL: Record<AcidClass, string> = {
    hydrophobic: "гідрофобна",
    polar:       "полярна",
    acidic:      "кислотна",
    basic:       "основна",
    stop:        "—",
};

export const AMINO: Record<string, AminoAcid> = {
    Phe:  { code: "Phe",  name: "Фенілаланін",          cls: "hydrophobic" },
    Leu:  { code: "Leu",  name: "Лейцин",               cls: "hydrophobic" },
    Ile:  { code: "Ile",  name: "Ізолейцин",            cls: "hydrophobic" },
    Met:  { code: "Met",  name: "Метіонін",             cls: "hydrophobic" },
    Val:  { code: "Val",  name: "Валін",                cls: "hydrophobic" },
    Pro:  { code: "Pro",  name: "Пролін",               cls: "hydrophobic" },
    Ala:  { code: "Ala",  name: "Аланін",               cls: "hydrophobic" },
    Gly:  { code: "Gly",  name: "Гліцин",               cls: "hydrophobic" },
    Trp:  { code: "Trp",  name: "Триптофан",            cls: "hydrophobic" },
    Ser:  { code: "Ser",  name: "Серин",                cls: "polar" },
    Thr:  { code: "Thr",  name: "Треонін",              cls: "polar" },
    Cys:  { code: "Cys",  name: "Цистеїн",              cls: "polar" },
    Tyr:  { code: "Tyr",  name: "Тирозин",              cls: "polar" },
    Asn:  { code: "Asn",  name: "Аспарагін",            cls: "polar" },
    Gln:  { code: "Gln",  name: "Глутамін",             cls: "polar" },
    Asp:  { code: "Asp",  name: "Аспарагінова кислота", cls: "acidic" },
    Glu:  { code: "Glu",  name: "Глутамінова кислота",  cls: "acidic" },
    Lys:  { code: "Lys",  name: "Лізин",                cls: "basic" },
    Arg:  { code: "Arg",  name: "Аргінін",              cls: "basic" },
    His:  { code: "His",  name: "Гістидин",             cls: "basic" },
    Stop: { code: "Stop", name: "Стоп-кодон",           cls: "stop" },
};

/** RNA codon → three-letter code. Stop codons map to `Stop`. */
export const CODON: Record<string, string> = {
    UUU: "Phe", UUC: "Phe", UUA: "Leu", UUG: "Leu",
    UCU: "Ser", UCC: "Ser", UCA: "Ser", UCG: "Ser",
    UAU: "Tyr", UAC: "Tyr", UAA: "Stop", UAG: "Stop",
    UGU: "Cys", UGC: "Cys", UGA: "Stop", UGG: "Trp",

    CUU: "Leu", CUC: "Leu", CUA: "Leu", CUG: "Leu",
    CCU: "Pro", CCC: "Pro", CCA: "Pro", CCG: "Pro",
    CAU: "His", CAC: "His", CAA: "Gln", CAG: "Gln",
    CGU: "Arg", CGC: "Arg", CGA: "Arg", CGG: "Arg",

    AUU: "Ile", AUC: "Ile", AUA: "Ile", AUG: "Met",
    ACU: "Thr", ACC: "Thr", ACA: "Thr", ACG: "Thr",
    AAU: "Asn", AAC: "Asn", AAA: "Lys", AAG: "Lys",
    AGU: "Ser", AGC: "Ser", AGA: "Arg", AGG: "Arg",

    GUU: "Val", GUC: "Val", GUA: "Val", GUG: "Val",
    GCU: "Ala", GCC: "Ala", GCA: "Ala", GCG: "Ala",
    GAU: "Asp", GAC: "Asp", GAA: "Glu", GAG: "Glu",
    GGU: "Gly", GGC: "Gly", GGA: "Gly", GGG: "Gly",
};

/** Base order of the printed table: columns are the first base, rows the rest. */
export const BASE_ORDER = ["U", "C", "A", "G"] as const;

export function aminoFor(codon: string): AminoAcid {
    return AMINO[CODON[codon] ?? "Stop"] ?? AMINO.Stop;
}

export function isStop(codon: string): boolean {
    return CODON[codon] === "Stop";
}

/**
 * Development guard: the table must hold exactly 64 codons and exactly three
 * stops. Both are things a hand-written table gets wrong silently.
 */
export function validateCode(): string[] {
    const problems: string[] = [];
    const codons = Object.keys(CODON);
    if (codons.length !== 64) problems.push(`codon table has ${codons.length} entries, expected 64`);

    const stops = codons.filter(isStop);
    if (stops.length !== 3) problems.push(`found ${stops.length} stop codons, expected 3`);

    for (const codon of codons) {
        if (!AMINO[CODON[codon]]) problems.push(`${codon} maps to unknown acid ${CODON[codon]}`);
    }
    return problems;
}
