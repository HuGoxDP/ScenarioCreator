// scripts/helpers/Histogram.ts
// ============================================================
// Speed distribution as UI bars, with the Maxwell–Boltzmann prediction drawn
// over it as a step line — one marker per bin, at the height that bin *should*
// have.
//
// A step line rather than a smooth curve on purpose: it can be compared bar by
// bar, and it needs no rotated segments, so nothing here depends on getting a
// polyline's transform right in a UI space with the Y axis pointing down.
//
// The bar pool is fixed and only its heights change. Rebuilding bars per frame
// would make the scene-graph size depend on how long the scenario had been
// open.
// ============================================================

import {
    GameObject, RectTransform, UIImage, Vector2, Color,
} from "WebEngineTS";

import { maxwellDensity } from "./GasSim";

export interface HistogramOptions {
    /** Inset from the left and bottom of the screen, in canvas units. */
    x: number;
    y: number;
    width: number;
    height: number;
    bins: number;
    /** Speed at the right-hand edge, m/s. */
    maxSpeed: number;
}

const BAR_COLOR = new Color(0.35, 0.62, 0.95, 0.85);
const CURVE_COLOR = new Color(1.0, 0.78, 0.30, 1);
const MARKER_HEIGHT = 3;

export class Histogram {
    private readonly _bars: RectTransform[] = [];
    private readonly _curve: RectTransform[] = [];
    private readonly _counts: number[];

    constructor(canvas: GameObject, private readonly _options: HistogramOptions) {
        this._counts = new Array<number>(_options.bins).fill(0);
        const barWidth = _options.width / _options.bins;

        for (let i = 0; i < _options.bins; i++) {
            this._bars.push(this._makeRect(canvas, "Bar", BAR_COLOR,
                _options.x + i * barWidth, barWidth - 1, 0));
            this._curve.push(this._makeRect(canvas, "Maxwell", CURVE_COLOR,
                _options.x + i * barWidth, barWidth - 1, MARKER_HEIGHT));
        }
    }

    setVisible(visible: boolean): void {
        for (const bar of this._bars) bar.gameObject.setActive(visible);
        for (const marker of this._curve) marker.gameObject.setActive(visible);
    }

    /**
     * @param speeds  one entry per molecule, m/s
     * @param temperature the measured temperature the prediction is drawn for
     */
    update(speeds: number[], count: number, temperature: number): void {
        const { bins, maxSpeed, height } = this._options;
        const binWidth = maxSpeed / bins;

        this._counts.fill(0);
        for (let i = 0; i < count; i++) {
            const bin = Math.floor(speeds[i] / binWidth);
            if (bin >= 0 && bin < bins) this._counts[bin]++;
        }

        // Scale both to the tallest thing on screen, so bars and prediction
        // share one axis and can be read against each other.
        let peak = 1;
        for (const value of this._counts) peak = Math.max(peak, value);

        const expected: number[] = [];
        let expectedPeak = 1e-12;
        for (let i = 0; i < bins; i++) {
            const speed = (i + 0.5) * binWidth;
            const value = maxwellDensity(speed, temperature) * binWidth * count;
            expected.push(value);
            expectedPeak = Math.max(expectedPeak, value);
        }

        const scale = height / Math.max(peak, expectedPeak);

        for (let i = 0; i < bins; i++) {
            const bar = this._bars[i];
            bar.sizeDelta = new Vector2(bar.sizeDelta.x, Math.max(0, this._counts[i] * scale));

            const marker = this._curve[i];
            marker.anchoredPosition = new Vector2(
                marker.anchoredPosition.x,
                -(this._options.y + expected[i] * scale),
            );
        }
    }

    private _makeRect(canvas: GameObject, name: string, color: Color, x: number, width: number, height: number): RectTransform {
        const go = new GameObject(name);
        go.transform.parent = canvas.transform;

        const rt = go.addComponent(RectTransform);
        // Bottom-left anchor with the pivot on the same corner: growing the
        // height extends the rect upwards from the baseline, which is what a
        // bar chart wants in a Y-down layout.
        rt.anchorMin = new Vector2(0, 1);
        rt.anchorMax = new Vector2(0, 1);
        rt.pivot = new Vector2(0, 1);
        rt.anchoredPosition = new Vector2(x, -this._options.y);
        rt.sizeDelta = new Vector2(width, height);

        const image = go.addComponent(UIImage);
        image.color = color;
        return rt;
    }
}
