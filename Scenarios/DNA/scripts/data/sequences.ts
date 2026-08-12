// scripts/data/sequences.ts
// ============================================================
// Three short teaching sequences, plus the strand arithmetic.
//
// Each is stored as the CODING strand, 5'→3', because that is the one printed
// in a textbook and the one whose letters match the mRNA. The template strand
// is derived from it, and the mRNA from the template — which is the order the
// cell works in and the order the readout has to be able to defend.
//
// The sequences are deliberately intron-free and short. Say that on screen
// rather than leaving it implicit: a biology teacher will notice a gene with no
// introns and should be told it is a simplification, not an error.
// ============================================================

import { Color } from "WebEngineTS";
import { CODON, isStop } from "./genetic-code";

export interface Sequence {
    title: string;
    /** One sentence of context, Ukrainian. */
    note: string;
    /** Coding strand, 5'→3'. Starts with ATG, ends with a stop codon. */
    coding: string;
}

export const SEQUENCES: Sequence[] = [
    {
        title: "Мет-енкефалін",
        note: "Найкоротша з трьох: сім кодонів. Кодує справжній пептид — Тир-Глі-Глі-Фен-Мет, який мозок виробляє як власне знеболювальне.",
        coding: "ATGTATGGTGGTTTTATGTAA",
    },
    {
        title: "Навчальний пептид",
        note: "Дванадцять кодонів, підібраних так, щоб трапилися всі чотири класи амінокислот — гідрофобні, полярні, кислотні та основні.",
        coding: "ATGGCATCCGATTTGCGTAACGAGTGGCCAGTATAA",
    },
    {
        title: "Ділянка, багата на G–C",
        note: "Майже самі пари Г–Ц, а їх утримують три водневі зв'язки замість двох. Саме тому такі ділянки ДНК важче розплести — і потрібна вища температура.",
        coding: "ATGGGCCGCGCCGGACAGCTGGCCTGCTGA",
    },
];

// ==================== BASES ====================

export const BASE_NAME: Record<string, string> = {
    A: "аденін", T: "тимін", G: "гуанін", C: "цитозин", U: "урацил",
};

/** Standard teaching colours: A green, T red, G orange, C blue. */
export const BASE_COLOR: Record<string, Color> = {
    A: new Color(0.35, 0.78, 0.42, 1),
    T: new Color(0.88, 0.32, 0.30, 1),
    G: new Color(0.95, 0.66, 0.26, 1),
    C: new Color(0.34, 0.62, 0.95, 1),
    // Uracil is a lighter red than thymine on purpose: the T→U substitution is
    // the single most-missed step, and it has to be visible at a glance.
    U: new Color(0.98, 0.55, 0.58, 1),
};

const COMPLEMENT: Record<string, string> = { A: "T", T: "A", G: "C", C: "G" };

/** Two hydrogen bonds hold A–T, three hold G–C. */
export function bondCount(base: string): number {
    return base === "G" || base === "C" ? 3 : 2;
}

// ==================== STRANDS ====================

/** The template strand: the complement of the coding strand, base for base. */
export function templateFor(coding: string): string {
    let out = "";
    for (const base of coding) out += COMPLEMENT[base] ?? base;
    return out;
}

/**
 * The mRNA transcribed from that template.
 *
 * Read off the template by complement, which is what the polymerase does — and
 * the result is the coding strand with U in place of T. Both facts are shown on
 * screen; this function produces the first so the second can be *observed*
 * rather than asserted.
 */
export function rnaFromTemplate(template: string): string {
    let out = "";
    for (const base of template) {
        const pair = COMPLEMENT[base] ?? base;
        out += pair === "T" ? "U" : pair;
    }
    return out;
}

export function codonsOf(rna: string): string[] {
    const out: string[] = [];
    for (let i = 0; i + 3 <= rna.length; i += 3) out.push(rna.slice(i, i + 3));
    return out;
}

/** Groups a strand into space-separated triplets for the sequence strip. */
export function inTriplets(strand: string): string {
    return (strand.match(/.{1,3}/g) ?? []).join(" ");
}

/**
 * Development guard. Each sequence must be a whole number of codons, start with
 * ATG, end with a stop, and contain no stop before the end — a premature stop
 * would silently truncate the animation and look like a bug in the machine
 * rather than a typo in the data.
 */
export function validateSequences(): string[] {
    const problems: string[] = [];

    for (const seq of SEQUENCES) {
        const rna = rnaFromTemplate(templateFor(seq.coding));
        const codons = codonsOf(rna);

        if (seq.coding.length % 3 !== 0) problems.push(`${seq.title}: length ${seq.coding.length} is not a whole number of codons`);
        if (codons[0] !== "AUG") problems.push(`${seq.title}: starts with ${codons[0]}, not AUG`);
        if (!isStop(codons[codons.length - 1])) problems.push(`${seq.title}: does not end in a stop codon`);

        for (let i = 0; i < codons.length - 1; i++) {
            if (isStop(codons[i])) problems.push(`${seq.title}: premature stop ${codons[i]} at codon ${i + 1}`);
        }
        for (const codon of codons) {
            if (!CODON[codon]) problems.push(`${seq.title}: ${codon} is not in the codon table`);
        }
    }
    return problems;
}
