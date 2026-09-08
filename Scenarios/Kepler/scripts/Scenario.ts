// scripts/Scenario.ts  (Орбітальна механіка)
// ============================================================
// Launch a body at a chosen height and speed and watch which conic section it
// gets. All three of Kepler's laws are demonstrated rather than asserted.
//
// This is the companion to `solar-system-scenario`, which shows the result;
// this one shows why. It borrows that scenario's starfield and its Sun and
// Earth maps, so the two read as the same sky; it does not borrow the tour,
// the planet set or any of its behaviour. It used to share nothing at all,
// which left a diagram of flat discs on flat blue.
//
// The mechanics is in `helpers/Orbit.ts`, which imports nothing from the
// engine and was checked in Node first: a circular orbit closes with an energy
// drift of 2·10⁻¹³ % over ten years, six T/6 sectors come out equal to five
// decimals, and T² = a³ exactly.
// ============================================================

import {
    ScenarioBehaviour, GameObject, Color, Vector3, Quaternion, Mesh,
    AmbientLight, PointLight, MeshFilter, MeshRenderer, StandardMaterial, LineRenderer,
    Time, Input, KeyCode, Vector2, RectTransform, UIText,
    Resources, Texture2D,
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
/** Radius of the orbiting body. Small enough to read as a point on the diagram. */
const SATELLITE_RADIUS = 0.028;
/** How far behind the working plane the starfield sits. Orthographic, so
    distance costs nothing in size — only in draw order. */
const BACKDROP_DISTANCE = 40;
/** Past this the body has plainly left; the run stops. */
const FAR_LIMIT = 60;

const TRAIL_CAPACITY = 2200;

const STAR = new Color(1.0, 0.85, 0.35, 1);
const SATELLITE = new Color(0.65, 0.85, 1.0, 1);
const TRAIL = new Color(0.45, 0.70, 1.0, 1);
/** Green, so it is not mistaken for `r1`, which is the yellow line to the star. */
const VELOCITY = new Color(0.20, 0.72, 0.35, 1);

// The ellipse and its construction, following the reference diagram: a pale
// outline, `r1` from the star to the body in yellow, `r2` on to the empty focus
// in violet, and one semi-major axis in red — the length the legend calls `a`.
// The centre and the empty focus are dots, not crosses.
//
// Written darker than they look. A line's colour reaches the GPU as a vertex
// attribute, which is linear, and is brightened again on the way to an sRGB
// framebuffer; the values that read as vivid on screen are the ones that look
// nearly black here. These are `#7ec8de`, `#f0d878`, `#6a6ad0`, `#ee3333`,
// `#ff8c42` and `#ff7fbf` converted.
const ORBIT = new Color(0.207, 0.577, 0.732, 1);
const R1 = new Color(0.870, 0.691, 0.185, 1);
const R2 = new Color(0.145, 0.145, 0.630, 1);
const SEMI_MAJOR = new Color(0.854, 0.033, 0.033, 1);
const CENTRE_DOT = new Color(1.000, 0.263, 0.053, 1);
const FOCUS_DOT = new Color(1.000, 0.213, 0.523, 1);

/** The same hues as the UI draws them: 2D text needs no linear conversion. */
const UI_R1 = new Color(0.941, 0.847, 0.471, 1);
const UI_R2 = new Color(0.561, 0.561, 0.910, 1);
const UI_SUM = new Color(0.933, 0.200, 0.200, 1);

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
    private _backdrop: GameObject | null = null;
    private _trail!: LineRenderer;
    private readonly _trailPoints: Vector3[] = [];

    private _height = 1;
    // 0.7 of the circular speed, so the orbit is an ellipse of e = 1 - 0.7^2 =
    // 0.51 on load. Starting circular hid the first law behind the one shape
    // that has nothing to say about it, and a nearly round ellipse puts the
    // two foci almost on top of each other, which hides the construction.
    // "Кругова швидкість" is still one button away.
    private _speedFactor = 0.7;
    private _angle = 0;
    private _timeScale = 1;
    private _running = false;

    // Off by default: on a closed orbit the trail retraces the predicted
    // ellipse exactly and, being drawn after it, simply hides it.
    private _showTrail = false;
    private _showPrediction = true;
    private _showSectors = true;
    private _showVelocity = true;

    /** The `a` beside the semi-major segment; followed to it every frame. */
    private _aLabel!: UIText;
    private _aRect!: RectTransform;

    /**
     * Set once `awake` has finished building the scene.
     *
     * `update` runs while an async `awake` is still awaiting, and loading the
     * textures made that a real window: `_draw` reached `this._orbit.elements`
     * on an orbit that did not exist yet, once a frame until the load returned.
     */
    private _ready = false;

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

        await this._createBackdrop();
        await this._createBodies();
        this._painter = new Painter(new GameObject("Diagram"));
        this._sectors = new SweptArea(new GameObject("Swept sectors"));
        this._orbit = new Orbit(BODY_RADIUS, FAR_LIMIT);

        this._createUI();
        this._relaunch();
        this._ready = true;
    }

    override update(): void {
        if (!this._ready) return;

        this._camera.update();
        this._fitBackdrop();

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

    private async _createBodies(): Promise<void> {
        const sunTexture = await Resources.tryLoad(Texture2D, "textures/sun");
        const earthTexture = await Resources.tryLoad(Texture2D, "textures/earth");
        // `tryLoad` answers null rather than throwing, so a missing map would
        // otherwise show up only as a body that is quietly the wrong colour.
        if (!sunTexture) console.warn("[Kepler] textures/sun missing — star drawn flat");
        if (!earthTexture) console.warn("[Kepler] textures/earth missing — body drawn flat");

        const starGo = new GameObject("Star");
        // `createSphere(1, …)` has radius 1, so the scale *is* the radius. It was
        // set to twice BODY_RADIUS, which drew the star at twice the size the
        // orbit integrator treats it as — the single biggest reason the diagram
        // read as oversized.
        starGo.transform.localScale = new Vector3(BODY_RADIUS, BODY_RADIUS, BODY_RADIUS);
        starGo.addComponent(MeshFilter).sharedMesh = Mesh.createSphere(1, 32);
        const starMaterial = new StandardMaterial();
        starMaterial.albedoColor = sunTexture ? Color.white : STAR;
        if (sunTexture) starMaterial.albedoTexture = sunTexture;
        // Emissive as well as lit: a star is its own light source, and without
        // this its far side is a black crescent.
        starMaterial.emissionColor = new Color(0.95, 0.72, 0.25, 1);
        if (sunTexture) starMaterial.emissionTexture = sunTexture;
        starGo.addComponent(MeshRenderer).sharedMaterial = starMaterial;

        const lightGo = new GameObject("Star light");
        const light = lightGo.addComponent(PointLight);
        light.intensity = 2.2;
        light.color = STAR;

        this._satellite = new GameObject("Satellite");
        this._satellite.transform.localScale = new Vector3(SATELLITE_RADIUS, SATELLITE_RADIUS, SATELLITE_RADIUS);
        this._satellite.addComponent(MeshFilter).sharedMesh = Mesh.createSphere(1, 24);
        const satelliteMaterial = new StandardMaterial();
        satelliteMaterial.albedoColor = earthTexture ? Color.white : SATELLITE;
        if (earthTexture) satelliteMaterial.albedoTexture = earthTexture;
        satelliteMaterial.emissionColor = new Color(0.10, 0.16, 0.26, 1);
        this._satellite.addComponent(MeshRenderer).sharedMaterial = satelliteMaterial;

        const trailGo = new GameObject("Trail");
        this._trail = trailGo.addComponent(LineRenderer);
        this._trail.useWorldSpace = true;
        this._trail.startWidth = 0.006;
        this._trail.endWidth = 0.006;
        this._trail.startColor = TRAIL;
        this._trail.endColor = TRAIL;
        trailGo.setActive(false);
    }

    /**
     * The starfield behind the diagram, sharing `solar-system-scenario`'s
     * panorama.
     *
     * A quad rather than `RenderSettings.skybox`, which does not work here:
     * three.js draws a scene background as a unit box through the camera's
     * projection, and a unit box under an *orthographic* projection is a small
     * square in the middle of the screen rather than a sky. Measured — it came
     * out 360px across on a 1600px view.
     */
    private async _createBackdrop(): Promise<void> {
        const sky = await Resources.tryLoad(Texture2D, "skybox/stars_panorama");
        if (!sky) return;

        this._backdrop = new GameObject("Starfield");
        this._backdrop.addComponent(MeshFilter).sharedMesh = Mesh.createPlane(1, 1);
        const material = new StandardMaterial();
        // Unlit: the only light is the star, and a backdrop lit by it would be a
        // pool of light in the middle and black at the corners.
        material.albedoColor = Color.black;
        material.emissionColor = new Color(0.55, 0.55, 0.55, 1);
        material.emissionTexture = sky;
        this._backdrop.addComponent(MeshRenderer).sharedMaterial = material;

        // createPlane lies in XZ facing +Y, Unity's floor; -90° about X stands it
        // up in XY facing -Z, which is where this camera watches from.
        this._backdrop.transform.localRotation = Quaternion.euler(-90, 0, 0);
    }

    /**
     * Keeps the backdrop exactly filling the view.
     *
     * Sized from the camera every frame rather than made big once: a fixed quad
     * would show a different crop of the sky at every zoom, and at the default
     * one that crop is about a hundredth of the image — stars the size of the
     * planet. Locked to the camera it behaves as a sky should, holding still
     * while the diagram is panned and zoomed.
     */
    private _fitBackdrop(): void {
        if (!this._backdrop) return;

        const camera = this._camera.camera;
        const halfHeight = camera.orthographicSize;
        const at = camera.transform.position;

        this._backdrop.transform.position = new Vector3(at.x, at.y, at.z + BACKDROP_DISTANCE);
        this._backdrop.transform.localScale = new Vector3(
            halfHeight * camera.aspect * 2, 1, halfHeight * 2,
        );
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

        this._aLabel.gameObject.setActive(false);

        if (this._showPrediction && elements.conic === "ellipse") {
            const points = conicPoints(elements, 160).map((p) => [p[0], p[1]]);
            this._painter.polyline(points, ORBIT, 0.005);

            const [ux, uy] = elements.periapsisDirection;
            const a = elements.semiMajor;
            const c = a * elements.eccentricity;

            if (elements.eccentricity > CIRCULAR_EPS) {
                const cx = -c * ux, cy = -c * uy;
                const fx = -2 * c * ux, fy = -2 * c * uy;

                // r2: on from the body to the empty focus. With r1 below it this
                // is the string construction — the two lengths always sum to 2a,
                // which is what makes the curve an ellipse and not merely an oval.
                this._painter.line(this._orbit.x, this._orbit.y, fx, fy, R2, 0.007);

                // One semi-major axis, centre to the far vertex: the length the
                // legend calls `a`. Away from the star, as the reference draws it.
                const ax = cx - a * ux, ay = cy - a * uy;
                this._painter.line(cx, cy, ax, ay, SEMI_MAJOR, 0.009);
                this._placeALabel((cx + ax) / 2, (cy + ay) / 2);

                // Last, so they sit on top of the lines that meet at them.
                this._painter.dot(cx, cy, 0.016, CENTRE_DOT);
                this._painter.dot(fx, fy, 0.016, FOCUS_DOT);
            }
        }

        // r1: star → body, drawn whatever else is switched on. It is a property
        // of where the body is now rather than of the predicted path, and it is
        // the line the second law is about — this length, times the speed, is
        // what sweeps equal areas in equal times.
        this._painter.line(0, 0, this._orbit.x, this._orbit.y, R1, 0.007);

        if (this._showVelocity && this._orbit.stopped === "none") {
            // Length in the same scale as the orbit, so the speed change
            // between periapsis and apoapsis is visible as a length.
            const scale = 0.06;
            this._painter.line(
                this._orbit.x, this._orbit.y,
                this._orbit.x + this._orbit.vx * scale, this._orbit.y + this._orbit.vy * scale,
                VELOCITY, 0.007,
            );
        }

        this._painter.end();
        this._plot.update(elements.semiMajor, elements.period);
    }

    /**
     * Puts the `a` label beside the midpoint of the semi-major segment, in
     * screen space.
     *
     * The diagram's other text lives in the UI layer, which is 2D and has no way
     * to follow a point in the scene; projecting through the camera each frame is
     * what keeps the label on its line while the view is panned and zoomed.
     */
    private _placeALabel(x: number, y: number): void {
        const at = this._camera.camera.worldToScreenPoint(new Vector3(x, y, 0));
        if (at.z <= 0) return;

        this._aLabel.gameObject.setActive(true);
        // Y is down in both the screen conversion and the canvas, so lifting the
        // label clear of the line means subtracting. It has to clear the empty
        // focus as well: near e = 0.5 that focus sits almost exactly on this
        // midpoint, since c = a·e is then about a/2.
        this._aRect.anchoredPosition = new Vector2(at.x, at.y - 26);
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
            label: "Швидкість, × кругової", min: 0.2, max: 1.6, value: 0.7,
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
            label: "Слід", value: false,
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

        // The legend, in the colours the three lines are drawn in, so no key is
        // needed to tell which is which.
        makeLabel(canvas, {
            anchor: "bottom-right", x: 28, y: 118, width: 300, height: 22,
            text: "r₁ — від зорі до тіла", fontSize: 15, color: UI_R1,
            align: TextAlignment.Right, wordWrap: false,
        });
        makeLabel(canvas, {
            anchor: "bottom-right", x: 28, y: 94, width: 300, height: 22,
            text: "r₂ — від тіла до порожнього фокуса", fontSize: 15, color: UI_R2,
            align: TextAlignment.Right, wordWrap: false,
        });
        makeLabel(canvas, {
            anchor: "bottom-right", x: 28, y: 66, width: 300, height: 24,
            text: "r₁ + r₂ = 2a", fontSize: 18, color: UI_SUM,
            align: TextAlignment.Right, wordWrap: false,
        });

        // Follows the semi-major segment through the camera every frame; pivoted
        // at its centre so the projected point lands in the middle of the glyph.
        this._aLabel = makeLabel(canvas, {
            anchor: "top-left", x: 0, y: 0, width: 40, height: 22,
            text: "a", fontSize: 18, color: UI_SUM, wordWrap: false,
            align: TextAlignment.Center, valign: VerticalAlignment.Middle,
        });
        this._aRect = this._aLabel.gameObject.getComponent(RectTransform)!;
        this._aRect.pivot = new Vector2(0.5, 0.5);
        this._aLabel.gameObject.setActive(false);
    }
}
