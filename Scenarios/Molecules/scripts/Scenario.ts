// scripts/Scenario.ts  (Молекулярні моделі)
// ============================================================
// Interactive ball-and-stick models of 46 molecules, grouped into seven
// lessons: simple substances, inorganics, VSEPR shapes, organics, acids,
// ions/salts and a few special cases.
//
// Everything is procedural — atoms are spheres, bonds are cylinders between
// atom centres — so the scenario ships without a single asset. Coordinates come
// from real bond lengths and angles (see data/molecules.ts); this file only
// turns the selected structure into a scene and drives the UI.
//
// Molecules are built on first view and cached, so start-up cost does not grow
// with the size of the catalogue.
// ============================================================

import {
    ScenarioBehaviour, GameObject, Color,
    DirectionalLight, AmbientLight, Quaternion,
    Input, KeyCode, EventSystem, Physics, RaycastHit,
    TextAlignment, VerticalAlignment,
    UIText, Button,
} from "WebEngineTS";

import { createCameraRig, type ICameraRig } from "./helpers/CameraSetup";
import { createUICanvas, makeLabel, makePanel, makeButton, UI } from "./helpers/UIKit";
import { MoleculeBuilder, SCALE, type BuiltMolecule } from "./helpers/MoleculeBuilder";
import { ELEMENT, type ElementKey } from "./data/elements";
import {
    CATEGORIES, boundingRadius, byCategory,
    type CategoryKey, type MoleculeDef,
} from "./data/molecules";

/** Widest category decides the size of the reusable button pool. */
const MAX_IN_CATEGORY = Math.max(...CATEGORIES.map((c) => byCategory(c.key).length));

const TAB_W = 100;
const TAB_GAP = 5;
const ROW_H = 30;

export default class MoleculeViewer extends ScenarioBehaviour {
    private _camera!: ICameraRig;
    private _builder!: MoleculeBuilder;

    private readonly _built = new Map<MoleculeDef, BuiltMolecule>();
    private readonly _elementOf = new Map<GameObject, ElementKey>();

    private _categoryIndex = 0;
    private _visible: MoleculeDef[] = [];
    private _paused = false;

    // UI, refreshed on every selection change.
    private _formulaText!: UIText;
    private _nameText!: UIText;
    private _infoText!: UIText;
    private _factText!: UIText;
    private _atomText!: UIText;
    private _hintText!: UIText;
    private _tabs: Button[] = [];
    private _rows: Button[] = [];

    /** Reused across clicks so picking allocates nothing per frame. */
    private readonly _hit = new RaycastHit();

    override async awake(): Promise<void> {
        this._camera = createCameraRig({
            useSkybox: false,
            orbitDistance: 9,
            orbitMaxDistance: 40,
            backgroundColor: new Color(0.05, 0.06, 0.10, 1),
        });

        this._createLights();
        this._builder = new MoleculeBuilder();
        this._createUI();
        this._selectCategory(0);
    }

    override update(): void {
        this._handleKeyboard();
        this._handlePicking();
    }

    // ── scene ───────────────────────────────────────────────────────

    private _createLights(): void {
        const keyGo = new GameObject("Key Light");
        const key = keyGo.addComponent(DirectionalLight);
        key.intensity = 1.4;
        key.color = new Color(1, 0.98, 0.94, 1);
        keyGo.transform.rotation = Quaternion.euler(45, -35, 0);

        const rimGo = new GameObject("Rim Light");
        const rim = rimGo.addComponent(DirectionalLight);
        rim.intensity = 0.5;
        rim.color = new Color(0.6, 0.75, 1, 1);
        rimGo.transform.rotation = Quaternion.euler(-20, 140, 0);

        const ambGo = new GameObject("Ambient");
        const amb = ambGo.addComponent(AmbientLight);
        amb.intensity = 0.35;
        amb.color = new Color(0.55, 0.6, 0.75, 1);
    }

    /** Builds on first request, then serves from cache. */
    private _instance(def: MoleculeDef): BuiltMolecule {
        let built = this._built.get(def);
        if (!built) {
            built = this._builder.build(def.name, def.frag, this._elementOf);
            built.rotator.paused = this._paused;
            this._built.set(def, built);
        }
        return built;
    }

    // ── input ───────────────────────────────────────────────────────

    private _handleKeyboard(): void {
        const digits = [
            KeyCode.Digit1, KeyCode.Digit2, KeyCode.Digit3, KeyCode.Digit4, KeyCode.Digit5,
            KeyCode.Digit6, KeyCode.Digit7, KeyCode.Digit8, KeyCode.Digit9,
        ];
        for (let i = 0; i < digits.length && i < this._visible.length; i++) {
            if (Input.getKeyDown(digits[i])) this._select(this._visible[i]);
        }

        if (Input.getKeyDown(KeyCode.ArrowRight)) {
            this._selectCategory((this._categoryIndex + 1) % CATEGORIES.length);
        }
        if (Input.getKeyDown(KeyCode.ArrowLeft)) {
            this._selectCategory((this._categoryIndex - 1 + CATEGORIES.length) % CATEGORIES.length);
        }

        if (Input.getKeyDown(KeyCode.KeyP)) {
            this._paused = !this._paused;
            for (const built of this._built.values()) built.rotator.paused = this._paused;
            this._hintText.text = this._hintLine();
        }
    }

    /** Click an atom to name its element. */
    private _handlePicking(): void {
        if (!Input.getMouseButtonDown(0) || EventSystem.isPointerOverUI) return;

        const ray = this._camera.camera.screenPointToRay(Input.mousePosition);
        if (!Physics.raycast(ray, this._hit)) {
            this._atomText.text = "";
            return;
        }

        const go = this._hit.gameObject;
        const element = go ? this._elementOf.get(go) : undefined;
        if (!element) {
            this._atomText.text = "";
            return;
        }

        const info = ELEMENT[element];
        this._atomText.text = `Обраний атом:  ${element} — ${info.name}`;
    }

    // ── UI ──────────────────────────────────────────────────────────

    private _createUI(): void {
        const canvas = createUICanvas();

        makeLabel(canvas, {
            anchor: "top-center", y: 14, width: 600, height: 32,
            text: "Молекулярні моделі",
            fontSize: 26, align: TextAlignment.Center, valign: VerticalAlignment.Middle,
        });

        // Category tabs, centred as one row.
        CATEGORIES.forEach((cat, i) => {
            this._tabs.push(makeButton(canvas, {
                anchor: "top-center",
                x: (i - (CATEGORIES.length - 1) / 2) * (TAB_W + TAB_GAP),
                y: 50,
                width: TAB_W, height: 26,
                text: cat.label,
                fontSize: 13,
                onClick: () => this._selectCategory(i),
            }));
        });

        // Info panel (left).
        makePanel(canvas, { anchor: "top-left", x: 16, y: 88, width: 320, height: 300 });

        this._formulaText = makeLabel(canvas, {
            anchor: "top-left", x: 32, y: 100, width: 290, height: 42,
            text: "", fontSize: 32, color: UI.accent,
        });
        this._nameText = makeLabel(canvas, {
            anchor: "top-left", x: 32, y: 144, width: 290, height: 24,
            text: "", fontSize: 18,
        });
        this._infoText = makeLabel(canvas, {
            anchor: "top-left", x: 32, y: 176, width: 290, height: 86,
            text: "", fontSize: 14, color: UI.textDim,
        });
        this._factText = makeLabel(canvas, {
            anchor: "top-left", x: 32, y: 268, width: 290, height: 112,
            text: "", fontSize: 13, color: UI.textDim,
        });

        // Molecule list (right), a fixed pool reused by every category.
        makePanel(canvas, {
            anchor: "top-right", x: 10, y: 82,
            width: 162, height: MAX_IN_CATEGORY * ROW_H + 12,
        });
        for (let i = 0; i < MAX_IN_CATEGORY; i++) {
            this._rows.push(makeButton(canvas, {
                anchor: "top-right", x: 16, y: 88 + i * ROW_H,
                width: 150, height: 26,
                text: "", fontSize: 14,
                onClick: () => {
                    const def = this._visible[i];
                    if (def) this._select(def);
                },
            }));
        }

        // Clicked-atom readout.
        makePanel(canvas, { anchor: "bottom-left", x: 16, y: 52, width: 320, height: 30 });
        this._atomText = makeLabel(canvas, {
            anchor: "bottom-left", x: 28, y: 58, width: 300, height: 22,
            text: "", fontSize: 14, color: UI.accent,
        });

        this._hintText = makeLabel(canvas, {
            anchor: "bottom-center", y: 18, width: 900, height: 20,
            text: this._hintLine(),
            fontSize: 13, color: UI.textDim,
            align: TextAlignment.Center, valign: VerticalAlignment.Middle,
        });
    }

    private _hintLine(): string {
        return "1–9 — молекула   •   ←/→ — розділ   •   "
            + `P — ${this._paused ? "продовжити" : "пауза"} обертання   •   `
            + "клік по атому — назва елемента   •   миша — обертати та наближати";
    }

    // ── selection ───────────────────────────────────────────────────

    private _selectCategory(index: number): void {
        this._categoryIndex = index;
        const key: CategoryKey = CATEGORIES[index].key;
        this._visible = byCategory(key);

        this._tabs.forEach((tab, i) => {
            tab.normalColor = i === index ? UI.buttonHover : UI.buttonNormal;
        });

        this._rows.forEach((row, i) => {
            const def = this._visible[i];
            row.gameObject.setActive(def !== undefined);
            if (def) row.text = `${i + 1}. ${def.formula}`;
        });

        this._select(this._visible[0]);
    }

    private _select(def: MoleculeDef): void {
        if (!def) return;

        // Only the chosen molecule stays in the scene; the rest keep their
        // built GameObjects but are switched off.
        for (const [other, built] of this._built) {
            if (other !== def) built.root.setActive(false);
        }
        this._instance(def).root.setActive(true);

        this._rows.forEach((row, i) => {
            row.normalColor = this._visible[i] === def ? UI.buttonHover : UI.buttonNormal;
        });

        // Frame the molecule: a hydrogen molecule and a salt lattice differ by
        // almost an order of magnitude in size.
        const radius = boundingRadius(def.frag) * SCALE;
        this._camera.setOrbitDistance(radius * 2.4 + 3.5);

        this._formulaText.text = def.formula;
        this._nameText.text = def.name;
        this._infoText.text =
            `Геометрія: ${def.geometry}\n`
            + `Валентний кут: ${def.bondAngle}\n`
            + `Тип зв'язку: ${def.bondType}\n`
            + `Атомів: ${def.frag.atoms.length}`;
        this._factText.text = def.fact;
        this._atomText.text = "";
    }
}
