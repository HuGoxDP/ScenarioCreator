// scripts/helpers/TableLayout.ts
// ============================================================
// Where each element's button goes in the periodic table.
//
// Positions come from `group` and `period`, not from a layout group. The
// table's shape IS its holes: hydrogen sits at group 1 and helium at group 18
// with fourteen empty columns between them, and any layout that packs cells
// left to right destroys exactly the information the table exists to carry.
// ============================================================

/** Button size and the gap around it, in canvas units. */
export const CELL_W = 30;
export const CELL_H = 24;
const GAP = 2;

export const COL_PITCH = CELL_W + GAP;
export const ROW_PITCH = CELL_H + GAP;

/** Groups 1…18, so the table is 18 columns wide. */
const COLUMNS = 18;

/** Full width of the table — the caller needs it to size the panel behind. */
export const TABLE_WIDTH = COLUMNS * COL_PITCH;

/** Rows drawn by this scenario: periods 1…4, H through Kr. */
export const TABLE_HEIGHT = 4 * ROW_PITCH;

/**
 * Offset of one cell from the table's top-centre, in canvas units.
 *
 * Pair with a `top-center` anchor: x is signed (negative is left of centre),
 * y is measured downwards, which is the direction the UIKit anchors already
 * treat as inward from the top.
 */
export function cellOffset(group: number, period: number): { x: number; y: number } {
    return {
        x: (group - (COLUMNS + 1) / 2) * COL_PITCH,
        y: (period - 1) * ROW_PITCH,
    };
}
