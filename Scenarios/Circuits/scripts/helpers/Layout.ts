// scripts/helpers/Layout.ts
// ============================================================
// Where the four circuits sit on the page.
//
// Right angles only, on a grid, the way a textbook draws a schematic. Each
// wire knows which current flows through it, so the charge carriers get their
// speed and spacing from the solver rather than from an animation constant.
//
// Geometry only — no engine types, so the layouts can be reasoned about (and
// their path lengths checked) without a renderer.
// ============================================================

import type { TemplateKey } from "./Circuit";

export type Point = [number, number];

/** Which current drives the carriers on this wire. */
export type CurrentSource = "main" | "R1" | "R2" | "R3";

export interface Wire {
    points: Point[];
    source: CurrentSource;
}

export type GlyphKind = "battery" | "switch" | "lamp" | "resistor";

export interface Glyph {
    kind: GlyphKind;
    at: Point;
    /** Long axis along X; false means the component stands upright. */
    horizontal: boolean;
    /** `R1`…`R3` for resistors, so the readout can colour-match them. */
    id?: string;
}

export interface Layout {
    wires: Wire[];
    glyphs: Glyph[];
}

const LEFT = -9;
const RIGHT = 9;
const TOP = 4.5;
const BOTTOM = -4.5;

/** The outer loop every circuit shares: battery on the left, switch on top. */
function frame(rightSide: number): Wire[] {
    return [
        { points: [[LEFT, 0], [LEFT, TOP], [-2, TOP]], source: "main" },
        { points: [[rightSide, BOTTOM], [LEFT, BOTTOM], [LEFT, 0]], source: "main" },
    ];
}

export function layoutFor(key: TemplateKey): Layout {
    if (key === "single") {
        return {
            wires: [
                ...frame(RIGHT),
                { points: [[-2, TOP], [RIGHT, TOP], [RIGHT, BOTTOM]], source: "main" },
            ],
            glyphs: [
                { kind: "battery", at: [LEFT, 0], horizontal: false },
                { kind: "switch", at: [-5.5, TOP], horizontal: true },
                { kind: "lamp", at: [3, TOP], horizontal: true },
            ],
        };
    }

    if (key === "series") {
        return {
            wires: [
                ...frame(RIGHT),
                { points: [[-2, TOP], [RIGHT, TOP], [RIGHT, BOTTOM]], source: "main" },
            ],
            glyphs: [
                { kind: "battery", at: [LEFT, 0], horizontal: false },
                { kind: "switch", at: [-5.5, TOP], horizontal: true },
                { kind: "resistor", at: [0, TOP], horizontal: true, id: "R1" },
                { kind: "resistor", at: [3.5, TOP], horizontal: true, id: "R2" },
                { kind: "resistor", at: [7, TOP], horizontal: true, id: "R3" },
            ],
        };
    }

    if (key === "parallel") {
        // Three rungs between a left node and a right node. Each rung is its
        // own wire, so each carries its own current.
        const nodeL = 0;
        const nodeR = 6;
        const rungs: number[] = [2.6, 0, -2.6];
        return {
            wires: [
                ...frame(nodeR),
                { points: [[-2, TOP], [nodeL, TOP], [nodeL, 0]], source: "main" },
                { points: [[nodeR, 0], [nodeR, BOTTOM]], source: "main" },
                ...rungs.map((y, i) => ({
                    points: [[nodeL, 0], [nodeL, y], [nodeR, y], [nodeR, 0]] as Point[],
                    source: `R${i + 1}` as CurrentSource,
                })),
            ],
            glyphs: [
                { kind: "battery", at: [LEFT, 0], horizontal: false },
                { kind: "switch", at: [-5.5, TOP], horizontal: true },
                { kind: "resistor", at: [3, rungs[0]], horizontal: true, id: "R1" },
                { kind: "resistor", at: [3, rungs[1]], horizontal: true, id: "R2" },
                { kind: "resistor", at: [3, rungs[2]], horizontal: true, id: "R3" },
            ],
        };
    }

    // Mixed: R₁ in series on the top wire, then a two-rung parallel pair.
    const nodeL = 1.5;
    const nodeR = 7;
    const rungs: number[] = [2.2, -2.2];
    return {
        wires: [
            ...frame(nodeR),
            { points: [[-2, TOP], [nodeL, TOP], [nodeL, 0]], source: "main" },
            { points: [[nodeR, 0], [nodeR, BOTTOM]], source: "main" },
            ...rungs.map((y, i) => ({
                points: [[nodeL, 0], [nodeL, y], [nodeR, y], [nodeR, 0]] as Point[],
                source: `R${i + 2}` as CurrentSource,
            })),
        ],
        glyphs: [
            { kind: "battery", at: [LEFT, 0], horizontal: false },
            { kind: "switch", at: [-5.5, TOP], horizontal: true },
            { kind: "resistor", at: [-0.5, TOP], horizontal: true, id: "R1" },
            { kind: "resistor", at: [4.25, rungs[0]], horizontal: true, id: "R2" },
            { kind: "resistor", at: [4.25, rungs[1]], horizontal: true, id: "R3" },
        ],
    };
}

// ==================== PATHS ====================

export function pathLength(points: Point[]): number {
    let total = 0;
    for (let i = 1; i < points.length; i++) {
        total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    }
    return total;
}

/**
 * A point `t` of the way along a polyline, `t` wrapping into [0, 1).
 *
 * Wrapping rather than clamping is what lets a carrier loop forever without
 * anyone resetting it.
 */
export function pointAlong(points: Point[], t: number): Point {
    const total = pathLength(points);
    if (total <= 0) return points[0] ?? [0, 0];

    let target = ((t % 1) + 1) % 1 * total;
    for (let i = 1; i < points.length; i++) {
        const dx = points[i][0] - points[i - 1][0];
        const dy = points[i][1] - points[i - 1][1];
        const segment = Math.hypot(dx, dy);
        if (target <= segment) {
            const k = segment === 0 ? 0 : target / segment;
            return [points[i - 1][0] + dx * k, points[i - 1][1] + dy * k];
        }
        target -= segment;
    }
    return points[points.length - 1];
}
