// scripts/Scenario.ts  (Механіка: похила площина)
// ============================================================
// A block on a ramp, with its free-body diagram drawn and every number on
// screen in SI. One world unit is one metre.
//
// Three demonstrations, in the order they are worth doing:
//   1. The block does not move until tan α > μ — and moves the instant it does.
//   2. Mass does not matter. Two blocks differing tenfold arrive together,
//      while the force arrows on them differ tenfold.
//   3. μ = 0, α = 30° on Earth gives a = g/2 = 4.905 м/с², and the Moon gives
//      0.81.
//
// The motion comes from `helpers/Slide.ts`, which integrates the equation of
// motion rather than asking the rigid-body solver — see that file's header for
// the engine limitation that forces it, and `docs/TASK-mechanics-incline.md`
// for the write-up.
// ============================================================

import {
    ScenarioBehaviour, GameObject, Color, Vector3,
    DirectionalLight, AmbientLight, Quaternion, Time,
    Input, KeyCode,
    TextAlignment, VerticalAlignment,
} from "WebEngineTS";

import { createCameraRig, type ICameraRig } from "./helpers/CameraSetup";
import {
    createUICanvas, makeLabel, makePanel, makeButton, makeSlider, makeToggle, makeDropdown,
    makeReadout, UI,
} from "./helpers/UIKit";
import { createBench, createBlock, VectorArrow, type Bench, type Block } from "./helpers/Ramp";
import { Slide, forcesOn, slides, PHASE_LABEL } from "./helpers/Slide";

const SLOPE_LENGTH = 10;
const GROUND_LENGTH = 12;

/** The heavy block is this many times the light one. */
const HEAVY_FACTOR = 10;

/**
 * Arrows are scaled so that mg is always the same length on screen.
 *
 * A fixed newtons-per-metre scale cannot serve both a 0.5 kg block on the Moon
 * (0.8 Н) and a 10 kg block on Jupiter (248 Н) — one of them is invisible and
 * the other runs off the bench. Normalising on the weight keeps every arrow
 * legible and keeps the *ratios* between them true, which is what a free-body
 * diagram is read for. The newtons themselves are on the panel.
 */
const WEIGHT_ARROW_LENGTH = 2.2;

const PLANETS = [
    { label: "Земля — 9.81 м/с²", g: 9.81 },
    { label: "Місяць — 1.62 м/с²", g: 1.62 },
    { label: "Марс — 3.71 м/с²", g: 3.71 },
    { label: "Юпітер — 24.79 м/с²", g: 24.79 },
];

const WEIGHT_COLOR = new Color(0.92, 0.36, 0.34, 1);
const NORMAL_COLOR = new Color(0.42, 0.68, 1.00, 1);
const FRICTION_COLOR = new Color(1.00, 0.70, 0.28, 1);
const NET_COLOR = new Color(0.45, 0.90, 0.55, 1);

export default class InclinedPlane extends ScenarioBehaviour {
    private _camera!: ICameraRig;
    private _bench!: Bench;
    private _light!: Block;
    private _heavy!: Block;

    private _primary!: Slide;
    private _secondary!: Slide;

    private _weightArrow!: VectorArrow;
    private _normalArrow!: VectorArrow;
    private _frictionArrow!: VectorArrow;
    private _netArrow!: VectorArrow;

    private _angle = 30;
    private _mass = 2;
    private _mu = 0.2;
    private _gravity = 9.81;
    private _showVectors = true;
    private _showTrail = true;
    private _twoBodies = false;

    private _setRow!: (row: number, text: string) => void;

    override async awake(): Promise<void> {
        this._camera = createCameraRig({
            useSkybox: false,
            orbitDistance: 22,
            orbitMaxDistance: 70,
            backgroundColor: new Color(0.06, 0.07, 0.10, 1),
        });

        this._createLights();

        this._bench = createBench(SLOPE_LENGTH, GROUND_LENGTH);
        // The bench is built from the ramp's foot at the origin; shift it so the
        // whole run sits around the camera's orbit centre.
        this._bench.root.transform.position = new Vector3(-1.5, -2.4, 0);

        this._light = createBlock(this._bench.root, new Color(0.90, 0.86, 0.78, 1));
        this._heavy = createBlock(this._bench.root, new Color(0.72, 0.78, 0.92, 1));

        this._weightArrow = new VectorArrow(this._bench.root, "mg", WEIGHT_COLOR);
        this._normalArrow = new VectorArrow(this._bench.root, "N", NORMAL_COLOR);
        this._frictionArrow = new VectorArrow(this._bench.root, "Ffr", FRICTION_COLOR);
        this._netArrow = new VectorArrow(this._bench.root, "Fnet", NET_COLOR);

        const config = this._config();
        this._primary = new Slide(config);
        this._secondary = new Slide(config);

        this._createUI();
        this._reconfigure();
    }

    override fixedUpdate(): void {
        const dt = Time.fixedDeltaTime;
        this._primary.step(dt);
        this._secondary.step(dt);
    }

    override update(): void {
        if (Input.getKeyDown(KeyCode.Space)) this._toggleRun();
        if (Input.getKeyDown(KeyCode.KeyR)) this._reconfigure();

        this._light.place(this._bench, this._primary.distance, this._twoBodies ? -0.75 : 0);
        this._heavy.place(this._bench, this._secondary.distance, 0.75);
        this._heavy.setVisible(this._twoBodies);

        if (this._showTrail && this._primary.moving) this._light.trail(this._light.centre, false);

        this._drawVectors();
        this._refreshReadout();
    }

    // ── scene ───────────────────────────────────────────────────────

    private _createLights(): void {
        const keyGo = new GameObject("Key Light");
        const key = keyGo.addComponent(DirectionalLight);
        key.intensity = 1.35;
        key.color = new Color(1, 0.98, 0.93, 1);
        keyGo.transform.rotation = Quaternion.euler(42, -35, 0);

        const rimGo = new GameObject("Rim Light");
        const rim = rimGo.addComponent(DirectionalLight);
        rim.intensity = 0.45;
        rim.color = new Color(0.55, 0.72, 1, 1);
        rimGo.transform.rotation = Quaternion.euler(-18, 140, 0);

        const ambGo = new GameObject("Ambient");
        const amb = ambGo.addComponent(AmbientLight);
        amb.intensity = 0.42;
        amb.color = new Color(0.52, 0.58, 0.70, 1);
    }

    private _config() {
        return {
            gravity: this._gravity,
            angleDeg: this._angle,
            mu: this._mu,
            slopeLength: SLOPE_LENGTH,
            groundLength: GROUND_LENGTH,
        };
    }

    /**
     * Applies the current settings and resets the run.
     *
     * Changing the angle, mass, friction or gravity mid-run and quietly
     * continuing is how a student ends up measuring one configuration and
     * reading another.
     */
    private _reconfigure(): void {
        const config = this._config();
        this._primary.configure(config);
        this._secondary.configure(config);

        this._bench.setAngle(this._angle);
        this._light.setSize(sizeFor(this._mass));
        this._heavy.setSize(sizeFor(this._mass * HEAVY_FACTOR));
        this._light.trail(Vector3.zero, true);
        this._heavy.trail(Vector3.zero, true);
    }

    private _toggleRun(): void {
        if (this._primary.moving) {
            this._primary.pause();
            this._secondary.pause();
        } else {
            this._primary.start();
            this._secondary.start();
        }
    }

    /** The block is on the flat once it leaves the ramp; the diagram follows it. */
    private _effectiveAngle(): number {
        return this._primary.distance >= SLOPE_LENGTH ? 0 : this._angle;
    }

    private _drawVectors(): void {
        if (!this._showVectors) {
            this._weightArrow.hide();
            this._normalArrow.hide();
            this._frictionArrow.hide();
            this._netArrow.hide();
            return;
        }

        const angle = this._effectiveAngle();
        const forces = forcesOn(this._mass, this._gravity, angle, this._mu, this._primary.moving);
        const scale = WEIGHT_ARROW_LENGTH / Math.max(forces.weight, 1e-6);

        const at = this._light.centre;
        const normal = this._bench.normalAt(this._primary.distance);
        const downhill = this._bench.downhillAt(this._primary.distance);
        const uphill = new Vector3(-downhill.x, -downhill.y, -downhill.z);

        this._weightArrow.show(at, new Vector3(0, -1, 0), forces.weight * scale);
        this._normalArrow.show(at, normal, forces.normal * scale);
        this._frictionArrow.show(at, uphill, forces.friction * scale);
        this._netArrow.show(at, downhill, forces.net * scale);
    }

    // ── readout ─────────────────────────────────────────────────────

    private _refreshReadout(): void {
        const angle = this._effectiveAngle();
        const moving = this._primary.moving;
        const forces = forcesOn(this._mass, this._gravity, angle, this._mu, moving);
        const onSlope = this._primary.distance < SLOPE_LENGTH;

        const willSlide = slides(this._angle, this._mu);
        this._setRow(0, PHASE_LABEL[this._primary.phase]);
        this._setRow(1, `tg α = ${Math.tan(this._angle * Math.PI / 180).toFixed(3)}`
            + `   ${willSlide ? ">" : "≤"}   μ = ${this._mu.toFixed(2)}`);

        this._setRow(2, `mg = ${forces.weight.toFixed(2)} Н`);
        this._setRow(3, `mg·sin α = ${forces.driving.toFixed(2)} Н`);
        this._setRow(4, `N = mg·cos α = ${forces.normal.toFixed(2)} Н`);
        this._setRow(5, `F_тертя = ${forces.friction.toFixed(2)} Н`
            + `   (максимум μN = ${forces.frictionMax.toFixed(2)} Н)`);
        this._setRow(6, `F_рівнодійна = ${forces.net.toFixed(2)} Н`);

        this._setRow(7, onSlope
            ? `a = g(sin α − μ·cos α) = ${this._primary.acceleration.toFixed(3)} м/с²`
            : `a = −μg = ${this._primary.acceleration.toFixed(3)} м/с²`);

        const t = this._primary.time;
        this._setRow(8, `t = ${t.toFixed(2)} с`);

        // While the block is on the ramp the acceleration is constant, so the
        // integrated values must equal the textbook ones exactly. They are
        // printed together because that agreement is the claim.
        if (onSlope && this._primary.phase !== "rest") {
            const a = this._primary.acceleration;
            this._setRow(9, `v = ${this._primary.speed.toFixed(3)} м/с      (a·t = ${(a * t).toFixed(3)})`);
            this._setRow(10, `s = ${this._primary.distance.toFixed(3)} м      (a·t²/2 = ${(0.5 * a * t * t).toFixed(3)})`);
        } else {
            this._setRow(9, `v = ${this._primary.speed.toFixed(3)} м/с`);
            this._setRow(10, `s = ${this._primary.distance.toFixed(3)} м`);
        }

        this._setRow(11, this._twoBodies
            ? `Друге тіло: ${(this._mass * HEAVY_FACTOR).toFixed(1)} кг — сили вдесятеро більші, рух той самий.`
            : "");
    }

    // ── UI ──────────────────────────────────────────────────────────

    private _createUI(): void {
        const canvas = createUICanvas();

        makeLabel(canvas, {
            anchor: "top-center", y: 10, width: 700, height: 30,
            text: "Механіка: похила площина",
            fontSize: 26, align: TextAlignment.Center, valign: VerticalAlignment.Middle,
        });

        // ── readout (left) ──
        makePanel(canvas, { anchor: "top-left", x: 16, y: 56, width: 340, height: 262 });
        this._setRow = makeReadout(canvas, {
            anchor: "top-left", x: 30, y: 66, width: 316, height: 244,
            rows: 12, fontSize: 13, rowHeight: 20,
        });

        // ── legend (left, below) ──
        makePanel(canvas, { anchor: "top-left", x: 16, y: 328, width: 340, height: 118 });
        const legend = (y: number, color: Color, text: string): void => {
            makeLabel(canvas, {
                anchor: "top-left", x: 30, y, width: 316, height: 18,
                text, fontSize: 11, color, wordWrap: false,
            });
        };
        legend(336, WEIGHT_COLOR, "━ mg — сила тяжіння, завжди вертикальна");
        legend(354, NORMAL_COLOR, "━ N — реакція опори, перпендикулярна до площини");
        legend(372, FRICTION_COLOR, "━ F_тертя — уздовж площини, проти руху");
        legend(390, NET_COLOR, "━ F_рівнодійна — нуль, поки тіло стоїть");
        legend(412, UI.textDim, "Довжина mg однакова завжди; решта — у тому ж масштабі.");
        legend(428, UI.textDim, "Числа в ньютонах — на панелі вище.");

        // ── controls (right) ──
        makePanel(canvas, { anchor: "top-right", x: 16, y: 56, width: 290, height: 306 });

        makeSlider(canvas, {
            anchor: "top-right", x: 30, y: 66, width: 262, height: 14,
            label: "Кут нахилу α, градуси", min: 0, max: 60, value: this._angle, wholeNumbers: true,
            onChange: (v) => { this._angle = Math.round(v); this._reconfigure(); },
        });

        makeSlider(canvas, {
            anchor: "top-right", x: 30, y: 110, width: 262, height: 14,
            label: "Маса m, кг", min: 0.5, max: 10, value: this._mass,
            format: (v) => v.toFixed(1),
            onChange: (v) => { this._mass = v; this._reconfigure(); },
        });

        makeSlider(canvas, {
            anchor: "top-right", x: 30, y: 154, width: 262, height: 14,
            label: "Коефіцієнт тертя μ", min: 0, max: 1, value: this._mu,
            onChange: (v) => { this._mu = v; this._reconfigure(); },
        });

        makeDropdown(canvas, {
            anchor: "top-right", x: 30, y: 196, width: 262, height: 26,
            options: PLANETS.map((p) => p.label), value: 0, maxVisibleItems: 4,
            onChange: (index) => { this._gravity = PLANETS[index].g; this._reconfigure(); },
        });

        makeToggle(canvas, {
            anchor: "top-right", x: 30, y: 232, width: 262, height: 20,
            label: "Вектори сил", value: true,
            onChange: (on) => { this._showVectors = on; },
        });
        makeToggle(canvas, {
            anchor: "top-right", x: 30, y: 258, width: 262, height: 20,
            label: "Слід", value: true,
            onChange: (on) => {
                this._showTrail = on;
                if (!on) this._light.trail(Vector3.zero, true);
            },
        });
        makeToggle(canvas, {
            anchor: "top-right", x: 30, y: 284, width: 262, height: 20,
            label: `Два тіла (друге — ×${HEAVY_FACTOR} маси)`, value: false,
            onChange: (on) => { this._twoBodies = on; this._reconfigure(); },
        });

        makeButton(canvas, {
            anchor: "top-right", x: 30, y: 312, width: 82, height: 26,
            text: "Пуск", fontSize: 13,
            onClick: () => { this._primary.start(); this._secondary.start(); },
        });
        makeButton(canvas, {
            anchor: "top-right", x: 120, y: 312, width: 82, height: 26,
            text: "Пауза", fontSize: 13,
            onClick: () => { this._primary.pause(); this._secondary.pause(); },
        });
        makeButton(canvas, {
            anchor: "top-right", x: 210, y: 312, width: 82, height: 26,
            text: "Скинути", fontSize: 13,
            onClick: () => this._reconfigure(),
        });

        makeLabel(canvas, {
            anchor: "bottom-center", y: 18, width: 1100, height: 20,
            text: "Пробіл — пуск і пауза   •   R — скинути   •   миша — обертати та наближати",
            fontSize: 12, color: UI.textDim,
            align: TextAlignment.Center, valign: VerticalAlignment.Middle,
        });
    }
}

/** Bigger mass, bigger block — by volume, so ten times the mass is not ten times the width. */
function sizeFor(mass: number): number {
    return 0.55 * Math.cbrt(mass);
}
