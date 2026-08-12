// scripts/Scenario.ts  (Молекулярно-кінетична теорія)
// ============================================================
// Several hundred nitrogen molecules in a box with a movable piston.
//
// The point of the scenario is that `pV = NkT` is a RESULT, not an assumption.
// Nothing in `helpers/GasSim.ts` knows the gas law: molecules fly in straight
// lines, bounce off each other and off the walls, and the pressure shown is the
// momentum they deliver to the walls per second per square metre. The ideal-gas
// prediction is printed beside it for comparison.
//
// Units are real SI — nitrogen molecules in a 20 nm box — so the readouts are
// in kelvin, kilopascals and metres per second and can be checked against a
// textbook. Only time is compressed, or nothing would be visible.
// ============================================================

import {
    ScenarioBehaviour, GameObject, Color, Vector3, Quaternion,
    DirectionalLight, AmbientLight, Mesh, StandardMaterial,
    InstancedMeshRenderer, LineRenderer, Time,
    Input, KeyCode,
    TextAlignment, VerticalAlignment,
    Button,
} from "WebEngineTS";

import { createCameraRig, type ICameraRig } from "./helpers/CameraSetup";
import {
    createUICanvas, makeLabel, makePanel, makeButton, makeSlider, makeToggle, makeReadout, UI,
} from "./helpers/UIKit";
import { Histogram } from "./helpers/Histogram";
import {
    GasSim, BOX_EDGE, MOLECULE_RADIUS, MAX_COUNT,
    rmsSpeed, meanSpeed, mostProbableSpeed,
} from "./helpers/GasSim";

type Mode = "ideal" | "brownian" | "maxwell";

const MODES: { key: Mode; label: string }[] = [
    { key: "ideal", label: "Ідеальний газ" },
    { key: "brownian", label: "Броунівський рух" },
    { key: "maxwell", label: "Розподіл швидкостей" },
];

/** The 20 nm box is drawn this many world units across. */
const BOX_WORLD = 10;
const WORLD_PER_METRE = BOX_WORLD / BOX_EDGE;

const TRAIL_CAPACITY = 400;
const HISTOGRAM_BINS = 26;
const HISTOGRAM_MAX_SPEED = 1600;

const COLD = new Color(0.35, 0.55, 1.0, 1);
const HOT = new Color(1.0, 0.42, 0.30, 1);
const PLAIN = new Color(0.62, 0.78, 0.95, 1);
const HEAVY = new Color(1.0, 0.80, 0.35, 1);

export default class KineticTheory extends ScenarioBehaviour {
    private _camera!: ICameraRig;
    private _sim!: GasSim;
    private _histogram!: Histogram;

    private _molecules!: InstancedMeshRenderer;
    private _boxLines: LineRenderer[] = [];
    private _trail!: LineRenderer;
    private readonly _trailPoints: Vector3[] = [];

    private _mode: Mode = "ideal";
    private _colourBySpeed = true;
    private _showTrail = true;

    private _tabs: Button[] = [];
    private _setRow!: (row: number, text: string) => void;
    private readonly _speeds = new Array<number>(MAX_COUNT).fill(0);

    override async awake(): Promise<void> {
        this._camera = createCameraRig({
            useSkybox: false,
            orbitDistance: 20,
            orbitMaxDistance: 60,
            backgroundColor: new Color(0.04, 0.05, 0.08, 1),
        });

        this._createLights();

        this._sim = new GasSim(20240812);
        this._sim.setCount(320);
        this._sim.setTargetTemperature(300);
        this._sim.reset(false);

        this._createBox();
        this._createMolecules();
        this._createUI();
        this._setMode("ideal");
    }

    override update(): void {
        if (Input.getKeyDown(KeyCode.KeyR)) this._sim.reset(false);
        if (Input.getKeyDown(KeyCode.KeyE)) this._sim.reset(true);

        this._sim.step(Time.deltaTime);

        this._drawMolecules();
        this._drawBox();
        this._drawTrail();
        this._refreshReadout();

        if (this._mode === "maxwell") {
            for (let i = 0; i < this._sim.count; i++) this._speeds[i] = this._sim.speedOf(i);
            this._histogram.update(this._speeds, this._sim.count, this._sim.temperature);
        }
    }

    // ── scene ───────────────────────────────────────────────────────

    private _createLights(): void {
        const keyGo = new GameObject("Key Light");
        const key = keyGo.addComponent(DirectionalLight);
        key.intensity = 1.2;
        key.color = new Color(1, 0.98, 0.95, 1);
        keyGo.transform.rotation = Quaternion.euler(38, -32, 0);

        const ambGo = new GameObject("Ambient");
        const amb = ambGo.addComponent(AmbientLight);
        amb.intensity = 0.55;
        amb.color = new Color(0.55, 0.62, 0.78, 1);
    }

    private _createMolecules(): void {
        const go = new GameObject("Molecules");
        this._molecules = go.addComponent(InstancedMeshRenderer);
        this._molecules.mesh = Mesh.createSphere(1, 8);

        const material = new StandardMaterial();
        material.albedoColor = new Color(1, 1, 1, 1);
        material.smoothness = 0.5;
        this._molecules.sharedMaterial = material;
        this._molecules.count = MAX_COUNT;

        const trailGo = new GameObject("Brownian trail");
        this._trail = trailGo.addComponent(LineRenderer);
        this._trail.useWorldSpace = true;
        this._trail.startWidth = 0.05;
        this._trail.endWidth = 0.05;
        this._trail.startColor = HEAVY;
        this._trail.endColor = HEAVY;
        trailGo.setActive(false);
    }

    /** Twelve edges, each its own line; the piston face is redrawn as it moves. */
    private _createBox(): void {
        const root = new GameObject("Box");
        for (let i = 0; i < 12; i++) {
            const go = new GameObject(`Edge ${i}`);
            go.transform.parent = root.transform;
            const line = go.addComponent(LineRenderer);
            line.useWorldSpace = true;
            line.startWidth = 0.03;
            line.endWidth = 0.03;
            const tint = i >= 8 ? new Color(1, 0.72, 0.4, 1) : new Color(0.45, 0.55, 0.70, 1);
            line.startColor = tint;
            line.endColor = tint;
            this._boxLines.push(line);
        }
    }

    /** Simulation metres → world units, centred on the origin. */
    private _toWorld(x: number, y: number, z: number, out: Vector3): Vector3 {
        out.set(
            x * WORLD_PER_METRE - BOX_WORLD / 2,
            y * WORLD_PER_METRE - BOX_WORLD / 2,
            z * WORLD_PER_METRE - BOX_WORLD / 2,
        );
        return out;
    }

    private readonly _scratch = new Vector3(0, 0, 0);
    private readonly _scale = new Vector3(1, 1, 1);

    private _drawMolecules(): void {
        const heavy = this._sim.heavyIndex;
        const reference = Math.max(rmsSpeed(this._sim.temperature), 1);

        for (let i = 0; i < MAX_COUNT; i++) {
            if (i >= this._sim.count) {
                // Park the unused instances inside the origin at zero size
                // rather than resizing the batch, so the object count is fixed.
                this._scale.set(0, 0, 0);
                this._molecules.setInstanceTransform(i, Vector3.zero, Quaternion.identity, this._scale);
                continue;
            }

            const o = i * 3;
            this._toWorld(this._sim.position[o], this._sim.position[o + 1], this._sim.position[o + 2], this._scratch);
            const radius = this._sim.radius[i] * WORLD_PER_METRE;
            this._scale.set(radius, radius, radius);
            this._molecules.setInstanceTransform(i, this._scratch, Quaternion.identity, this._scale);

            if (i === heavy) {
                this._molecules.setInstanceColor(i, HEAVY);
            } else if (this._colourBySpeed) {
                // Blue at rest through red at twice the rms speed.
                const t = Math.min(1, this._sim.speedOf(i) / (reference * 1.6));
                this._molecules.setInstanceColor(i, new Color(
                    COLD.r + (HOT.r - COLD.r) * t,
                    COLD.g + (HOT.g - COLD.g) * t,
                    COLD.b + (HOT.b - COLD.b) * t,
                    1,
                ));
            } else {
                this._molecules.setInstanceColor(i, PLAIN);
            }
        }
        this._molecules.apply();
    }

    private _drawBox(): void {
        const lo = -BOX_WORLD / 2;
        const hi = BOX_WORLD / 2;
        const top = lo + this._sim.boxZ * WORLD_PER_METRE;

        const corner = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z);
        const edges: [Vector3, Vector3][] = [
            // Fixed walls.
            [corner(lo, lo, lo), corner(hi, lo, lo)],
            [corner(hi, lo, lo), corner(hi, hi, lo)],
            [corner(hi, hi, lo), corner(lo, hi, lo)],
            [corner(lo, hi, lo), corner(lo, lo, lo)],
            [corner(lo, lo, lo), corner(lo, lo, top)],
            [corner(hi, lo, lo), corner(hi, lo, top)],
            [corner(hi, hi, lo), corner(hi, hi, top)],
            [corner(lo, hi, lo), corner(lo, hi, top)],
            // The piston face, in its own colour.
            [corner(lo, lo, top), corner(hi, lo, top)],
            [corner(hi, lo, top), corner(hi, hi, top)],
            [corner(hi, hi, top), corner(lo, hi, top)],
            [corner(lo, hi, top), corner(lo, lo, top)],
        ];

        edges.forEach((edge, i) => this._boxLines[i].setPositions([edge[0], edge[1]]));
    }

    private _drawTrail(): void {
        const heavy = this._sim.heavyIndex;
        const active = this._mode === "brownian" && heavy >= 0 && this._showTrail;
        this._trail.gameObject.setActive(active && this._trailPoints.length > 1);
        if (!active) return;

        const o = heavy * 3;
        const at = this._toWorld(this._sim.position[o], this._sim.position[o + 1], this._sim.position[o + 2], new Vector3(0, 0, 0));
        const last = this._trailPoints[this._trailPoints.length - 1];
        if (last && Vector3.distance(last, at) < 0.04) return;

        this._trailPoints.push(at);
        if (this._trailPoints.length > TRAIL_CAPACITY) this._trailPoints.shift();
        if (this._trailPoints.length > 1) this._trail.setPositions(this._trailPoints);
    }

    // ── modes ───────────────────────────────────────────────────────

    private _setMode(mode: Mode): void {
        this._mode = mode;
        this._tabs.forEach((tab, i) => {
            tab.normalColor = MODES[i].key === mode ? UI.buttonHover : UI.buttonNormal;
        });

        this._trailPoints.length = 0;
        this._histogram.setVisible(mode === "maxwell");
        this._sim.setBrownian(mode === "brownian");
        if (mode === "maxwell") this._sim.reset(true);
    }

    // ── readout ─────────────────────────────────────────────────────

    private _refreshReadout(): void {
        const t = this._sim.temperature;
        const p = this._sim.pressure;
        const ideal = this._sim.idealPressure;

        this._setRow(0, `T = ${t.toFixed(0)} K   (задано ${this._sim.targetTemperature.toFixed(0)} K)`);
        this._setRow(1, `N = ${this._sim.count}      V = ${(this._sim.volume * 1e27).toFixed(1)} нм³`);
        this._setRow(2, "");
        this._setRow(3, `Тиск, виміряний по ударах:  ${(p / 1000).toFixed(1)} кПа`);
        this._setRow(4, `Передбачення NkT/V:         ${(ideal / 1000).toFixed(1)} кПа`);
        this._setRow(5, ideal > 0 ? `відношення  ${(p / ideal).toFixed(3)}` : "");
        this._setRow(6, "");
        this._setRow(7, `v_квадратична виміряна: ${this._sim.rms.toFixed(0)} м/с`);
        this._setRow(8, `√(3kT/m) = ${rmsSpeed(t).toFixed(0)}   ⟨v⟩ = ${meanSpeed(t).toFixed(0)}   v_ймов = ${mostProbableSpeed(t).toFixed(0)} м/с`);

        if (this._mode === "brownian" && this._sim.heavyIndex >= 0) {
            const heavy = this._sim.heavyIndex;
            this._setRow(9, `Важка частинка: ${(this._sim.mass[heavy] / this._sim.mass[1]).toFixed(0)}× маси молекули, `
                + `швидкість ${this._sim.speedOf(heavy).toFixed(1)} м/с`);
            this._setRow(10, "Шлях набагато довший за зміщення — це і є випадкове блукання.");
        } else if (this._mode === "maxwell") {
            this._setRow(9, "Стовпчики — виміряний розподіл, помаранчеві риски — формула Максвелла.");
            this._setRow(10, "Клавіша E: почати з однакових швидкостей і дивитись, як розподіл виникає сам.");
        } else {
            this._setRow(9, "Виміряний тиск трохи вищий за NkT/V: молекули намальовані");
            this._setRow(10, "великими, їхній власний об'єм помітний — це поправка Ван-дер-Ваальса.");
        }
    }

    // ── UI ──────────────────────────────────────────────────────────

    private _createUI(): void {
        const canvas = createUICanvas();

        makeLabel(canvas, {
            anchor: "top-center", y: 10, width: 700, height: 30,
            text: "Молекулярно-кінетична теорія",
            fontSize: 26, align: TextAlignment.Center, valign: VerticalAlignment.Middle,
        });

        this._tabs = MODES.map((mode, i) => makeButton(canvas, {
            anchor: "top-center", x: (i - 1) * 152, y: 46, width: 148, height: 26,
            text: mode.label, fontSize: 13,
            onClick: () => this._setMode(mode.key),
        }));

        // ── readout (left) ──
        makePanel(canvas, { anchor: "top-left", x: 16, y: 88, width: 350, height: 240 });
        this._setRow = makeReadout(canvas, {
            anchor: "top-left", x: 30, y: 98, width: 326, height: 222,
            rows: 11, fontSize: 13, rowHeight: 20,
        });

        // ── controls (right) ──
        makePanel(canvas, { anchor: "top-right", x: 16, y: 88, width: 290, height: 246 });

        makeSlider(canvas, {
            anchor: "top-right", x: 30, y: 98, width: 262, height: 14,
            label: "Температура T, К", min: 50, max: 1000, value: 300, wholeNumbers: true,
            onChange: (v) => this._sim.setTargetTemperature(v),
        });

        makeSlider(canvas, {
            anchor: "top-right", x: 30, y: 142, width: 262, height: 14,
            label: "Об'єм (поршень), % від повного", min: 30, max: 100, value: 100, wholeNumbers: true,
            onChange: (v) => this._sim.setVolumeFraction(v / 100),
        });

        makeSlider(canvas, {
            anchor: "top-right", x: 30, y: 186, width: 262, height: 14,
            label: "Кількість молекул N", min: 50, max: MAX_COUNT, value: 320, wholeNumbers: true,
            onChange: (v) => { this._sim.setCount(v); this._trailPoints.length = 0; },
        });

        makeToggle(canvas, {
            anchor: "top-right", x: 30, y: 228, width: 262, height: 20,
            label: "Колір за швидкістю", value: true,
            onChange: (on) => { this._colourBySpeed = on; },
        });
        makeToggle(canvas, {
            anchor: "top-right", x: 30, y: 254, width: 262, height: 20,
            label: "Слід важкої частинки", value: true,
            onChange: (on) => { this._showTrail = on; if (!on) this._trailPoints.length = 0; },
        });

        makeButton(canvas, {
            anchor: "top-right", x: 30, y: 284, width: 126, height: 26,
            text: "Скинути", fontSize: 12,
            onClick: () => { this._sim.reset(false); this._trailPoints.length = 0; },
        });
        makeButton(canvas, {
            anchor: "top-right", x: 164, y: 284, width: 128, height: 26,
            text: "Однакові швидкості", fontSize: 12,
            onClick: () => { this._sim.reset(true); this._trailPoints.length = 0; },
        });

        // ── histogram (bottom) ──
        this._histogram = new Histogram(canvas, {
            x: 40, y: 70, width: 560, height: 170,
            bins: HISTOGRAM_BINS, maxSpeed: HISTOGRAM_MAX_SPEED,
        });
        makeLabel(canvas, {
            anchor: "bottom-left", x: 40, y: 48, width: 560, height: 18,
            text: `Швидкість, м/с   ·   0 … ${HISTOGRAM_MAX_SPEED}`,
            fontSize: 11, color: UI.textDim, wordWrap: false,
        });

        makeLabel(canvas, {
            anchor: "bottom-center", y: 16, width: 1100, height: 20,
            text: "R — перезапустити   •   E — старт з однаковими швидкостями   •   миша — обертати та наближати",
            fontSize: 12, color: UI.textDim,
            align: TextAlignment.Center, valign: VerticalAlignment.Middle,
        });
    }
}
