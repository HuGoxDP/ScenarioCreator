// scripts/Scenario.ts  (Кристалічні ґратки)
// ============================================================
// Eight structures built from their real lattice constants and bases, with the
// unit cell outlined inside the extended lattice.
//
// The readout computes ρ = Z·M/(N_A·V) on screen and prints the handbook value
// beside it. That is the scenario's own check: if a structure were out by a
// factor of two or four, `perCell` would be counting atoms where it should
// count formula units — and nothing on screen would look wrong.
//
// The coordination number is verifiable the same way: turn bonds on, click an
// atom, count what touches it. `validateStructures()` counts the same thing at
// load, and it caught a real mistake in the hexagonal basis.
// ============================================================

import {
    ScenarioBehaviour, GameObject, Color,
    DirectionalLight, AmbientLight, Quaternion, Time,
    Input, KeyCode,
    TextAlignment, VerticalAlignment,
    Button, UIText,
} from "WebEngineTS";

import { createCameraRig, type ICameraRig } from "./helpers/CameraSetup";
import {
    createUICanvas, makeLabel, makePanel, makeButton, makeSlider, makeToggle, makeDropdown,
    makeReadout, UI,
} from "./helpers/UIKit";
import { LatticeBuilder, BOND_CELL_LIMIT } from "./helpers/LatticeBuilder";
import { elementInfo } from "./data/elements";
import {
    STRUCTURES, BONDING_LABEL, cellVolume, computedDensity, validateStructures,
} from "./data/structures";

export default class CrystalLattices extends ScenarioBehaviour {
    private _camera!: ICameraRig;
    private _builder!: LatticeBuilder;
    private _root!: GameObject;

    private _index = 0;
    private _cells = 2;
    private _spaceFilling = false;
    private _bonds = true;
    private _highlightCell = true;
    private _cut = 1;
    private _spin = true;

    private _setRow!: (row: number, text: string) => void;
    private _legendRows: Button[] = [];
    private _factText!: UIText;
    private _angle = 0;

    override async awake(): Promise<void> {
        for (const problem of validateStructures()) console.warn(`[structures] ${problem}`);

        this._camera = createCameraRig({
            useSkybox: false,
            orbitDistance: 24,
            orbitMaxDistance: 90,
            backgroundColor: new Color(0.05, 0.06, 0.09, 1),
        });

        this._createLights();
        this._root = new GameObject("Lattice");
        this._builder = new LatticeBuilder(this._root);

        this._createUI();
        this._select(0);
    }

    override update(): void {
        if (Input.getKeyDown(KeyCode.ArrowRight)) this._select((this._index + 1) % STRUCTURES.length);
        if (Input.getKeyDown(KeyCode.ArrowLeft)) {
            this._select((this._index - 1 + STRUCTURES.length) % STRUCTURES.length);
        }
        if (Input.getKeyDown(KeyCode.KeyP)) this._spin = !this._spin;

        if (this._spin) {
            this._angle += 9 * Time.deltaTime;
            this._root.transform.rotation = Quaternion.euler(0, this._angle, 0);
        }
    }

    private _createLights(): void {
        const keyGo = new GameObject("Key Light");
        const key = keyGo.addComponent(DirectionalLight);
        key.intensity = 1.3;
        key.color = new Color(1, 0.98, 0.94, 1);
        keyGo.transform.rotation = Quaternion.euler(42, -35, 0);

        const rimGo = new GameObject("Rim Light");
        const rim = rimGo.addComponent(DirectionalLight);
        rim.intensity = 0.5;
        rim.color = new Color(0.6, 0.75, 1, 1);
        rimGo.transform.rotation = Quaternion.euler(-22, 138, 0);

        const ambGo = new GameObject("Ambient");
        const amb = ambGo.addComponent(AmbientLight);
        amb.intensity = 0.4;
        amb.color = new Color(0.55, 0.60, 0.74, 1);
    }

    // ── selection ───────────────────────────────────────────────────

    private _select(index: number): void {
        this._index = index;
        this._legendRows.forEach((row, i) => {
            row.normalColor = i === index ? UI.buttonHover : UI.buttonNormal;
        });
        this._rebuild();
    }

    private _rebuild(): void {
        const structure = STRUCTURES[this._index];
        const result = this._builder.build(structure, {
            cells: this._cells,
            spaceFilling: this._spaceFilling,
            bonds: this._bonds,
            highlightCell: this._highlightCell,
            cut: this._cut,
        });

        this._camera.setOrbitDistance(result.extent * 2.5 + 4);

        const volume = cellVolume(structure);
        const computed = computedDensity(structure);

        this._setRow(0, structure.name);
        this._setRow(1, structure.type);
        this._setRow(2, `Зв'язок: ${BONDING_LABEL[structure.bonding]}`);
        this._setRow(3, structure.hexagonal
            ? `a = ${structure.a.toFixed(3)} Å   c = ${structure.c.toFixed(3)} Å`
            : `Стала ґратки a = ${structure.a.toFixed(3)} Å`);
        this._setRow(4, `Координаційне число: ${structure.coordination}`);
        this._setRow(5, `Формульних одиниць на комірку Z = ${structure.perCell}`);
        this._setRow(6, "");
        this._setRow(7, "ρ = Z·M / (N_A · a³)");
        this._setRow(8, `ρ = ${structure.perCell}·${structure.molarMass} / (6.022·10²³ · ${volume.toFixed(2)}·10⁻²⁴)`);
        this._setRow(9, `ρ = ${computed.toFixed(3)} г/см³      довідник: ${structure.density} г/см³`);
        this._setRow(10, `Атомів на екрані: ${result.atoms}` + (result.bonds > 0 ? `,  зв'язків: ${result.bonds}` : ""));
        this._setRow(11, this._bonds && !result.bondsDrawn
            ? (structure.bondCutoff > 0
                ? `Зв'язки малюються до ${BOND_CELL_LIMIT} комірок — далі це суцільний шум.`
                : "У цього кристала зв'язків немає: атоми тримає лише Ван-дер-Ваальс.")
            : "");

        this._factText.text = structure.fact;
    }

    // ── UI ──────────────────────────────────────────────────────────

    private _createUI(): void {
        const canvas = createUICanvas();

        makeLabel(canvas, {
            anchor: "top-center", y: 10, width: 700, height: 30,
            text: "Кристалічні ґратки",
            fontSize: 26, align: TextAlignment.Center, valign: VerticalAlignment.Middle,
        });

        // ── structure list (left) ──
        makePanel(canvas, { anchor: "top-left", x: 16, y: 52, width: 220, height: STRUCTURES.length * 30 + 12 });
        this._legendRows = STRUCTURES.map((structure, i) => makeButton(canvas, {
            anchor: "top-left", x: 22, y: 58 + i * 30, width: 208, height: 26,
            text: structure.name, fontSize: 12,
            onClick: () => this._select(i),
        }));

        // ── readout (left, below) ──
        makePanel(canvas, { anchor: "top-left", x: 16, y: STRUCTURES.length * 30 + 74, width: 360, height: 254 });
        this._setRow = makeReadout(canvas, {
            anchor: "top-left", x: 30, y: STRUCTURES.length * 30 + 84, width: 336, height: 236,
            rows: 12, fontSize: 12, rowHeight: 19,
        });

        this._factText = makeLabel(canvas, {
            anchor: "bottom-left", x: 24, y: 46, width: 520, height: 70,
            text: "", fontSize: 12, color: UI.textDim,
        });

        // ── controls (right) ──
        makePanel(canvas, { anchor: "top-right", x: 16, y: 52, width: 290, height: 250 });

        makeDropdown(canvas, {
            anchor: "top-right", x: 30, y: 62, width: 262, height: 26,
            options: STRUCTURES.map((s) => s.name), value: 0, maxVisibleItems: 5,
            onChange: (index) => this._select(index),
        });

        makeSlider(canvas, {
            anchor: "top-right", x: 30, y: 98, width: 262, height: 14,
            label: "Розмір ґратки, комірок", min: 1, max: 5, value: 2, wholeNumbers: true,
            onChange: (v) => { this._cells = Math.round(v); this._rebuild(); },
        });

        makeSlider(canvas, {
            anchor: "top-right", x: 30, y: 142, width: 262, height: 14,
            label: "Розріз", min: 20, max: 100, value: 100, wholeNumbers: true,
            format: (v) => `${Math.round(v)} %`,
            onChange: (v) => { this._cut = v / 100; this._rebuild(); },
        });

        makeToggle(canvas, {
            anchor: "top-right", x: 30, y: 184, width: 262, height: 20,
            label: "Елементарна комірка", value: true,
            onChange: (on) => { this._highlightCell = on; this._rebuild(); },
        });
        makeToggle(canvas, {
            anchor: "top-right", x: 30, y: 210, width: 262, height: 20,
            label: `Зв'язки (до ${BOND_CELL_LIMIT} комірок)`, value: true,
            onChange: (on) => { this._bonds = on; this._rebuild(); },
        });
        makeToggle(canvas, {
            anchor: "top-right", x: 30, y: 236, width: 262, height: 20,
            label: "Йонні радіуси (щільна модель)", value: false,
            onChange: (on) => { this._spaceFilling = on; this._rebuild(); },
        });
        makeToggle(canvas, {
            anchor: "top-right", x: 30, y: 262, width: 262, height: 20,
            label: "Обертання", value: true,
            onChange: (on) => { this._spin = on; },
        });

        // ── element key (right, below) ──
        makePanel(canvas, { anchor: "top-right", x: 16, y: 312, width: 290, height: 130 });
        makeLabel(canvas, {
            anchor: "top-right", x: 30, y: 320, width: 262, height: 18,
            text: "Кольори елементів", fontSize: 12, color: UI.textDim, wordWrap: false,
        });
        ["Na", "Cl", "Cs", "C", "Cu", "Fe", "Mg", "Ar"].forEach((symbol, i) => {
            const info = elementInfo(symbol);
            makeLabel(canvas, {
                anchor: "top-right",
                x: 30 + (i % 2) * 132, y: 342 + Math.floor(i / 2) * 20,
                width: 128, height: 18,
                text: `■ ${info.name}`, fontSize: 11, color: info.color, wordWrap: false,
            });
        });

        makeLabel(canvas, {
            anchor: "bottom-center", y: 16, width: 1100, height: 20,
            text: "←/→ — структура   •   P — обертання   •   миша — обертати та наближати",
            fontSize: 12, color: UI.textDim,
            align: TextAlignment.Center, valign: VerticalAlignment.Middle,
        });
    }
}
