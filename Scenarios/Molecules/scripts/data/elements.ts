// scripts/data/elements.ts
// ============================================================
// CPK colouring — the convention used in chemistry textbooks, so a student
// reading a printed model recognises the same colours here.
//
// `radius` is a *display* radius for the ball-and-stick style, not a physical
// one: real van der Waals radii would swallow the sticks entirely. Values are
// ordered like covalent radii so relative atom sizes still read correctly.
// ============================================================

import { Color } from "WebEngineTS";

export interface ElementInfo {
    /** Ukrainian name shown when an atom is clicked. */
    name: string;
    color: Color;
    radius: number;
}

export const ELEMENT = {
    H:  { name: "Гідроген",  color: new Color(0.96, 0.96, 0.96, 1), radius: 0.26 },
    B:  { name: "Бор",       color: new Color(1.00, 0.71, 0.71, 1), radius: 0.42 },
    C:  { name: "Карбон",    color: new Color(0.25, 0.25, 0.28, 1), radius: 0.40 },
    N:  { name: "Нітроген",  color: new Color(0.20, 0.35, 0.85, 1), radius: 0.38 },
    O:  { name: "Оксиген",   color: new Color(0.85, 0.20, 0.15, 1), radius: 0.36 },
    F:  { name: "Флуор",     color: new Color(0.56, 0.88, 0.31, 1), radius: 0.32 },
    Na: { name: "Натрій",    color: new Color(0.67, 0.36, 0.95, 1), radius: 0.62 },
    Al: { name: "Алюміній",  color: new Color(0.75, 0.65, 0.65, 1), radius: 0.54 },
    Si: { name: "Силіцій",   color: new Color(0.94, 0.78, 0.63, 1), radius: 0.55 },
    P:  { name: "Фосфор",    color: new Color(1.00, 0.50, 0.00, 1), radius: 0.53 },
    S:  { name: "Сульфур",   color: new Color(1.00, 0.85, 0.20, 1), radius: 0.52 },
    Cl: { name: "Хлор",      color: new Color(0.24, 0.85, 0.24, 1), radius: 0.50 },
    K:  { name: "Калій",     color: new Color(0.56, 0.25, 0.83, 1), radius: 0.72 },
    Ca: { name: "Кальцій",   color: new Color(0.24, 0.80, 0.20, 1), radius: 0.68 },
    Be: { name: "Берилій",   color: new Color(0.76, 1.00, 0.00, 1), radius: 0.38 },
    Br: { name: "Бром",      color: new Color(0.65, 0.16, 0.16, 1), radius: 0.58 },
    Xe: { name: "Ксенон",    color: new Color(0.26, 0.62, 0.69, 1), radius: 0.62 },
} as const satisfies Record<string, ElementInfo>;

export type ElementKey = keyof typeof ELEMENT;
