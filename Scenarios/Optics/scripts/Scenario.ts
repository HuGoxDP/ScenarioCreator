// scripts/Scenario.ts  (Оптика: лінзи та дзеркала)
// ============================================================
// An optical bench: move the object, change the focal length, and the three
// principal rays construct the image live. Every row of the textbook table is
// reachable with two sliders.
//
// The diagram is recomputed, never animated: there is no state to integrate,
// so `helpers/Rays.ts` is a pure function of (element, f, d, h) and this file
// only draws what it returns. That split is what makes the physics checkable
// without a renderer — and it was checked that way before this file existed.
//
// Procedural throughout; the scenario ships without a single asset.
// ============================================================

import {
    ScenarioBehaviour, GameObject, Color, AmbientLight,
    Input, KeyCode,
    TextAlignment, VerticalAlignment,
} from "WebEngineTS";

import { createFlatCamera, type IFlatCamera } from "./helpers/FlatCamera";
import {
    createUICanvas, makeLabel, makePanel, makeSlider, makeToggle, makeDropdown, makeReadout,
    UI, type SliderRow,
} from "./helpers/UIKit";
import { Painter, lensOutline, mirrorArc, mirrorHatching } from "./helpers/Bench";
import {
    solve, fan, isMirror, pointAt, ELEMENT_LABEL, type ElementKind,
} from "./helpers/Rays";

const KINDS: ElementKind[] = ["converging", "diverging", "concaveMirror", "convexMirror"];

/** Half-height of the element, and the aperture the fan spreads across. */
const APERTURE = 3.2;
/** How far outgoing rays are drawn. */
const REACH = 34;
/** Past this the image is off the bench; it is described instead of drawn. */
const DRAW_LIMIT = 34;
const FAN_COUNT = 15;

const AXIS = new Color(0.55, 0.60, 0.70, 1);
const GRID = new Color(0.16, 0.19, 0.25, 1);
const FOCUS_TICK = new Color(0.95, 0.82, 0.35, 1);
const OBJECT_COLOR = new Color(0.92, 0.95, 1, 1);
const IMAGE_COLOR = new Color(1.0, 0.62, 0.28, 1);
const GLASS = new Color(0.55, 0.80, 0.95, 1);
const RAY_COLORS = [
    new Color(0.95, 0.42, 0.40, 1),
    new Color(0.45, 0.90, 0.55, 1),
    new Color(0.45, 0.70, 1.00, 1),
];
const RAY_GHOST = new Color(0.55, 0.60, 0.72, 1);
const FAN_COLOR = new Color(0.35, 0.85, 0.85, 0.9);

export default class Optics extends ScenarioBehaviour {
    private _camera!: IFlatCamera;
    private _painter!: Painter;

    private _kind: ElementKind = "converging";
    private _focal = 8;
    private _distance = 24;
    private _height = 3;
    private _showFan = false;
    private _showGrid = true;

    private _setRow!: (row: number, text: string) => void;
    private _distanceRow!: SliderRow;

    override async awake(): Promise<void> {
        this._camera = createFlatCamera({ size: 14, background: new Color(0.05, 0.06, 0.09, 1) });

        // Lines carry their own colour, but an ambient light keeps the scene
        // from depending on whether that stays true.
        const ambient = new GameObject("Ambient").addComponent(AmbientLight);
        ambient.intensity = 0.8;
        ambient.color = new Color(1, 1, 1, 1);

        this._painter = new Painter(new GameObject("Bench"));
        this._createUI();
        this._redraw();
    }

    override update(): void {
        this._camera.update();

        // Nudging d from the keyboard is the only way to cross d = f slowly
        // enough to watch the image sweep out to infinity and come back.
        if (Input.getKey(KeyCode.ArrowLeft)) this._nudge(-0.12);
        if (Input.getKey(KeyCode.ArrowRight)) this._nudge(0.12);
        if (Input.getKeyDown(KeyCode.KeyR)) this._camera.reset();
    }

    private _nudge(delta: number): void {
        const next = Math.min(Math.max(this._distance + delta, 1), 24);
        if (next === this._distance) return;
        this._distance = next;
        this._distanceRow.set(next);
        this._redraw();
    }

    // ── drawing ─────────────────────────────────────────────────────

    private _redraw(): void {
        const reflect = isMirror(this._kind);
        const converging = this._kind === "converging" || this._kind === "concaveMirror";
        const solution = solve(this._kind, this._focal, this._distance, this._height, REACH);

        this._painter.begin();

        if (this._showGrid) {
            for (let x = -32; x <= 32; x += 4) this._painter.line(x, -12, x, 12, GRID, 0.02);
            for (let y = -12; y <= 12; y += 4) this._painter.line(-32, y, 32, y, GRID, 0.02);
        }

        this._painter.line(-REACH, 0, REACH, 0, AXIS, 0.035);

        // F as a single tick, 2F as a double one — the pair is distinguishable
        // without text, which the legend then names.
        for (const sign of [1, -1]) {
            const focus = pointAt(sign * this._focal, 0, reflect);
            const twice = pointAt(sign * 2 * this._focal, 0, reflect);
            this._painter.line(focus[0], -0.5, focus[0], 0.5, FOCUS_TICK, 0.05);
            this._painter.line(twice[0] - 0.12, -0.4, twice[0] - 0.12, 0.4, FOCUS_TICK, 0.045);
            this._painter.line(twice[0] + 0.12, -0.4, twice[0] + 0.12, 0.4, FOCUS_TICK, 0.045);
        }

        this._drawElement(converging, reflect);

        this._painter.arrow(-this._distance, this._height, OBJECT_COLOR, 0.09);

        solution.rays.forEach((ray, i) => {
            const color = RAY_COLORS[i] ?? RAY_COLORS[0];
            this._painter.line(ray.incoming[0], ray.incoming[1], ray.incoming[2], ray.incoming[3], color, 0.055);
            this._painter.line(ray.outgoing[0], ray.outgoing[1], ray.outgoing[2], ray.outgoing[3], color, 0.055);
            if (ray.back) {
                this._painter.dashed(ray.back[0], ray.back[1], ray.back[2], ray.back[3], RAY_GHOST);
            }
        });

        if (this._showFan) {
            for (const ray of fan(this._kind, this._focal, this._distance, this._height, APERTURE * 0.85, FAN_COUNT, REACH)) {
                this._painter.line(ray.incoming[0], ray.incoming[1], ray.incoming[2], ray.incoming[3], FAN_COLOR, 0.02);
                this._painter.line(ray.outgoing[0], ray.outgoing[1], ray.outgoing[2], ray.outgoing[3], FAN_COLOR, 0.02);
            }
        }

        const drawable = !solution.parallel && Math.abs(solution.imageX) <= DRAW_LIMIT;
        if (drawable) {
            // Solid for a real image, dashed for a virtual one: a virtual image
            // is where the rays only *seem* to come from, and drawing it like a
            // real one is the second most common exam mistake.
            this._painter.arrow(solution.imageX, solution.imageY, IMAGE_COLOR, 0.09, !solution.real);
        }

        this._painter.end();
        this._refreshReadout(solution, drawable);
    }

    private _drawElement(converging: boolean, reflect: boolean): void {
        if (reflect) {
            const arc = mirrorArc(converging ? this._focal : -this._focal, APERTURE);
            this._painter.polyline(arc, GLASS, 0.09);
            for (const stroke of mirrorHatching(arc)) {
                this._painter.line(stroke[0][0], stroke[0][1], stroke[1][0], stroke[1][1], GLASS, 0.03);
            }
            return;
        }

        // A short focal length is a fat lens: the curvature does the bending.
        const bulge = Math.min(Math.max(26 / this._focal, 0.55), 2.4);
        const outline = converging
            ? lensOutline(true, APERTURE, bulge, 0.12)
            : lensOutline(false, APERTURE, 0.3, bulge);
        this._painter.polyline(outline, GLASS, 0.07);
    }

    // ── readout ─────────────────────────────────────────────────────

    private _refreshReadout(solution: ReturnType<typeof solve>, drawable: boolean): void {
        const f = solution.f;
        this._setRow(0, "1/f = 1/d + 1/d′");

        if (solution.parallel) {
            this._setRow(1, `1/${f.toFixed(1)} = 1/${this._distance.toFixed(1)} + 1/d′`);
            this._setRow(2, "d′ — не існує");
            this._setRow(3, "Γ — не існує");
            this._setRow(4, "Промені виходять паралельно.");
            this._setRow(5, "Зображення — на нескінченності.");
            this._setRow(6, "Це предмет у фокусі: d = f.");
            return;
        }

        this._setRow(1, `1/${f.toFixed(1)} = 1/${this._distance.toFixed(1)} + 1/${solution.dPrime.toFixed(2)}`);
        this._setRow(2, `d′ = ${solution.dPrime.toFixed(2)}`);
        this._setRow(3, `Γ = ${solution.magnification.toFixed(2)}   (h′ = ${solution.hPrime.toFixed(2)})`);
        this._setRow(4, solution.real ? "Зображення: дійсне" : "Зображення: уявне");
        this._setRow(5, solution.upright ? "Орієнтація: пряме" : "Орієнтація: перевернуте");

        const size = Math.abs(solution.magnification);
        const sizeWord = size > 1.01 ? "збільшене" : size < 0.99 ? "зменшене" : "того ж розміру";
        this._setRow(6, drawable
            ? `Розмір: ${sizeWord}`
            : `Розмір: ${sizeWord} — але воно далеко за межами кадру, тому не намальоване.`);
    }

    // ── UI ──────────────────────────────────────────────────────────

    private _createUI(): void {
        const canvas = createUICanvas();

        makeLabel(canvas, {
            anchor: "top-center", y: 10, width: 700, height: 30,
            text: "Оптика: лінзи та дзеркала",
            fontSize: 26, align: TextAlignment.Center, valign: VerticalAlignment.Middle,
        });

        // ── readout (left) ──
        makePanel(canvas, { anchor: "top-left", x: 16, y: 56, width: 300, height: 168 });
        this._setRow = makeReadout(canvas, {
            anchor: "top-left", x: 30, y: 66, width: 274, height: 150,
            rows: 7, fontSize: 13, rowHeight: 20,
        });

        // ── legend (left, below) ──
        makePanel(canvas, { anchor: "top-left", x: 16, y: 234, width: 300, height: 128 });
        const legend = (y: number, color: Color, text: string): void => {
            makeLabel(canvas, {
                anchor: "top-left", x: 30, y, width: 274, height: 18,
                text, fontSize: 11, color, wordWrap: false,
            });
        };
        legend(242, RAY_COLORS[0], "━ паралельний осі → через фокус");
        legend(260, RAY_COLORS[1], "━ через оптичний центр → без заломлення");
        legend(278, RAY_COLORS[2], "━ через фокус → паралельно осі");
        legend(296, RAY_GHOST, "┄ уявне продовження: світла там немає");
        legend(314, FOCUS_TICK, "│ фокус F      ‖ подвійна риска — 2F");
        legend(332, OBJECT_COLOR, "━ предмет");
        legend(350, IMAGE_COLOR, "━ зображення (пунктиром, якщо уявне)");

        // ── controls (right) ──
        makePanel(canvas, { anchor: "top-right", x: 16, y: 56, width: 288, height: 244 });

        makeDropdown(canvas, {
            anchor: "top-right", x: 30, y: 66, width: 260, height: 26,
            options: KINDS.map((kind) => ELEMENT_LABEL[kind]), value: 0, maxVisibleItems: 4,
            onChange: (index) => { this._kind = KINDS[index]; this._redraw(); },
        });

        makeSlider(canvas, {
            anchor: "top-right", x: 30, y: 102, width: 260, height: 14,
            label: "Фокусна відстань |f|", min: 2, max: 12, value: this._focal,
            format: (v) => v.toFixed(1),
            onChange: (v) => { this._focal = v; this._redraw(); },
        });

        this._distanceRow = makeSlider(canvas, {
            anchor: "top-right", x: 30, y: 146, width: 260, height: 14,
            label: "Відстань до предмета d", min: 1, max: 24, value: this._distance,
            format: (v) => v.toFixed(1),
            onChange: (v) => { this._distance = v; this._redraw(); },
        });

        makeSlider(canvas, {
            anchor: "top-right", x: 30, y: 190, width: 260, height: 14,
            label: "Висота предмета h", min: 0.5, max: 5, value: this._height,
            format: (v) => v.toFixed(1),
            onChange: (v) => { this._height = v; this._redraw(); },
        });

        makeToggle(canvas, {
            anchor: "top-right", x: 30, y: 232, width: 260, height: 22,
            label: "Усі промені (віяло)", value: false,
            onChange: (on) => { this._showFan = on; this._redraw(); },
        });

        makeToggle(canvas, {
            anchor: "top-right", x: 30, y: 262, width: 260, height: 22,
            label: "Сітка", value: true,
            onChange: (on) => { this._showGrid = on; this._redraw(); },
        });

        makeLabel(canvas, {
            anchor: "bottom-center", y: 18, width: 1100, height: 20,
            text: "←/→ — плавно рухати предмет крізь фокус   •   колесо — масштаб   "
                + "•   перетягування — панорама   •   R — початковий вигляд",
            fontSize: 12, color: UI.textDim,
            align: TextAlignment.Center, valign: VerticalAlignment.Middle,
        });
    }
}
