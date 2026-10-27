// scripts/Scenario.ts  (Електричні кола)
// ============================================================
// Four fixed circuits the student parameterises, solved live.
//
// NOT a circuit editor. Placing components, drawing wires, detecting loops and
// solving an arbitrary graph is an application, not a scenario. What teaches
// the material is *varying* a known circuit and watching Ohm's law hold, so
// four templates ship with sliders on everything that matters — and each has a
// three-line closed-form solver anyone can check against a textbook.
//
// The electricity lives in `helpers/Circuit.ts`, which imports nothing from the
// engine. Its identities — one current in series, one voltage in parallel, and
// the worked mixed example — are asserted at load by `validateSolver()`.
// ============================================================

import {
    ScenarioBehaviour, GameObject, Color, Vector3, Quaternion, Mesh,
    AmbientLight, InstancedMeshRenderer, StandardMaterial, Time,
    Input, KeyCode,
    TextAlignment, VerticalAlignment,
    Button, UIText,
} from "WebEngineTS";

import { createFlatCamera, type IFlatCamera } from "./helpers/FlatCamera";
import {
    createUICanvas, makeLabel, makePanel, makeButton, makeSlider, makeToggle,
    makeReadout, UI,
} from "./helpers/UIKit";
import { Painter } from "./helpers/Painter";
import {
    layoutFor, pathLength, pointAlong, type Layout, type Glyph, type Point,
} from "./helpers/Layout";
import { TEMPLATES, solve, validateSolver, type Solution, type TemplateKey } from "./helpers/Circuit";
import { TASKS, TaskProgress } from "./helpers/Tasks";

const WIRE = new Color(0.62, 0.70, 0.82, 1);
const DEAD_WIRE = new Color(0.32, 0.36, 0.44, 1);
const BATTERY = new Color(0.95, 0.86, 0.45, 1);
const SWITCH_ON = new Color(0.45, 0.90, 0.55, 1);
const SWITCH_OFF = new Color(0.90, 0.45, 0.42, 1);
const CARRIER = new Color(0.40, 0.78, 1.00, 1);
const TASK_SOLVED = new Color(0.45, 0.90, 0.55, 1);

/** One colour per resistor, matching its row in the readout. */
const ELEMENT_COLORS: Record<string, Color> = {
    R1: new Color(0.95, 0.55, 0.35, 1),
    R2: new Color(0.55, 0.85, 0.95, 1),
    R3: new Color(0.80, 0.65, 0.95, 1),
};

const MAX_CARRIERS = 220;
/** Metres of wire between carriers at one ampere. */
const SPACING_AT_1A = 1.9;
/** Radius of a drawn carrier. */
const CARRIER_SIZE = 0.14;
/** Distance over which a carrier fades in at a wire's start and out at its end. */
const CARRIER_FADE = 0.55;
/** World units a carrier travels per second per ampere. */
const CARRIER_SPEED = 2.4;

export default class Circuits extends ScenarioBehaviour {
    private _camera!: IFlatCamera;
    private _painter!: Painter;
    private _carriers!: InstancedMeshRenderer;

    private _template: TemplateKey = "single";
    private _layout!: Layout;
    private _solution!: Solution;

    private _emf = 12;
    // R₁ = 30, not 24: 12 V / 24 Ω is exactly the lamp task's 0.5 A, which would
    // open the scenario with a task already solved.
    private readonly _resistance = [30, 20, 20];
    private _closed = true;
    private _showCarriers = true;
    private _phase = 0;

    private _tabs: Button[] = [];
    private _setRow!: (row: number, text: string) => void;
    private _lessonText!: UIText;

    // Task mode: the platform owns the submit button, so the scenario only
    // reports the score whenever the set of solved tasks changes.
    private readonly _tasks = new TaskProgress();
    private _taskRows: UIText[] = [];
    private _taskHeader!: UIText;
    /** reportResult is accepted from start() on, not during awake(). */
    private _reporting = false;

    private readonly _scratch = new Vector3(0, 0, 0);
    private readonly _scale = new Vector3(1, 1, 1);

    override async awake(): Promise<void> {
        for (const problem of validateSolver()) console.warn(`[circuit] ${problem}`);

        this._camera = createFlatCamera({ size: 8.5, background: new Color(0.05, 0.06, 0.09, 1) });

        const ambient = new GameObject("Ambient").addComponent(AmbientLight);
        ambient.intensity = 0.9;
        ambient.color = new Color(1, 1, 1, 1);

        this._painter = new Painter(new GameObject("Schematic"));

        const carriersGo = new GameObject("Carriers");
        this._carriers = carriersGo.addComponent(InstancedMeshRenderer);
        this._carriers.mesh = Mesh.createSphere(1, 8);
        const material = new StandardMaterial();
        material.albedoColor = CARRIER;
        material.emissionColor = new Color(0.15, 0.35, 0.55, 1);
        this._carriers.sharedMaterial = material;
        this._carriers.count = MAX_CARRIERS;

        this._createUI();
        this._select("single");
    }

    override start(): void {
        // The state built during awake(), which could not be reported then.
        this._reporting = true;
        this._reportTasks();
    }

    override update(): void {
        this._camera.update();

        if (Input.getKeyDown(KeyCode.Space)) this._setClosed(!this._closed);
        if (Input.getKeyDown(KeyCode.KeyR)) this._camera.reset();

        // Carriers advance by current, so a doubled current is a visibly
        // faster stream rather than a number that changed.
        this._phase += this._solution.current * CARRIER_SPEED * Time.deltaTime;

        this._draw();
    }

    // ── state ───────────────────────────────────────────────────────

    private _select(key: TemplateKey): void {
        this._template = key;
        this._layout = layoutFor(key);
        this._tabs.forEach((tab, i) => {
            tab.normalColor = TEMPLATES[i].key === key ? UI.buttonHover : UI.buttonNormal;
        });
        this._lessonText.text = TEMPLATES.find((t) => t.key === key)?.lesson ?? "";
        this._recompute();
    }

    private _setClosed(closed: boolean): void {
        this._closed = closed;
        this._recompute();
    }

    private _recompute(): void {
        this._solution = solve(this._template, this._emf, this._resistance, this._closed);
        this._refreshReadout();
        // Only the circuit on screen is re-checked: the sliders are shared, so
        // re-checking the other three would unsolve tasks the student left.
        const changed = this._tasks.evaluate(this._template, this._emf, this._solution);
        this._refreshTasks();
        if (changed) this._reportTasks();
    }

    private _reportTasks(): void {
        if (!this._reporting) return;
        this.reportResult({ score: this._tasks.score, completed: this._tasks.completed });
    }

    private _refreshTasks(): void {
        const solvedCount = TASKS.filter((t) => this._tasks.isSolved(t.key)).length;
        this._taskHeader.text = `Завдання: розв'язано ${solvedCount} з ${TASKS.length}`;
        TASKS.forEach((task, i) => {
            const solved = this._tasks.isSolved(task.key);
            const row = this._taskRows[i];
            row.text = `${solved ? "[+]" : "[ ]"} ${i + 1}. ${task.text}`;
            row.color = solved ? TASK_SOLVED : task.key === this._template ? UI.text : UI.textDim;
        });
    }

    private _currentOn(source: string): number {
        if (source === "main") return this._solution.current;
        const element = this._solution.elements.find((e) => e.id === source);
        return element ? element.current : this._solution.current;
    }

    // ── drawing ─────────────────────────────────────────────────────

    private _draw(): void {
        this._painter.begin();

        const live = !this._solution.open && this._solution.current > 1e-6;
        for (const wire of this._layout.wires) {
            this._painter.polyline(wire.points.map((p) => [p[0], p[1]]), live ? WIRE : DEAD_WIRE, 0.07);
        }
        for (const glyph of this._layout.glyphs) this._drawGlyph(glyph);

        this._painter.end();
        this._drawCarriers();
    }

    private _drawGlyph(glyph: Glyph): void {
        const [x, y] = glyph.at;

        if (glyph.kind === "battery") {
            // The long plate is the positive terminal — the standard symbol.
            this._painter.line(x - 0.7, y + 0.35, x + 0.7, y + 0.35, BATTERY, 0.09);
            this._painter.line(x - 0.35, y - 0.35, x + 0.35, y - 0.35, BATTERY, 0.14);
            this._painter.line(x, y + 0.35, x, y + 1.2, BATTERY, 0.06);
            this._painter.line(x, y - 0.35, x, y - 1.2, BATTERY, 0.06);
            return;
        }

        if (glyph.kind === "switch") {
            const color = this._closed ? SWITCH_ON : SWITCH_OFF;
            this._painter.line(x - 1, y, x - 0.5, y, color, 0.07);
            this._painter.line(x + 0.5, y, x + 1, y, color, 0.07);
            // Open: the blade lifts off its contact, and the gap is the circuit.
            const tip: Point = this._closed ? [x + 0.5, y] : [x + 0.35, y + 0.85];
            this._painter.line(x - 0.5, y, tip[0], tip[1], color, 0.08);
            return;
        }

        if (glyph.kind === "lamp") {
            const element = this._solution.elements[0];
            const maxPower = (24 * 24) / Math.max(this._resistance[0], 1);
            const brightness = element ? Math.min(1, element.power / Math.max(maxPower * 0.35, 1e-6)) : 0;
            const glow = new Color(
                0.35 + 0.65 * brightness,
                0.35 + 0.55 * brightness,
                0.38 + 0.15 * brightness,
                1,
            );
            const width = 0.06 + 0.06 * brightness;

            const radius = 0.75;
            const circle: number[][] = [];
            for (let i = 0; i <= 28; i++) {
                const a = (i / 28) * Math.PI * 2;
                circle.push([x + Math.cos(a) * radius, y + Math.sin(a) * radius]);
            }
            this._painter.polyline(circle, glow, width);
            const d = radius * 0.7;
            this._painter.line(x - d, y - d, x + d, y + d, glow, width);
            this._painter.line(x - d, y + d, x + d, y - d, glow, width);
            this._painter.line(x - 1.5, y, x - radius, y, WIRE, 0.07);
            this._painter.line(x + radius, y, x + 1.5, y, WIRE, 0.07);
            return;
        }

        // Resistor: the rectangle, in its own colour so the readout row matches.
        const color = ELEMENT_COLORS[glyph.id ?? "R1"] ?? WIRE;
        const halfLong = 0.95;
        const halfShort = 0.4;
        const box: number[][] = glyph.horizontal
            ? [
                [x - halfLong, y - halfShort], [x + halfLong, y - halfShort],
                [x + halfLong, y + halfShort], [x - halfLong, y + halfShort],
                [x - halfLong, y - halfShort],
            ]
            : [
                [x - halfShort, y - halfLong], [x + halfShort, y - halfLong],
                [x + halfShort, y + halfLong], [x - halfShort, y + halfLong],
                [x - halfShort, y - halfLong],
            ];
        this._painter.polyline(box, color, 0.08);
    }

    /**
     * Carriers along every wire: spacing from the current, speed from the
     * current, so a branch carrying twice as much is visibly twice as busy.
     */
    private _drawCarriers(): void {
        let index = 0;
        if (!this._showCarriers) {
            this._park(0);
            this._carriers.apply();
            return;
        }

        // Distance covered by the wires already placed, so the carrier pattern
        // runs along the whole path rather than restarting on each wire.
        let travelled = 0;

        for (const wire of this._layout.wires) {
            const current = Math.abs(this._currentOn(wire.source));
            const length = pathLength(wire.points);
            // Floored at length/26 so a wire never asks for more carriers than the
            // budget allows. Saturating the density is the graceful way to hit that
            // limit: the alternative, drawing 26 and stopping, empties the far end
            // of the wire and starves whatever comes after it.
            const spacing = Math.max(SPACING_AT_1A / Math.max(current, 0.12), length / 26);

            // Carriers sit a whole number of `spacing` apart, measured from where
            // the phase has carried them along the path. Two things follow, and
            // both were wrong before, when the count was a whole number and the
            // gap came out as length/count:
            //
            //  - wires carrying the same current space their carriers the same,
            //    whatever their length. A 200-unit gap on one wire and 239 on the
            //    next, in a series circuit, said the current differed when it
            //    cannot;
            //  - a drifting current slides the carriers instead of re-spacing
            //    every one of them at the instant the count ticks over.
            //
            // Subtracting `travelled` continues the pattern across the junction,
            // so a carrier leaves one wire as another enters the next, rather than
            // each wire recirculating its own carriers from nowhere.
            //
            // It only lines up where the current does. Wires meeting at a junction
            // that carry the same current stay in step; where the current splits it
            // cannot, because the spacing carries the current and a branch that
            // takes less of it is spaced wider. That is honest — charge divides
            // there — but it is why the ends still need the inset below.
            const offset = (((this._phase - travelled) % spacing) + spacing) % spacing;

            // A carrier shrinks away as it reaches a wire's end and grows back on
            // the next. Something has to appear and disappear — the wires are
            // finite and drawn one at a time — so the only question is where and
            // how abruptly, and a hard edge anywhere reads as a carrier winking
            // into existence. That was the report: electrons appearing and
            // vanishing, marked at the junctions.
            //
            // It also settles the doubling. Two wires meeting at a point both draw
            // there, and at full size that is one dot on top of another blinking as
            // their phases drift; faded, both are nearly nothing by the time they
            // reach it.
            //
            // `d < length`: pointAlong wraps its parameter, so t = 1 would land
            // back at the wire's start. Anything that close is invisible anyway.
            const fadeOver = Math.min(CARRIER_FADE, length * 0.35);
            for (let d = offset; d < length && index < MAX_CARRIERS; d += spacing) {
                const fade = Math.min(1, Math.min(d, length - d) / fadeOver);
                if (fade <= 0.02) continue;

                const at = pointAlong(wire.points, d / Math.max(length, 1e-6));
                this._scratch.set(at[0], at[1], 0.25);
                const size = CARRIER_SIZE * fade;
                this._scale.set(size, size, size);
                this._carriers.setInstanceTransform(index, this._scratch, Quaternion.identity, this._scale);
                index++;
            }

            travelled += length;
        }

        this._park(index);
        this._carriers.apply();
    }

    private _park(from: number): void {
        this._scale.set(0, 0, 0);
        for (let i = from; i < MAX_CARRIERS; i++) {
            this._carriers.setInstanceTransform(i, Vector3.zero, Quaternion.identity, this._scale);
        }
    }

    // ── readout ─────────────────────────────────────────────────────

    private _refreshReadout(): void {
        const s = this._solution;

        this._setRow(0, s.open
            ? "Вимикач розімкнено: струму немає ніде."
            : s.shorted
                ? "Коротке замикання — опір занизький, показ обмежено."
                : `R_екв = ${s.equivalent.toFixed(2)} Ом      I = ${s.current.toFixed(3)} А`);
        this._setRow(1, `Джерело: ${this._emf.toFixed(1)} В      P = ${s.totalPower.toFixed(2)} Вт`);
        this._setRow(2, "");
        this._setRow(3, "елемент     R, Ом     U, В      I, А     P, Вт");

        s.elements.forEach((element, i) => {
            this._setRow(4 + i,
                `${element.label.padEnd(6)}  ${element.resistance.toFixed(1).padStart(7)}`
                + `  ${element.voltage.toFixed(2).padStart(7)}`
                + `  ${element.current.toFixed(3).padStart(7)}`
                + `  ${element.power.toFixed(2).padStart(7)}`);
        });
        for (let i = s.elements.length; i < 3; i++) this._setRow(4 + i, "");

        // The identity this template is meant to make visible, evaluated live.
        if (this._template === "series") {
            const sum = s.elements.reduce((total, e) => total + e.voltage, 0);
            this._setRow(7, `U₁+U₂+U₃ = ${sum.toFixed(2)} В — стільки ж, скільки дає джерело.`);
            this._setRow(8, "Струм в усіх трьох рядках однаковий: він не «витрачається».");
        } else if (this._template === "parallel") {
            const sum = s.elements.reduce((total, e) => total + e.current, 0);
            this._setRow(7, `I₁+I₂+I₃ = ${sum.toFixed(3)} А — це і є повний струм.`);
            this._setRow(8, "Напруга в усіх трьох рядках однакова.");
        } else if (this._template === "mixed") {
            const parallel = s.equivalent - s.elements[0].resistance;
            this._setRow(7, `R₂ ∥ R₃ = ${parallel.toFixed(2)} Ом,  далі R_екв = R₁ + ${parallel.toFixed(2)}.`);
            this._setRow(8, "");
        } else {
            this._setRow(7, "Яскравість лампи пропорційна потужності P = U·I.");
            this._setRow(8, "");
        }
    }

    // ── UI ──────────────────────────────────────────────────────────

    private _createUI(): void {
        const canvas = createUICanvas();

        makeLabel(canvas, {
            anchor: "top-center", y: 10, width: 700, height: 30,
            text: "Електричні кола",
            fontSize: 26, align: TextAlignment.Center, valign: VerticalAlignment.Middle,
        });

        this._tabs = TEMPLATES.map((template, i) => makeButton(canvas, {
            anchor: "top-center", x: (i - 1.5) * 168, y: 46, width: 164, height: 26,
            text: template.name, fontSize: 12,
            onClick: () => this._select(template.key),
        }));

        // ── readout (left) ──
        makePanel(canvas, { anchor: "top-left", x: 16, y: 86, width: 344, height: 210 });
        this._setRow = makeReadout(canvas, {
            anchor: "top-left", x: 28, y: 96, width: 322, height: 190,
            rows: 9, fontSize: 12, rowHeight: 20,
        });

        // ── element key (left, below) ──
        makePanel(canvas, { anchor: "top-left", x: 16, y: 304, width: 344, height: 74 });
        (["R1", "R2", "R3"] as const).forEach((id, i) => {
            makeLabel(canvas, {
                anchor: "top-left", x: 28, y: 312 + i * 20, width: 322, height: 18,
                text: `■ ${id} — прямокутник цього кольору на схемі`,
                fontSize: 11, color: ELEMENT_COLORS[id], wordWrap: false,
            });
        });

        // ── tasks (right, below the controls) ──
        makePanel(canvas, { anchor: "top-right", x: 16, y: 354, width: 288, height: 214 });
        this._taskHeader = makeLabel(canvas, {
            anchor: "top-right", x: 28, y: 362, width: 264, height: 20,
            text: "", fontSize: 14, color: UI.accent, wordWrap: false,
        });
        this._taskRows = TASKS.map((task, i) => makeLabel(canvas, {
            anchor: "top-right", x: 28, y: 390 + i * 44, width: 264, height: 40,
            text: task.text, fontSize: 12,
        }));

        this._lessonText = makeLabel(canvas, {
            anchor: "bottom-left", x: 24, y: 48, width: 560, height: 74,
            text: "", fontSize: 12, color: UI.textDim,
        });

        // ── controls (right) ──
        makePanel(canvas, { anchor: "top-right", x: 16, y: 86, width: 288, height: 260 });

        makeSlider(canvas, {
            anchor: "top-right", x: 30, y: 96, width: 260, height: 14,
            label: "ЕРС джерела, В", min: 1, max: 24, value: this._emf,
            format: (v) => `${v.toFixed(1)} В`,
            onChange: (v) => { this._emf = v; this._recompute(); },
        });

        (["R₁", "R₂", "R₃"] as const).forEach((label, i) => {
            makeSlider(canvas, {
                anchor: "top-right", x: 30, y: 140 + i * 44, width: 260, height: 14,
                label: `${label}, Ом`, min: 1, max: 100, value: this._resistance[i],
                format: (v) => `${v.toFixed(0)} Ом`,
                onChange: (v) => { this._resistance[i] = v; this._recompute(); },
            });
        });

        makeToggle(canvas, {
            anchor: "top-right", x: 30, y: 276, width: 260, height: 20,
            label: "Вимикач замкнено", value: true,
            onChange: (on) => this._setClosed(on),
        });
        makeToggle(canvas, {
            anchor: "top-right", x: 30, y: 302, width: 260, height: 20,
            label: "Носії заряду", value: true,
            onChange: (on) => { this._showCarriers = on; },
        });

        makeLabel(canvas, {
            anchor: "bottom-center", y: 16, width: 1100, height: 20,
            text: "Пробіл — вимикач   •   колесо — масштаб   •   перетягування — панорама   •   R — початковий вигляд",
            fontSize: 12, color: UI.textDim,
            align: TextAlignment.Center, valign: VerticalAlignment.Middle,
        });
    }
}
