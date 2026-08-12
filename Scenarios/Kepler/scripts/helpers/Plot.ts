// scripts/helpers/Plot.ts
// ============================================================
// Kepler's third law as a scatter plot: T² against a³, log–log.
//
// In AU and years the law is `T² = a³` with no constant, so every planet sits
// exactly on the diagonal — and so does the simulated body, at any
// eccentricity. That is the whole point: the third law depends on the
// semi-major axis and not on how elliptical the orbit is, and this is the only
// place in the scenario where that is visible.
//
// Log–log because the eight planets span five decades in a³; on a linear axis
// Mercury and Neptune cannot share a panel.
//
// Drawn with UI rectangles rather than lines, so nothing here depends on a
// polyline's transform in a Y-down layout.
// ============================================================

import {
    GameObject, RectTransform, UIImage, Vector2, Color,
} from "WebEngineTS";

const AXIS_COLOR = new Color(0.45, 0.52, 0.62, 1);
const DIAGONAL_COLOR = new Color(0.35, 0.42, 0.52, 1);
const PLANET_COLOR = new Color(0.72, 0.80, 0.92, 1);
const BODY_COLOR = new Color(1.0, 0.72, 0.30, 1);

/** Decades covered on both axes. */
const MIN_LOG = -2;
const MAX_LOG = 5;

export interface PlotOptions {
    /** Inset from the left and the top of the screen, canvas units. */
    x: number;
    y: number;
    size: number;
}

export class Plot {
    private readonly _body: RectTransform;

    constructor(canvas: GameObject, private readonly _options: PlotOptions, planets: { a: number; period: number }[]) {
        const { x, y, size } = _options;

        // Axes.
        this._rect(canvas, x, y + size, size, 2, AXIS_COLOR);
        this._rect(canvas, x, y, 2, size, AXIS_COLOR);

        // The T² = a³ diagonal, as a dotted trail of small squares.
        for (let i = 0; i <= 40; i++) {
            const t = i / 40;
            this._rect(canvas, x + t * size - 1, y + size - t * size - 1, 3, 3, DIAGONAL_COLOR);
        }

        for (const planet of planets) {
            const px = this._map(Math.log10(planet.a ** 3));
            const py = this._map(Math.log10(planet.period ** 2));
            this._rect(canvas, x + px * size - 3, y + size - py * size - 3, 6, 6, PLANET_COLOR);
        }

        this._body = this._rect(canvas, x, y, 9, 9, BODY_COLOR);
    }

    /** Moves the simulated body's marker; a non-elliptical orbit hides it. */
    update(semiMajor: number, period: number): void {
        const visible = Number.isFinite(semiMajor) && Number.isFinite(period) && semiMajor > 0;
        this._body.gameObject.setActive(visible);
        if (!visible) return;

        const { x, y, size } = this._options;
        const px = this._map(Math.log10(semiMajor ** 3));
        const py = this._map(Math.log10(period ** 2));
        this._body.anchoredPosition = new Vector2(
            x + px * size - 4.5,
            -(y + size - py * size - 4.5),
        );
    }

    /** log₁₀ value → 0…1 across the panel, clamped to the drawn range. */
    private _map(value: number): number {
        return Math.min(1, Math.max(0, (value - MIN_LOG) / (MAX_LOG - MIN_LOG)));
    }

    private _rect(canvas: GameObject, x: number, y: number, width: number, height: number, color: Color): RectTransform {
        const go = new GameObject("Plot part");
        go.transform.parent = canvas.transform;

        const rt = go.addComponent(RectTransform);
        rt.anchorMin = new Vector2(0, 0);
        rt.anchorMax = new Vector2(0, 0);
        rt.pivot = new Vector2(0, 0);
        rt.anchoredPosition = new Vector2(x, y);
        rt.sizeDelta = new Vector2(width, height);

        go.addComponent(UIImage).color = color;
        return rt;
    }
}
