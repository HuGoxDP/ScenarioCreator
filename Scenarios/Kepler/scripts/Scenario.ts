// scripts/Scenario.ts  (Орбітальна механіка)
// ============================================================
// Launch a body at a chosen height and speed and watch which conic section it
// gets. All three of Kepler's laws are demonstrated rather than asserted.
//
// This is the companion to `solar-system-scenario`, which shows the result;
// this one shows why. It deliberately shares nothing with it: no planet
// textures, no tour, no skybox.
//
// The mechanics is in `helpers/Orbit.ts`, which imports nothing from the
// engine and was checked in Node first: a circular orbit closes with an energy
// drift of 2·10⁻¹³ % over ten years, six T/6 sectors come out equal to five
// decimals, and T² = a³ exactly.
// ============================================================

import {
    ScenarioBehaviour, GameObject, Color, Vector3, Quaternion, Mesh,
    AmbientLight, PointLight, MeshFilter, MeshRenderer, StandardMaterial, LineRenderer,
    Time, Input, KeyCode,
    TextAlignment, VerticalAlignment,
} from "WebEngineTS";

import { createFlatCamera, type IFlatCamera } from "./helpers/FlatCamera";
import {
    createUICanvas, makeLabel, makePanel, makeButton, makeSlider, makeToggle,
    makeReadout, UI, type SliderRow,
} from "./helpers/UIKit";
import { Painter } from "./helpers/Painter";
import { SweptArea } from "./helpers/SweptArea";
import { Plot } from "./helpers/Plot";
import {
    Orbit, PLANETS, CONIC_LABEL, circularSpeed, escapeSpeed, conicPoints, validateOrbits,
} from "./helpers/Orbit";

/** Radius of the central body, AU — big enough to be a target, small enough to orbit. */
const BODY_RADIUS = 0.09;
/** Past this the body has plainly left; the run stops. */
const FAR_LIMIT = 60;

const TRAIL_CAPACITY = 2200;

const STAR = new Color(1.0, 0.85, 0.35, 1);
const SATELLITE = new Color(0.65, 0.85, 1.0, 1);
const TRAIL = new Color(0.45, 0.70, 1.0, 1);
const PREDICTION = new Color(0.55, 0.60, 0.72, 1);
const MARKER = new Color(1.0, 0.62, 0.35, 1);
const VELOCITY = new Color(0.50, 0.95, 0.60, 1);
/** The ellipse's own construction lines: axes, centre, and the radius vector. */
const AXIS = new Color(0.30, 0.45, 1.00, 1);
const RADIUS = new Color(1.00, 0.30, 0.30, 1);

/**
 * Below this eccentricity the orbit is a circle for drawing purposes: its foci,
 * periapsis and apoapsis all collapse onto the centre, so marking them puts
 * crosses at arbitrary points and says the opposite of what they mean.
 */
const CIRCULAR_EPS = 0.01;

export default class OrbitalMechanics extends ScenarioBehaviour {
    private _camera!: IFlatCamera;
    private _painter!: Painter;
    private _sectors!: SweptArea;
    private _plot!: Plot;

    private _orbit!: Orbit;
    private _satellite!: GameObject;
    private _trail!: LineRenderer;
    private readonly _trailPoints: Vector3[] = [];

    private _height = 1;
    // 0.8 of the circular speed, so the orbit is an ellipse of e = 1 - 0.8^2 =
    // 0.36 on load. Starting circular hid the first law behind the one shape
    // that has nothing to say about it; "Кругова швидкість" is still one button.
    private _speedFactor = 0.8;
    private _angle = 0;
    private _timeScale = 1;
    private _running = false;

    private _showTrail = true;
    private _showPrediction = true;
    private _showSectors = true;
    private _showVelocity = true;

    private _sectorClock = 0;
    private _setRow!: (row: number, text: string) => void;
    private _speedRow!: SliderRow;

    override async awake(): Promise<void> {
        for (const problem of validateOrbits()) console.warn(`[orbit] ${problem}`);

        this._camera = createFlatCamera({
            size: 2.6, minSize: 0.4, maxSize: 40,
            background: new Color(0.02, 0.03, 0.06, 1),
        });

        const ambient = new GameObject("Ambient").addComponent(AmbientLight);
        ambient.intensity = 0.35;
        ambient.color = new Color(0.6, 0.65, 0.8, 1);

        this._createBodies();
        this._painter = new Painter(new GameObject("Diagram"));
        this._sectors = new SweptArea(new GameObject("Swept sectors"));
        this._orbit = new Orbit(BODY_RADIUS, FAR_LIMIT);

        this._createUI();
        this._relaunch();
    }

    override update(): void {
        this._camera.update();

        if (Input.getKeyDown(KeyCode.Space)) this._running = !this._running;
        if (Input.getKeyDown(KeyCode.KeyR)) this._relaunch();

        if (this._running && this._orbit.stopped === "none") {
            const elements = this._orbit.elements;
            const dt = Math.min(Time.deltaTime, 0.05) * this._timeScale * 0.35;
            this._orbit.step(dt);

            this._pushTrail();
            if (this._showSectors && Number.isFinite(elements.period)) {
                this._sectors.sample(this._orbit.x, this._orbit.y);
                this._sectorClock += dt;
                // Twelve equal slices of one period: equal times, by construction.
                if (this._sectorClock >= elements.period / 12) {
                    this._sectors.close();
                    this._sectorClock = 0;
                }
            }
        }

        this._draw();
        this._refreshReadout();
    }

    // ── scene ───────────────────────────────────────────────────────

    private _createBodies(): void {
        const starGo = new GameObject("Star");
        starGo.transform.localScale = new Vector3(BODY_RADIUS * 2, BODY_RADIUS * 2, BODY_RADIUS * 2);
        starGo.addComponent(MeshFilter).sharedMesh = Mesh.createSphere(1, 20);
        const starMaterial = new StandardMaterial();
        starMaterial.albedoColor = STAR;
        starMaterial.emissionColor = new Color(0.95, 0.72, 0.25, 1);
        starGo.addComponent(MeshRenderer).sharedMaterial = starMaterial;

        const lightGo = new GameObject("Star light");
        const light = lightGo.addComponent(PointLight);
        light.intensity = 2.2;
        light.color = STAR;

        this._satellite = new GameObject("Satellite");
        this._satellite.transform.localScale = new Vector3(0.045, 0.045, 0.045);
        this._satellite.addComponent(MeshFilter).sharedMesh = Mesh.createSphere(1, 14);
        const satelliteMaterial = new StandardMaterial();
        satelliteMaterial.albedoColor = SATELLITE;
        satelliteMaterial.emissionColor = new Color(0.20, 0.35, 0.55, 1);
        this._satellite.addComponent(MeshRenderer).sharedMaterial = satelliteMaterial;

        const trailGo = new GameObject("Trail");
        this._trail = trailGo.addComponent(LineRenderer);
        this._trail.useWorldSpace = true;
        this._trail.startWidth = 0.012;
        this._trail.endWidth = 0.012;
        this._trail.startColor = TRAIL;
        this._trail.endColor = TRAIL;
        trailGo.setActive(false);
    }

    private _pushTrail(): void {
        const at = new Vector3(this._orbit.x, this._orbit.y, 0);
        const last = this._trailPoints[this._trailPoints.length - 1];
        if (last && Vector3.distance(last, at) < 0.004) return;

        this._trailPoints.push(at);
        // Fixed capacity: an unbounded trail is a memory leak with a nice
        // appearance.
        if (this._trailPoints.length > TRAIL_CAPACITY) this._trailPoints.shift();
    }

    private _relaunch(): void {
        const radius = this._height;
        this._orbit.launch(radius, circularSpeed(radius) * this._speedFactor, this._angle);
        this._trailPoints.length = 0;
        this._sectors.clear();
        this._sectorClock = 0;
        this._running = true;

        const elements = this._orbit.elements;
        const span = Number.isFinite(elements.apoapsis)
            ? elements.apoapsis * 1.25
            : radius * 4;
        this._camera.frame(span);
    }

    // ── drawing ─────────────────────────────────────────────────────

    private _draw(): void {
        const elements = this._orbit.elements;

        this._satellite.transform.position = new Vector3(this._orbit.x, this._orbit.y, 0);
        this._trail.gameObject.setActive(this._showTrail && this._trailPoints.length > 1);
        if (this._showTrail && this._trailPoints.length > 1) this._trail.setPositions(this._trailPoints);

        this._painter.begin();

        if (this._showPrediction && elements.conic === "ellipse") {
            const points = conicPoints(elements, 140).map((p) => [p[0], p[1]]);
            this._painter.polyline(points, PREDICTION, 0.008);

            const [ux, uy] = elements.periapsisDirection;
            const a = elements.semiMajor;
            const c = a * elements.eccentricity;
            const peri = elements.periapsis;
            const apo = elements.apoapsis;

            // The star's focus is marked whatever the shape; it is where the body
            // is actually attracted from.
            this._cross(0, 0, 0.035, MARKER);

            if (elements.eccentricity > CIRCULAR_EPS) {
                // The construction that makes the first law readable: the two
                // axes, the centre they cross at, and the star sitting on a focus
                // *beside* that centre rather than on it.
                const cx = -c * ux, cy = -c * uy;
                const b = a * Math.sqrt(Math.max(0, 1 - elements.eccentricity ** 2));
                // Perpendicular to the major axis, so the minor axis is drawn from
                // the centre outwards rather than from the focus.
                const px = -uy, py = ux;

                this._painter.line(peri * ux, peri * uy, -apo * ux, -apo * uy, AXIS, 0.011);
                this._painter.line(cx - b * px, cy - b * py, cx + b * px, cy + b * py, AXIS, 0.011);

                this._cross(cx, cy, 0.030, AXIS);
                this._cross(-2 * c * ux, -2 * c * uy, 0.035, PREDICTION);
                this._cross(peri * ux, peri * uy, 0.028, MARKER);
                this._cross(-apo * ux, -apo * uy, 0.028, MARKER);
            }
        }

        // Star → body, drawn whatever else is switched on: it is a property of
        // where the body is now, not of the predicted path, and it is the line
        // that carries the second law — this length, times the speed, is what
        // sweeps equal areas in equal times.
        this._painter.line(0, 0, this._orbit.x, this._orbit.y, RADIUS, 0.010);

        if (this._showVelocity && this._orbit.stopped === "none") {
            // Length in the same scale as the orbit, so the speed change
            // between periapsis and apoapsis is visible as a length.
            const scale = 0.06;
            this._painter.line(
                this._orbit.x, this._orbit.y,
                this._orbit.x + this._orbit.vx * scale, this._orbit.y + this._orbit.vy * scale,
                VELOCITY, 0.012,
            );
        }

        this._painter.end();
        this._plot.update(elements.semiMajor, elements.period);
    }

    private _cross(x: number, y: number, size: number, color: Color): void {
        this._painter.line(x - size, y, x + size, y, color, 0.01);
        this._painter.line(x, y - size, x, y + size, color, 0.01);
    }

    // ── readout ─────────────────────────────────────────────────────

    private _refreshReadout(): void {
        const e = this._orbit.elements;
        const vCircular = circularSpeed(this._height);
        const vEscape = escapeSpeed(this._height);

        this._setRow(0, this._orbit.stopped === "impact"
            ? "Падіння на поверхню зорі."
            : this._orbit.stopped === "escaped"
                ? "Тіло пішло назавжди."
                : CONIC_LABEL[e.conic]);

        this._setRow(1, `ε = v²/2 − GM/r = ${e.energy.toFixed(3)} `
            + `(${e.energy < 0 ? "від'ємна — орбіта замкнена" : e.energy > 0 ? "додатна — тіло вирветься" : "нуль — рівно друга космічна"})`);
        this._setRow(2, `L = ${e.angularMomentum.toFixed(4)} а.о.²/рік      dA/dt = L/2 = ${e.areaRate.toFixed(4)}`);
        this._setRow(3, "");
        this._setRow(4, `r = ${e.radius.toFixed(3)} а.о.      v = ${e.speed.toFixed(3)} а.о./рік`);
        this._setRow(5, `v_кругова = ${vCircular.toFixed(3)}      v_втечі = ${vEscape.toFixed(3)}`);
        this._setRow(6, Number.isFinite(e.semiMajor) && e.semiMajor > 0
            ? `a = ${e.semiMajor.toFixed(3)} а.о.      e = ${e.eccentricity.toFixed(4)}`
            : `e = ${e.eccentricity.toFixed(4)} — орбіта не замкнена`);
        this._setRow(7, Number.isFinite(e.period)
            ? `T = ${e.period.toFixed(3)} року = ${(e.period * 365.25).toFixed(0)} діб`
            : "T — орбіта не замкнена");
        this._setRow(8, Number.isFinite(e.apoapsis)
            ? `перигелій ${e.periapsis.toFixed(3)}      афелій ${e.apoapsis.toFixed(3)} а.о.`
            : `перигелій ${e.periapsis.toFixed(3)} а.о.`);
        this._setRow(9, `Минуло: ${this._orbit.time.toFixed(2)} року`);

        const areas = this._sectors.areas;
        if (areas.length >= 2) {
            const min = Math.min(...areas);
            const max = Math.max(...areas);
            const spread = ((max - min) / ((min + max) / 2)) * 100;
            this._setRow(10, `Заметені сектори (${areas.length}): від ${min.toFixed(4)} до ${max.toFixed(4)} а.о.²`);
            this._setRow(11, `Розкид ${spread.toFixed(2)} % — це і є другий закон Кеплера.`);
        } else {
            this._setRow(10, "Сектори за рівні проміжки часу з'являтимуться під час руху.");
            this._setRow(11, Number.isFinite(e.period) ? `T² = ${(e.period ** 2).toFixed(4)}   a³ = ${(e.semiMajor ** 3).toFixed(4)}` : "");
        }
    }

    // ── UI ──────────────────────────────────────────────────────────

    private _createUI(): void {
        const canvas = createUICanvas();

        makeLabel(canvas, {
            anchor: "top-center", y: 10, width: 700, height: 30,
            text: "Орбітальна механіка",
            fontSize: 26, align: TextAlignment.Center, valign: VerticalAlignment.Middle,
        });

        // ── readout (left) ──
        makePanel(canvas, { anchor: "top-left", x: 16, y: 52, width: 400, height: 262 });
        this._setRow = makeReadout(canvas, {
            anchor: "top-left", x: 28, y: 62, width: 378, height: 244,
            rows: 12, fontSize: 12, rowHeight: 20,
        });

        // ── controls (right) ──
        makePanel(canvas, { anchor: "top-right", x: 16, y: 52, width: 292, height: 300 });

        makeSlider(canvas, {
            anchor: "top-right", x: 30, y: 62, width: 264, height: 14,
            label: "Початкова відстань r, а.о.", min: 0.3, max: 5, value: 1,
            format: (v) => v.toFixed(2),
            onChange: (v) => { this._height = v; this._relaunch(); },
        });

        this._speedRow = makeSlider(canvas, {
            anchor: "top-right", x: 30, y: 106, width: 264, height: 14,
            // The formatter appends "кругова"/"втечі" at the two thresholds, so
            // this row needs more room for its value than a bare number takes.
            valueWidth: 116,
            label: "Швидкість, × кругової", min: 0.2, max: 1.6, value: 0.8,
            // 1.000 is circular and √2 ≈ 1.414 is escape — the two thresholds
            // are places on the control the student is already holding.
            format: (v) => `${v.toFixed(3)}×` + (Math.abs(v - 1) < 0.004 ? "  кругова" : Math.abs(v - Math.SQRT2) < 0.004 ? "  втечі" : ""),
            onChange: (v) => { this._speedFactor = v; this._relaunch(); },
        });

        makeSlider(canvas, {
            anchor: "top-right", x: 30, y: 150, width: 264, height: 14,
            label: "Кут запуску, градуси", min: 0, max: 80, value: 0, wholeNumbers: true,
            onChange: (v) => { this._angle = v; this._relaunch(); },
        });

        makeSlider(canvas, {
            anchor: "top-right", x: 30, y: 194, width: 264, height: 14,
            label: "Швидкість часу", min: 0.1, max: 8, value: 1,
            format: (v) => `${v.toFixed(1)}×`,
            onChange: (v) => { this._timeScale = v; },
        });

        makeButton(canvas, {
            anchor: "top-right", x: 30, y: 234, width: 126, height: 24,
            text: "Кругова швидкість", fontSize: 11,
            onClick: () => { this._speedFactor = 1; this._speedRow.set(1); this._relaunch(); },
        });
        makeButton(canvas, {
            anchor: "top-right", x: 164, y: 234, width: 130, height: 24,
            text: "Друга космічна", fontSize: 11,
            onClick: () => { this._speedFactor = Math.SQRT2; this._speedRow.set(Math.SQRT2); this._relaunch(); },
        });

        makeToggle(canvas, {
            anchor: "top-right", x: 30, y: 264, width: 130, height: 20,
            label: "Слід", value: true,
            onChange: (on) => { this._showTrail = on; },
        });
        makeToggle(canvas, {
            anchor: "top-right", x: 168, y: 264, width: 130, height: 20,
            label: "Прогноз орбіти", value: true,
            onChange: (on) => { this._showPrediction = on; },
        });
        // The row's two labels are the shortest and the longest of the four, so
        // they do not split their 264 evenly: an even split clips "швидкості".
        makeToggle(canvas, {
            anchor: "top-right", x: 30, y: 290, width: 112, height: 20,
            label: "Сектори", value: true,
            onChange: (on) => { this._showSectors = on; if (!on) this._sectors.clear(); },
        });
        makeToggle(canvas, {
            anchor: "top-right", x: 150, y: 290, width: 148, height: 20,
            label: "Вектор швидкості", value: true,
            onChange: (on) => { this._showVelocity = on; },
        });

        makeButton(canvas, {
            anchor: "top-right", x: 30, y: 318, width: 264, height: 24,
            text: "Запустити заново", fontSize: 12,
            onClick: () => this._relaunch(),
        });

        // ── Kepler 3 plot (bottom-left) ──
        makePanel(canvas, { anchor: "bottom-left", x: 16, y: 46, width: 230, height: 224 });
        makeLabel(canvas, {
            anchor: "bottom-left", x: 28, y: 244, width: 210, height: 18,
            text: "Третій закон: T² проти a³", fontSize: 12, color: UI.textDim, wordWrap: false,
        });
        // Between the caption's top edge (82) and the title's bottom (244), centred
        // in the 230-wide panel that starts 16 from the left.
        this._plot = new Plot(canvas, { x: 56, y: 90, size: 148 }, PLANETS);
        makeLabel(canvas, {
            anchor: "bottom-left", x: 28, y: 52, width: 216, height: 30,
            text: "Вісім планет — сірі. Ваше тіло — помаранчеве. Усі на одній прямій.",
            fontSize: 10, color: UI.textDim,
        });

        makeLabel(canvas, {
            anchor: "bottom-center", y: 16, width: 1100, height: 20,
            text: "Пробіл — пауза   •   R — запустити заново   •   колесо — масштаб   •   перетягування — панорама",
            fontSize: 12, color: UI.textDim,
            align: TextAlignment.Center, valign: VerticalAlignment.Middle,
        });
    }
}
