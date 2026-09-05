// scripts/Scenario.ts  (ДНК і синтез білка)
// ============================================================
// A B-DNA double helix that unwinds into transcription, and an mRNA that a
// ribosome then translates codon by codon against the full genetic code.
//
// Two modes share one step counter, so «Далі», «Назад» and «Авто» behave
// identically in both. Every step is a pure function of (mode, sequence, step):
// nothing accumulates, so stepping backwards is the same code path as stepping
// forwards — a chain that could only grow would make «Назад» a lie.
//
// Procedural throughout; the scenario ships without a single asset.
// ============================================================

import {
    ScenarioBehaviour, GameObject, Color, Mesh, Vector3,
    DirectionalLight, AmbientLight, Quaternion, Time,
    Input, KeyCode, EventSystem, Physics, RaycastHit,
    TextAlignment, VerticalAlignment,
    UIText, Button,
} from "WebEngineTS";

import { createCameraRig, type ICameraRig } from "./helpers/CameraSetup";
import {
    createUICanvas, makeLabel, makePanel, makeButton, makeSlider, makeToggle, makeDropdown,
    UI,
} from "./helpers/UIKit";
import {
    HelixBuilder, type BuiltHelix, type MessengerStrand, type BaseRef,
} from "./helpers/HelixBuilder";
import { Polymerase, Ribosome } from "./helpers/Ribosome";
import {
    SEQUENCES, BASE_NAME, bondCount, templateFor, rnaFromTemplate, codonsOf, inTriplets,
    validateSequences,
} from "./data/sequences";
import {
    BASE_ORDER, CODON, AMINO, CLASS_LABEL, aminoFor, isStop, validateCode,
} from "./data/genetic-code";

type Mode = "transcription" | "translation";

/** Bases either side of the polymerase that are held apart. */
const OPEN_HALF_WIDTH = 2.5;

const CELL_W = 86;
const CELL_H = 15;

export default class ProteinSynthesis extends ScenarioBehaviour {
    private _camera!: ICameraRig;
    private _builder!: HelixBuilder;
    private _stage!: GameObject;

    private _helix!: BuiltHelix;
    private _mrna!: MessengerStrand;
    private _polymerase!: Polymerase;
    private _ribosome!: Ribosome;

    private readonly _refs = new Map<GameObject, BaseRef>();

    private _seqIndex = 0;
    private _mode: Mode = "transcription";
    private _step = 0;
    private _auto = false;
    private _speed = 1;
    private _timer = 0;
    private _showBonds = true;

    // Derived from the selected sequence.
    private _coding = "";
    private _template = "";
    private _rna = "";
    private _codons: string[] = [];

    private _tabs: Button[] = [];
    private _autoButton!: Button;
    private _stageText!: UIText;
    private _explainText!: UIText;
    private _peptideText!: UIText;
    private _noteText!: UIText;
    private _codingLine!: UIText;
    private _templateLine!: UIText;
    private _rnaLine!: UIText;
    private _caretLine!: UIText;
    private _pickText!: UIText;
    private _pickPanel!: GameObject;
    private _hintText!: UIText;
    private readonly _codonCells = new Map<string, UIText>();

    private readonly _hit = new RaycastHit();

    override async awake(): Promise<void> {
        for (const problem of validateCode()) console.warn(`[genetic-code] ${problem}`);
        for (const problem of validateSequences()) console.warn(`[sequences] ${problem}`);

        this._camera = createCameraRig({
            useSkybox: false,
            orbitDistance: 20,
            orbitMaxDistance: 90,
            backgroundColor: new Color(0.04, 0.06, 0.08, 1),
        });

        this._createLights();
        this._builder = new HelixBuilder();
        this._createUI();
        this._loadSequence(0);
    }

    override update(): void {
        this._handleKeyboard();
        this._handlePicking();
        this._handleAuto();
    }

    // ── scene ───────────────────────────────────────────────────────

    private _createLights(): void {
        const keyGo = new GameObject("Key Light");
        const key = keyGo.addComponent(DirectionalLight);
        key.intensity = 1.3;
        key.color = new Color(1, 0.98, 0.94, 1);
        keyGo.transform.rotation = Quaternion.euler(35, -40, 0);

        const rimGo = new GameObject("Rim Light");
        const rim = rimGo.addComponent(DirectionalLight);
        rim.intensity = 0.5;
        rim.color = new Color(0.5, 0.8, 0.85, 1);
        rimGo.transform.rotation = Quaternion.euler(-20, 130, 0);

        const ambGo = new GameObject("Ambient");
        const amb = ambGo.addComponent(AmbientLight);
        amb.intensity = 0.4;
        amb.color = new Color(0.5, 0.6, 0.68, 1);
    }

    /**
     * Rebuilds the strands for the chosen sequence.
     *
     * The stage exists so the whole assembly can be centred on the origin: the
     * camera rig orbits (0,0,0) and a 15-unit strand built upwards from there
     * would be framed from its feet.
     */
    private _loadSequence(index: number): void {
        this._seqIndex = index;
        const sequence = SEQUENCES[index];

        this._coding = sequence.coding;
        this._template = templateFor(this._coding);
        this._rna = rnaFromTemplate(this._template);
        this._codons = codonsOf(this._rna);

        if (this._stage) this._stage.destroy();
        this._refs.clear();

        this._stage = new GameObject("Stage");
        this._helix = this._builder.build(this._coding, this._refs);
        this._mrna = this._builder.buildMessenger(this._rna, this._refs);
        this._polymerase = new Polymerase(Mesh.createSphere(1, 16));
        this._ribosome = new Ribosome(Mesh.createSphere(1, 16), Mesh.createCylinder(1, 1, 10));

        for (const part of [this._helix.root, this._mrna.root, this._polymerase.root, this._ribosome.root]) {
            part.transform.parent = this._stage.transform;
        }
        // Centre the assembly: it is built upwards from y = 0 and sideways to
        // the mRNA at x ≈ 4.
        this._stage.transform.position = new Vector3(-2.1, -this._helix.height / 2, 0);

        this._camera.setOrbitDistance(Math.max(this._helix.height, 9) * 1.35 + 7);
        this._noteText.text = `${sequence.title} — ${sequence.note}`;

        this._step = 0;
        this._apply();
    }

    // ── step machine ────────────────────────────────────────────────

    private get _maxStep(): number {
        return this._mode === "transcription" ? this._coding.length : this._codons.length;
    }

    private _setStep(step: number): void {
        this._step = Math.max(0, Math.min(step, this._maxStep));
        this._apply();
    }

    private _setMode(mode: Mode): void {
        this._mode = mode;
        this._step = 0;
        this._auto = false;
        this._tabs.forEach((tab, i) => {
            tab.normalColor = (i === 0) === (mode === "transcription") ? UI.buttonHover : UI.buttonNormal;
        });
        this._apply();
    }

    private _handleAuto(): void {
        if (!this._auto) return;

        this._timer += Time.deltaTime * this._speed;
        if (this._timer < 0.7) return;

        this._timer = 0;
        if (this._step >= this._maxStep) {
            this._auto = false;
            this._autoButton.text = "Авто ▶";
            return;
        }
        this._setStep(this._step + 1);
    }

    /** Draws the whole world for the current (mode, sequence, step). */
    private _apply(): void {
        if (this._mode === "transcription") this._applyTranscription();
        else this._applyTranslation();

        this._refreshStrip();
        this._refreshCodonTable();
        this._setPickText("");
    }

    private _applyTranscription(): void {
        const i = this._step - 1;

        this._helix.root.setActive(true);
        this._helix.setOpen(i < 0 ? -1 : i, OPEN_HALF_WIDTH);
        this._applyBondVisibility();
        this._polymerase.moveTo(i < 0 ? -1 : this._mrna.yOf(i));
        this._mrna.setLength(this._step);
        this._ribosome.show(false);

        this._stageText.text = `Транскрипція — крок ${this._step} з ${this._maxStep}`;

        if (i < 0) {
            this._explainText.text =
                "Подвійна спіраль. Ланцюги утримують водневі зв'язки: два між А і Т, три між Г і Ц. "
                + "Саме тому ділянки, багаті на Г–Ц, розплітаються важче. "
                + "Натисніть «Крок ▶»: зелена напівпрозора куля — це РНК-полімераза, фермент, "
                + "який поїде вздовж спіралі, розплітаючи її та будуючи мРНК.";
        } else if (this._step >= this._maxStep) {
            this._explainText.text =
                "Транскрипцію завершено. мРНК комплементарна матричному ланцюгу — а отже збігається "
                + "з кодуючим, у якому Т замінено на У. Порівняйте два верхні рядки внизу екрана. "
                + "РНК-полімераза (зелена куля) дійшла до кінця гена; у клітині вона тут "
                + "від'єднується від ДНК.";
        } else {
            this._explainText.text =
                `РНК-полімераза розплітає спіраль і зчитує матричний ланцюг.\n`
                + `Основа ${this._step}: матрична ${this._template[i]} → мРНК ${this._rna[i]}`
                + (this._template[i] === "A" ? "   (навпроти А стає У, а не Т!)" : "");
        }

        this._peptideText.text = "";
    }

    private _applyTranslation(): void {
        this._helix.root.setActive(false);
        this._polymerase.moveTo(-1);
        this._mrna.setLength(this._rna.length);
        this._ribosome.show(true);

        const done = this._step;
        const at = Math.min(done, this._codons.length - 1);
        const y = this._mrna.yOf(at * 3 + 1);
        this._ribosome.moveTo(y);

        const built = this._codons.slice(0, done).filter((codon) => !isStop(codon));
        this._ribosome.setPeptide(built.map((codon) => aminoFor(codon).cls), y);

        const current = this._codons[at];
        const reading = done < this._codons.length;

        if (reading && !isStop(current)) this._ribosome.showTRna(y, aminoFor(current).cls);
        else this._ribosome.hideTRna();

        this._stageText.text = `Трансляція — кодон ${Math.min(done + 1, this._codons.length)} з ${this._codons.length}`;

        if (done === 0) {
            this._explainText.text =
                "Рибосома сідає на стартовий кодон AUG. Він же кодує метіонін — тому будь-який "
                + "ланцюг починається саме з нього.";
        } else if (!reading) {
            const stop = this._codons[this._codons.length - 1];
            this._explainText.text =
                `Стоп-кодон ${stop}: тРНК для нього не існує. Рибосома розходиться на дві субодиниці, `
                + `готовий ланцюг із ${built.length} амінокислот звільняється.`;
        } else if (isStop(current)) {
            this._explainText.text =
                `Кодон ${current} — стоп. Наступний крок завершить синтез: тРНК не прийде.`;
        } else {
            const acid = aminoFor(current);
            this._explainText.text =
                `Кодон ${current} → ${acid.name} (${acid.code}).\n`
                + `Антикодон тРНК спарюється з кодоном, амінокислота приєднується до ланцюга.\n`
                + `Клас бічного ланцюга: ${CLASS_LABEL[acid.cls]}.`;
        }

        this._peptideText.text = built.length === 0
            ? "Ланцюг: —"
            : `Ланцюг (${built.length}): ` + built.map((codon) => aminoFor(codon).code).join(" – ");
    }

    private _applyBondVisibility(): void {
        if (this._showBonds) return;
        for (const pair of this._helix.pairs) {
            for (const bond of pair.bonds) bond.setActive(false);
        }
    }

    // ── input ───────────────────────────────────────────────────────

    private _handleKeyboard(): void {
        if (Input.getKeyDown(KeyCode.ArrowRight)) this._setStep(this._step + 1);
        if (Input.getKeyDown(KeyCode.ArrowLeft)) this._setStep(this._step - 1);
        if (Input.getKeyDown(KeyCode.Space)) this._toggleAuto();
        if (Input.getKeyDown(KeyCode.KeyR)) this._setStep(0);
        if (Input.getKeyDown(KeyCode.Tab)) {
            this._setMode(this._mode === "transcription" ? "translation" : "transcription");
        }
    }

    private _handlePicking(): void {
        if (!Input.getMouseButtonDown(0) || EventSystem.isPointerOverUI) return;

        const ray = this._camera.camera.screenPointToRay(Input.mousePosition);
        if (!Physics.raycast(ray, this._hit)) {
            this._setPickText("");
            return;
        }

        const go = this._hit.gameObject;
        const ref = go ? this._refs.get(go) : undefined;
        if (!ref) {
            this._setPickText("");
            return;
        }

        if (ref.strand === "mrna") {
            const source = this._coding[ref.index];
            this._setPickText(
                `мРНК, основа ${ref.index + 1}: ${ref.base} — ${BASE_NAME[ref.base]}`
                + (ref.base === "U" ? ` (замість ${source} кодуючого ланцюга)` : ""),
            );
            return;
        }

        const partner = ref.strand === "coding" ? this._template[ref.index] : this._coding[ref.index];
        const strand = ref.strand === "coding" ? "кодуючий" : "матричний";
        this._setPickText(
            `${strand} ланцюг, основа ${ref.index + 1}: ${ref.base} — ${BASE_NAME[ref.base]}. `
            + `Пара: ${partner} (${BASE_NAME[partner]}), ${bondCount(ref.base)} водневі зв'язки.`,
        );
    }

    private _toggleAuto(): void {
        this._auto = !this._auto;
        this._timer = 0;
        if (this._auto && this._step >= this._maxStep) this._setStep(0);
        this._autoButton.text = this._auto ? "Авто ⏸" : "Авто ▶";
    }

    // ── UI ──────────────────────────────────────────────────────────

    private _createUI(): void {
        const canvas = createUICanvas();

        makeLabel(canvas, {
            anchor: "top-center", y: 10, width: 600, height: 30,
            text: "ДНК і синтез білка",
            fontSize: 26, align: TextAlignment.Center, valign: VerticalAlignment.Middle,
        });

        this._tabs = [
            makeButton(canvas, {
                anchor: "top-center", x: -66, y: 46, width: 128, height: 26,
                text: "Транскрипція", fontSize: 13,
                onClick: () => this._setMode("transcription"),
            }),
            makeButton(canvas, {
                anchor: "top-center", x: 66, y: 46, width: 128, height: 26,
                text: "Трансляція", fontSize: 13,
                onClick: () => this._setMode("translation"),
            }),
        ];

        // ── stage panel (left) ──
        makePanel(canvas, { anchor: "top-left", x: 16, y: 86, width: 330, height: 226 });

        this._stageText = makeLabel(canvas, {
            anchor: "top-left", x: 30, y: 96, width: 300, height: 24,
            text: "", fontSize: 17, color: UI.accent,
        });
        this._explainText = makeLabel(canvas, {
            anchor: "top-left", x: 30, y: 124, width: 300, height: 96,
            text: "", fontSize: 13,
        });
        this._peptideText = makeLabel(canvas, {
            anchor: "top-left", x: 30, y: 224, width: 300, height: 34,
            text: "", fontSize: 13, color: UI.accent,
        });
        this._noteText = makeLabel(canvas, {
            anchor: "top-left", x: 30, y: 262, width: 300, height: 44,
            text: "", fontSize: 11, color: UI.textDim,
        });

        // ── controls (left, below) ──
        makePanel(canvas, { anchor: "top-left", x: 16, y: 322, width: 330, height: 150 });

        makeDropdown(canvas, {
            anchor: "top-left", x: 30, y: 332, width: 300, height: 26,
            options: SEQUENCES.map((s) => s.title), value: 0, maxVisibleItems: 3,
            onChange: (index) => this._loadSequence(index),
        });

        makeSlider(canvas, {
            anchor: "top-left", x: 30, y: 368, width: 300, height: 14,
            label: "Швидкість автопрогравання", min: 0.25, max: 4, value: 1,
            format: (v) => `${v.toFixed(2)}×`,
            onChange: (v) => { this._speed = v; },
        });

        makeToggle(canvas, {
            anchor: "top-left", x: 30, y: 410, width: 300, height: 22,
            label: "Водневі зв'язки", value: true,
            onChange: (on) => { this._showBonds = on; this._apply(); },
        });

        makeButton(canvas, {
            anchor: "top-left", x: 30, y: 438, width: 74, height: 24,
            text: "◀ Крок", fontSize: 12, onClick: () => this._setStep(this._step - 1),
        });
        makeButton(canvas, {
            anchor: "top-left", x: 110, y: 438, width: 74, height: 24,
            text: "Крок ▶", fontSize: 12, onClick: () => this._setStep(this._step + 1),
        });
        this._autoButton = makeButton(canvas, {
            anchor: "top-left", x: 190, y: 438, width: 68, height: 24,
            text: "Авто ▶", fontSize: 12, onClick: () => this._toggleAuto(),
        });
        makeButton(canvas, {
            anchor: "top-left", x: 264, y: 438, width: 66, height: 24,
            text: "Скинути", fontSize: 12, onClick: () => this._setStep(0),
        });

        this._createCodonTable(canvas);
        this._createStrip(canvas);
    }

    /**
     * The codon table as the textbook prints it: four columns by the first
     * base, sixteen rows by the second and third.
     *
     * All 64 cells fit on screen at once, so there is nothing to scroll and
     * nothing to keep scrolled to the right place — the layout the students
     * already know is also the one with the fewest moving parts.
     */
    private _createCodonTable(canvas: GameObject): void {
        const top = 86;
        makePanel(canvas, {
            anchor: "top-right", x: 12, y: top - 24,
            width: 4 * CELL_W + 20, height: 16 * CELL_H + 40,
        });

        makeLabel(canvas, {
            anchor: "top-right", x: 22, y: top - 18, width: 4 * CELL_W, height: 18,
            text: "Генетичний код — усі 64 кодони", fontSize: 12, color: UI.textDim,
        });

        for (let first = 0; first < 4; first++) {
            for (let second = 0; second < 4; second++) {
                for (let third = 0; third < 4; third++) {
                    const codon = BASE_ORDER[first] + BASE_ORDER[second] + BASE_ORDER[third];
                    const row = second * 4 + third;
                    const label = makeLabel(canvas, {
                        anchor: "top-right",
                        x: 22 + (3 - first) * CELL_W,
                        y: top + 4 + row * CELL_H,
                        width: CELL_W, height: CELL_H,
                        text: `${codon} ${AMINO[CODON[codon]].code}`,
                        fontSize: 11, color: UI.textDim, wordWrap: false, outline: 1,
                    });
                    label.fontFamily = "monospace";
                    this._codonCells.set(codon, label);
                }
            }
        }
    }

    private _createStrip(canvas: GameObject): void {
        makePanel(canvas, { anchor: "bottom-center", y: 66, width: 900, height: 86 });

        const line = (y: number, color: Color): UIText => {
            const label = makeLabel(canvas, {
                anchor: "bottom-center", y, width: 880, height: 16,
                text: "", fontSize: 13, color, wordWrap: false,
                align: TextAlignment.Center, valign: VerticalAlignment.Middle,
            });
            label.fontFamily = "monospace";
            return label;
        };

        this._codingLine = line(124, UI.text);
        this._templateLine = line(108, UI.textDim);
        this._rnaLine = line(92, UI.accent);
        this._caretLine = line(76, new Color(1, 0.85, 0.35, 1));

        this._pickPanel = makePanel(canvas, { anchor: "bottom-center", y: 40, width: 900, height: 24 });
        this._pickText = makeLabel(canvas, {
            anchor: "bottom-center", y: 44, width: 880, height: 18,
            text: "", fontSize: 12, color: UI.accent, wordWrap: false,
            align: TextAlignment.Center, valign: VerticalAlignment.Middle,
        });
        this._setPickText("");

        this._hintText = makeLabel(canvas, {
            anchor: "bottom-center", y: 14, width: 1000, height: 18,
            text: "←/→ — крок   •   Пробіл — авто   •   Tab — режим   •   R — спочатку   "
                + "•   клік по основі — що це   •   миша — обертати та наближати",
            fontSize: 12, color: UI.textDim,
            align: TextAlignment.Center, valign: VerticalAlignment.Middle,
        });
    }

    // ── readouts ────────────────────────────────────────────────────

    private _refreshStrip(): void {
        this._codingLine.text = `кодуючий  5'-${inTriplets(this._coding)}-3'`;
        this._templateLine.text = `матричний 3'-${inTriplets(this._template)}-5'`;

        const shown = this._mode === "transcription" ? this._step : this._rna.length;
        this._rnaLine.text = `мРНК      5'-${inTriplets(this._rna.slice(0, shown))}`;

        // The strip is monospace and grouped in threes, so a caret is just the
        // right number of spaces. "кодуючий  5'-" is 13 characters wide.
        const lead = " ".repeat(13);
        if (this._mode === "transcription") {
            const i = this._step - 1;
            this._caretLine.text = i < 0 ? "" : lead + " ".repeat(i + Math.floor(i / 3)) + "▲";
        } else {
            const at = Math.min(this._step, this._codons.length - 1);
            this._caretLine.text = lead + " ".repeat(at * 4) + "▲▲▲";
        }
    }

    private _refreshCodonTable(): void {
        const at = this._mode === "translation"
            ? Math.min(this._step, this._codons.length - 1)
            : Math.floor((this._step - 1) / 3);
        const active = at >= 0 && at < this._codons.length && this._step > 0 ? this._codons[at] : "";

        for (const [codon, label] of this._codonCells) {
            const isCurrent = codon === active;
            label.color = isCurrent
                ? new Color(1, 0.85, 0.35, 1)
                : isStop(codon) ? new Color(0.85, 0.5, 0.5, 1) : UI.textDim;
            label.fontSize = isCurrent ? 12 : 11;
        }
    }

    /**
     * Writes the clicked-base readout, hiding its panel when there is nothing to
     * report -- an empty label still leaves a painted background behind.
     */
    private _setPickText(text: string): void {
        this._pickText.text = text;
        this._pickPanel.setActive(text.length > 0);
    }
}
