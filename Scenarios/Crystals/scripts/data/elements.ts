// scripts/data/elements.ts
// ============================================================
// The eight elements the structures need.
//
// CPK-ish colouring, the convention chemistry textbooks print, so a student
// reading a paper model recognises the same colours here.
//
// TWO radii per element, and the difference is the point of the space-filling
// toggle:
//
//   `stick`  — a display radius for the ball-and-stick style. Not physical:
//              real radii would swallow the sticks entirely.
//   `real`   — the ionic radius for the ionic crystals, the metallic radius for
//              the metals, the covalent radius for diamond and graphite, and
//              the van der Waals radius for argon. These are the numbers that
//              make ions touch when drawn full size.
// ============================================================

import { Color } from "WebEngineTS";

export interface ElementInfo {
    name: string;
    color: Color;
    stick: number;
    real: number;
}

export const ELEMENT: Record<string, ElementInfo> = {
    Na: { name: "Натрій (Na⁺)",  color: new Color(0.67, 0.36, 0.95, 1), stick: 0.55, real: 1.02 },
    Cl: { name: "Хлор (Cl⁻)",    color: new Color(0.24, 0.85, 0.24, 1), stick: 0.62, real: 1.81 },
    Cs: { name: "Цезій (Cs⁺)",   color: new Color(0.34, 0.09, 0.56, 1), stick: 0.75, real: 1.67 },
    C:  { name: "Карбон",        color: new Color(0.25, 0.25, 0.28, 1), stick: 0.42, real: 0.77 },
    Cu: { name: "Мідь",          color: new Color(0.78, 0.50, 0.20, 1), stick: 0.60, real: 1.28 },
    Fe: { name: "Ферум",         color: new Color(0.88, 0.40, 0.20, 1), stick: 0.58, real: 1.26 },
    Mg: { name: "Магній",        color: new Color(0.54, 1.00, 0.00, 1), stick: 0.62, real: 1.60 },
    Ar: { name: "Аргон",         color: new Color(0.50, 0.82, 0.89, 1), stick: 0.62, real: 1.88 },
};

export function elementInfo(symbol: string): ElementInfo {
    return ELEMENT[symbol] ?? { name: symbol, color: new Color(0.8, 0.8, 0.8, 1), stick: 0.5, real: 1 };
}
