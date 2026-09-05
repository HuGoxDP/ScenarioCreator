// scripts/Scenario.ts  (Будова атома)
// ============================================================
// A periodic table you click, and the selected element drawn as a nucleus with
// electron shells.
//
// The scenario exists for one distinction students reliably get wrong: an
// ISOTOPE changes the nucleus and leaves the electrons alone, an ION changes
// the electrons and leaves the nucleus alone. There is one slider for each, and
// neither is allowed to touch the other's half of the atom.
//
// Everything is procedural — no assets — and nothing is random: the nucleus
// packing and the orbital cloud are both deterministic, so the same element
// always renders the same picture.
// ============================================================

import {
    ScenarioBehaviour, GameObject, Color,
    DirectionalLight, AmbientLight, Quaternion,
    Input, KeyCode, EventSystem, Physics, RaycastHit,
    TextAlignment, VerticalAlignment,
    UIText, Button,
} from "WebEngineTS";

import { createCameraRig, type ICameraRig } from "./helpers/CameraSetup";
import {
    createUICanvas, makeLabel, makePanel, makeButton, makeSlider, makeToggle, makeReadout,
    UI, type SliderRow,
} from "./helpers/UIKit";
import { AtomBuilder, occupancyFor, type BuiltAtom } from "./helpers/AtomBuilder";
import { cellOffset, CELL_W, CELL_H, TABLE_WIDTH, TABLE_HEIGHT } from "./helpers/TableLayout";
import { ELEMENTS, CATEGORY, byZ, validateShells, type ElementInfo } from "./data/elements";

/** How far the isotope slider may move from the natural neutron count. */
const NEUTRON_SPAN = 4;
const MAX_CHARGE = 3;

const TABLE_TOP = 50;
const SUPERSCRIPT = ["⁰", "¹", "²", "³"];

/** Noble-gas shells, for the "same configuration as …" note on ions. */
const NOBLE: { name: string; shells: number[] }[] = [
    { name: "гелію", shells: [2] },
    { name: "неону", shells: [2, 8] },
    { name: "аргону", shells: [2, 8, 8] },
    { name: "криптону", shells: [2, 8, 18, 8] },
];

export default class AtomStructure extends ScenarioBehaviour {
    private _camera!: ICameraRig;
    private _builder!: AtomBuilder;

    private _atom: BuiltAtom | null = null;
    private _z = 1;
    private _neutrons = 0;
    private _charge = 0;
    private _paused = false;
    private _cloud = false;

    // UI, refreshed on every change.
    private _symbolText!: UIText;
    private _nameText!: UIText;
    private _configText!: UIText;
    private _factText!: UIText;
    private _particleText!: UIText;
    private _particlePanel!: GameObject;
    private _hintText!: UIText;
    private _setRow!: (row: number, text: string) => void;
    private _neutronRow!: SliderRow;
    private _chargeRow!: SliderRow;
    private readonly _cells: Button[] = [];

    /** Reused across clicks so picking allocates nothing per frame. */
    private readonly _hit = new RaycastHit();

    override async awake(): Promise<void> {
        // A shells/z mismatch still draws — it is only wrong in the readout,
        // which is the worst way for a data typo to fail.
        for (const problem of validateShells()) console.warn(`[elements] ${problem}`);

        this._camera = createCameraRig({
            useSkybox: false,
            orbitDistance: 14,
            orbitMaxDistance: 70,
            backgroundColor: new Color(0.04, 0.05, 0.09, 1),
        });

        this._createLights();
        this._builder = new AtomBuilder();
        this._createUI();
        this._select(1);
    }

    override update(): void {
        this._handleKeyboard();
        this._handlePicking();
    }

    // ── scene ───────────────────────────────────────────────────────

    private _createLights(): void {
        const keyGo = new GameObject("Key Light");
        const key = keyGo.addComponent(DirectionalLight);
        key.intensity = 1.35;
        key.color = new Color(1, 0.97, 0.92, 1);
        keyGo.transform.rotation = Quaternion.euler(40, -30, 0);

        const rimGo = new GameObject("Rim Light");
        const rim = rimGo.addComponent(DirectionalLight);
        rim.intensity = 0.55;
        rim.color = new Color(0.55, 0.72, 1, 1);
        rimGo.transform.rotation = Quaternion.euler(-25, 135, 0);

        const ambGo = new GameObject("Ambient");
        const amb = ambGo.addComponent(AmbientLight);
        amb.intensity = 0.38;
        amb.color = new Color(0.52, 0.58, 0.74, 1);
    }

    // ── input ───────────────────────────────────────────────────────

    private _handleKeyboard(): void {
        if (Input.getKeyDown(KeyCode.ArrowRight)) this._select(this._z % ELEMENTS.length + 1);
        if (Input.getKeyDown(KeyCode.ArrowLeft)) {
            this._select(this._z === 1 ? ELEMENTS.length : this._z - 1);
        }
        if (Input.getKeyDown(KeyCode.KeyP)) this._setPaused(!this._paused);
        if (Input.getKeyDown(KeyCode.KeyO)) this._setCloud(!this._cloud);
    }

    /** Click a particle to name it. */
    private _handlePicking(): void {
        if (!Input.getMouseButtonDown(0) || EventSystem.isPointerOverUI) return;

        const ray = this._camera.camera.screenPointToRay(Input.mousePosition);
        if (!Physics.raycast(ray, this._hit)) {
            this._setParticleText("");
            return;
        }

        const go = this._hit.gameObject;
        const ref = go && this._atom ? this._atom.particleOf.get(go) : undefined;
        if (!ref) {
            this._setParticleText("");
            return;
        }

        if (ref.kind === "proton") {
            this._setParticleText("Протон — заряд +1, у ядрі. Їх кількість і є номером елемента.");
        } else if (ref.kind === "neutron") {
            this._setParticleText("Нейтрон — без заряду. Змінює масу, але не хімію.");
        } else {
            const shell = "KLMN"[ref.shell ?? 0] ?? "?";
            this._setParticleText(`Електрон — заряд −1, оболонка ${shell} (${(ref.shell ?? 0) + 1}-ша).`);
        }
    }

    // ── UI ──────────────────────────────────────────────────────────

    private _createUI(): void {
        const canvas = createUICanvas();

        makeLabel(canvas, {
            anchor: "top-center", y: 10, width: 600, height: 30,
            text: "Будова атома",
            fontSize: 26, align: TextAlignment.Center, valign: VerticalAlignment.Middle,
        });

        // ── periodic table ──
        makePanel(canvas, {
            anchor: "top-center", y: TABLE_TOP - 6,
            width: TABLE_WIDTH + 12, height: TABLE_HEIGHT + 12,
        });

        for (const element of ELEMENTS) {
            const at = cellOffset(element.group, element.period);
            const z = element.z;
            this._cells.push(makeButton(canvas, {
                anchor: "top-center", x: at.x, y: TABLE_TOP + at.y,
                width: CELL_W, height: CELL_H,
                text: element.symbol, fontSize: 12,
                color: CATEGORY[element.category].color,
                onClick: () => this._select(z),
            }));
        }

        // ── element panel (left) ──
        makePanel(canvas, { anchor: "top-left", x: 16, y: 172, width: 300, height: 300 });

        this._symbolText = makeLabel(canvas, {
            anchor: "top-left", x: 30, y: 182, width: 270, height: 44,
            text: "", fontSize: 34, color: UI.accent,
        });
        this._nameText = makeLabel(canvas, {
            anchor: "top-left", x: 30, y: 226, width: 270, height: 24,
            text: "", fontSize: 18,
        });
        this._setRow = makeReadout(canvas, {
            anchor: "top-left", x: 30, y: 254, width: 270, height: 90, rows: 5, fontSize: 14,
        });
        this._configText = makeLabel(canvas, {
            anchor: "top-left", x: 30, y: 348, width: 270, height: 36,
            text: "", fontSize: 13, color: UI.accent,
        });
        this._factText = makeLabel(canvas, {
            anchor: "top-left", x: 30, y: 386, width: 270, height: 66,
            text: "", fontSize: 12, color: UI.textDim,
        });

        // ── controls (right) ──
        makePanel(canvas, { anchor: "top-right", x: 14, y: 172, width: 264, height: 232 });

        this._neutronRow = makeSlider(canvas, {
            anchor: "top-right", x: 28, y: 182, width: 236, height: 14,
            label: "Нейтронів у ядрі (N)", min: 0, max: 4, value: 0, wholeNumbers: true,
            onChange: (v) => { this._neutrons = Math.round(v); this._rebuild(); },
        });

        this._chargeRow = makeSlider(canvas, {
            anchor: "top-right", x: 28, y: 232, width: 236, height: 14,
            label: "Заряд йона", min: -MAX_CHARGE, max: MAX_CHARGE, value: 0, wholeNumbers: true,
            format: (v) => (v > 0 ? `+${Math.round(v)}` : String(Math.round(v))),
            onChange: (v) => { this._charge = Math.round(v); this._rebuild(); },
        });

        makeToggle(canvas, {
            anchor: "top-right", x: 28, y: 284, width: 236, height: 22,
            label: "Обертання електронів", value: true,
            onChange: (on) => this._setPaused(!on),
        });

        makeToggle(canvas, {
            anchor: "top-right", x: 28, y: 314, width: 236, height: 22,
            label: "Модель орбіталей (замість кілець)", value: false,
            onChange: (on) => this._setCloud(on),
        });

        makeButton(canvas, {
            anchor: "top-right", x: 158, y: 348, width: 100, height: 26,
            text: "◀ Попередній", fontSize: 12,
            onClick: () => this._select(this._z === 1 ? ELEMENTS.length : this._z - 1),
        });
        makeButton(canvas, {
            anchor: "top-right", x: 28, y: 348, width: 100, height: 26,
            text: "Наступний ▶", fontSize: 12,
            onClick: () => this._select(this._z % ELEMENTS.length + 1),
        });

        // ── clicked particle ──
        this._particlePanel = makePanel(canvas, { anchor: "bottom-left", x: 16, y: 52, width: 420, height: 30 });
        this._particleText = makeLabel(canvas, {
            anchor: "bottom-left", x: 28, y: 58, width: 400, height: 22,
            text: "", fontSize: 13, color: UI.accent, wordWrap: false,
        });
        this._setParticleText("");

        this._hintText = makeLabel(canvas, {
            anchor: "bottom-center", y: 18, width: 1000, height: 20,
            text: this._hintLine(),
            fontSize: 13, color: UI.textDim,
            align: TextAlignment.Center, valign: VerticalAlignment.Middle,
        });
    }

    private _hintLine(): string {
        return "←/→ — елемент   •   "
            + `P — ${this._paused ? "продовжити" : "зупинити"} обертання   •   `
            + `O — ${this._cloud ? "кільця Бора" : "орбіталі"}   •   `
            + "клік по частинці — що це   •   миша — обертати та наближати";
    }

    // ── state ───────────────────────────────────────────────────────

    private _setPaused(paused: boolean): void {
        this._paused = paused;
        if (this._atom) for (const orbit of this._atom.orbits) orbit.paused = paused;
        this._hintText.text = this._hintLine();
    }

    private _setCloud(cloud: boolean): void {
        this._cloud = cloud;
        this._hintText.text = this._hintLine();
        this._rebuild();
    }

    /** Element change: the sliders' ranges move with it, so reset both. */
    private _select(z: number): void {
        this._z = z;
        const info = byZ(z);

        this._neutrons = info.neutrons;
        this._charge = 0;

        this._neutronRow.slider.minValue = Math.max(0, info.neutrons - NEUTRON_SPAN);
        this._neutronRow.slider.maxValue = info.neutrons + NEUTRON_SPAN;
        this._neutronRow.set(info.neutrons);
        this._chargeRow.set(0);

        this._cells.forEach((cell, i) => {
            const category = CATEGORY[ELEMENTS[i].category].color;
            cell.normalColor = ELEMENTS[i].z === z ? UI.accent : category;
        });

        this._rebuild();
    }

    private _rebuild(): void {
        const info = byZ(this._z);

        // Destroyed rather than hidden: the nucleus is most of the object count,
        // and 36 cached atoms would be ~2000 live objects to save a millisecond.
        if (this._atom) this._atom.root.destroy();

        this._atom = this._builder.build(info, this._neutrons, this._charge, this._cloud);
        for (const orbit of this._atom.orbits) orbit.paused = this._paused;

        this._camera.setOrbitDistance(this._atom.extent * 2.4 + 3);
        this._refreshPanel(info);
        this._setParticleText("");
    }

    private _refreshPanel(info: ElementInfo): void {
        const mass = info.z + this._neutrons;
        const occupancy = this._atom ? this._atom.occupancy : occupancyFor(info.shells, this._charge);

        this._symbolText.text = `${info.symbol}${this._ionSuffix()}`;
        this._nameText.text = this._neutrons === info.neutrons
            ? info.name
            : `${info.name}-${mass}  (ізотоп)`;

        this._setRow(0, `Протонів (Z):  ${info.z}`);
        this._setRow(1, `Нейтронів (N):  ${this._neutrons}`);
        this._setRow(2, `Масове число A:  ${mass}`);
        this._setRow(3, `Електронів:  ${occupancy.reduce((a, b) => a + b, 0)}  →  ${occupancy.join(", ")}`);
        this._setRow(4, `Тип:  ${CATEGORY[info.category].label}`);

        this._configText.text = this._charge === 0
            ? info.config
            : `${info.config}   →   ${this._ionNote(occupancy)}`;

        this._factText.text = this._cloud
            ? `${info.fact}\n\nХмара показує, де електрон буває найчастіше. Для d-електронів намальовано просту сферу, а не справжню форму орбіталі.`
            : `${info.fact}\n\nМалюнок не в масштабі: справжнє ядро приблизно у 100 000 разів менше за атом.`;
    }

    /** "Na⁺", "Ca²⁺", "Cl⁻" — empty for a neutral atom. */
    private _ionSuffix(): string {
        if (this._charge === 0) return "";
        const size = Math.abs(this._charge);
        const digit = size === 1 ? "" : SUPERSCRIPT[size] ?? String(size);
        return `${digit}${this._charge > 0 ? "⁺" : "⁻"}`;
    }

    private _ionNote(occupancy: number[]): string {
        const match = NOBLE.find((noble) =>
            noble.shells.length === occupancy.length
            && noble.shells.every((count, i) => count === occupancy[i]));
        return match ? `конфігурація ${match.name}` : `${occupancy.join(", ")} електронів`;
    }

    /**
     * Writes the clicked-particle readout, hiding its panel when there is nothing
     * to report -- an empty label still leaves a painted background behind.
     */
    private _setParticleText(text: string): void {
        this._particleText.text = text;
        this._particlePanel.setActive(text.length > 0);
    }
}
