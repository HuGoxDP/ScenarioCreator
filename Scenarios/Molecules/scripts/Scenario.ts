// scripts/Scenario.ts  (Молекулярні моделі)
// ============================================================
// Interactive ball-and-stick models of four common molecules.
//
// Geometry is fully procedural — atoms are spheres, bonds are cylinders
// oriented between atom centres — so the scenario ships without any assets.
// Atom positions are computed from the real bond angles and bond lengths
// listed in MOLECULES, scaled uniformly for display.
// ============================================================

import {
    ScenarioBehaviour, GameObject, Vector3, Quaternion, Color,
    MeshFilter, MeshRenderer, Mesh, StandardMaterial,
    DirectionalLight, AmbientLight,
    Input, KeyCode,
    TextAlignment, VerticalAlignment,
    UIText,
} from "WebEngineTS";

import { createCameraRig, type ICameraRig } from "./helpers/CameraSetup";
import {
    createUICanvas, makeLabel, makePanel, makeButton, UI,
} from "./helpers/UIKit";
import { Rotator } from "./components/Rotator";

// ==================== CHEMISTRY DATA ====================

/** CPK colouring — the convention used in chemistry textbooks. */
const ELEMENT = {
    H: { color: new Color(0.95, 0.95, 0.95, 1), radius: 0.26, name: "Гідроген" },
    C: { color: new Color(0.25, 0.25, 0.28, 1), radius: 0.40, name: "Карбон" },
    N: { color: new Color(0.20, 0.35, 0.85, 1), radius: 0.38, name: "Нітроген" },
    O: { color: new Color(0.85, 0.20, 0.15, 1), radius: 0.36, name: "Оксиген" },
} as const;

type ElementKey = keyof typeof ELEMENT;

interface Atom {
    element: ElementKey;
    position: Vector3;
}

interface MoleculeDef {
    formula: string;
    name: string;
    geometry: string;
    bondAngle: string;
    bondType: string;
    fact: string;
    atoms: Atom[];
    /** Index pairs into `atoms`. */
    bonds: [number, number][];
    /** Number of parallel sticks drawn per bond: 1 single, 2 double. */
    bondOrder: number;
}

/** Display scale applied to the bond lengths below (given in ångström). */
const SCALE = 2.2;

function v(x: number, y: number, z: number): Vector3 {
    return new Vector3(x * SCALE, y * SCALE, z * SCALE);
}

// H2O — bent, H–O–H = 104.5°, O–H = 0.96 Å.
const HALF_H2O = (104.5 / 2) * (Math.PI / 180);
const L_OH = 0.96;

// CH4 — tetrahedral, H–C–H = 109.5°, C–H = 1.09 Å; vertices of a cube diagonal.
const L_CH = 1.09;
const T = 1 / Math.sqrt(3);

// CO2 — linear, O=C=O = 180°, C=O = 1.16 Å.
const L_CO = 1.16;

// NH3 — trigonal pyramidal, H–N–H = 107°, N–H = 1.01 Å.
// For three equivalent bonds at mutual angle α, each makes angle β with the
// symmetry axis where cos α = 1.5·cos²β − 0.5.
const L_NH = 1.01;
const COS_B = Math.sqrt((Math.cos(107 * Math.PI / 180) + 0.5) / 1.5);
const SIN_B = Math.sqrt(1 - COS_B * COS_B);

const MOLECULES: MoleculeDef[] = [
    {
        formula: "H₂O",
        name: "Вода",
        geometry: "Кутова",
        bondAngle: "104,5°",
        bondType: "Ковалентний полярний",
        fact: "Кут менший за тетраедричний через дві неподілені пари електронів на Оксигені.",
        atoms: [
            { element: "O", position: v(0, 0, 0) },
            { element: "H", position: v(L_OH * Math.sin(HALF_H2O), L_OH * Math.cos(HALF_H2O), 0) },
            { element: "H", position: v(-L_OH * Math.sin(HALF_H2O), L_OH * Math.cos(HALF_H2O), 0) },
        ],
        bonds: [[0, 1], [0, 2]],
        bondOrder: 1,
    },
    {
        formula: "CH₄",
        name: "Метан",
        geometry: "Тетраедрична",
        bondAngle: "109,5°",
        bondType: "Ковалентний неполярний",
        fact: "Усі чотири зв'язки рівноцінні, тому молекула не має дипольного моменту.",
        atoms: [
            { element: "C", position: v(0, 0, 0) },
            { element: "H", position: v(L_CH * T, L_CH * T, L_CH * T) },
            { element: "H", position: v(L_CH * T, -L_CH * T, -L_CH * T) },
            { element: "H", position: v(-L_CH * T, L_CH * T, -L_CH * T) },
            { element: "H", position: v(-L_CH * T, -L_CH * T, L_CH * T) },
        ],
        bonds: [[0, 1], [0, 2], [0, 3], [0, 4]],
        bondOrder: 1,
    },
    {
        formula: "CO₂",
        name: "Карбон діоксид",
        geometry: "Лінійна",
        bondAngle: "180°",
        bondType: "Подвійний ковалентний",
        fact: "Зв'язки полярні, але через симетрію їх дипольні моменти взаємно компенсуються.",
        atoms: [
            { element: "C", position: v(0, 0, 0) },
            { element: "O", position: v(L_CO, 0, 0) },
            { element: "O", position: v(-L_CO, 0, 0) },
        ],
        bonds: [[0, 1], [0, 2]],
        bondOrder: 2,
    },
    {
        formula: "NH₃",
        name: "Амоніак",
        geometry: "Тригональна пірамідальна",
        bondAngle: "107°",
        bondType: "Ковалентний полярний",
        fact: "Неподілена пара на Нітрогені стискає кут і робить молекулу донором електронів у реакціях.",
        atoms: [
            { element: "N", position: v(0, 0, 0) },
            { element: "H", position: v(L_NH * SIN_B, -L_NH * COS_B, 0) },
            { element: "H", position: v(L_NH * SIN_B * Math.cos(2.0944), -L_NH * COS_B, L_NH * SIN_B * Math.sin(2.0944)) },
            { element: "H", position: v(L_NH * SIN_B * Math.cos(4.1888), -L_NH * COS_B, L_NH * SIN_B * Math.sin(4.1888)) },
        ],
        bonds: [[0, 1], [0, 2], [0, 3]],
        bondOrder: 1,
    },
];

// ==================== SCENARIO ====================

export default class MoleculeViewer extends ScenarioBehaviour {
    private _camera!: ICameraRig;
    private _roots: GameObject[] = [];
    private _rotators: Rotator[] = [];
    private _current = 0;
    private _paused = false;

    // UI fields refreshed on every selection change.
    private _formulaText!: UIText;
    private _nameText!: UIText;
    private _infoText!: UIText;
    private _hintText!: UIText;

    private _bondMesh!: Mesh;
    private _atomMesh!: Mesh;

    override async awake(): Promise<void> {
        this._camera = createCameraRig({
            useSkybox: false,
            orbitDistance: 9,
            orbitMaxDistance: 30,
            backgroundColor: new Color(0.05, 0.06, 0.10, 1),
        });

        this._createLights();

        // One mesh per primitive kind, shared by every atom and bond: the whole
        // scene is a handful of draw calls regardless of molecule complexity.
        this._atomMesh = Mesh.createSphere(1, 24);
        this._bondMesh = Mesh.createCylinder(0.08, 1, 12);

        for (const def of MOLECULES) {
            this._roots.push(this._buildMolecule(def));
        }

        this._createUI();
        this._select(0);
    }

    override update(): void {
        if (Input.getKeyDown(KeyCode.Digit1)) this._select(0);
        if (Input.getKeyDown(KeyCode.Digit2)) this._select(1);
        if (Input.getKeyDown(KeyCode.Digit3)) this._select(2);
        if (Input.getKeyDown(KeyCode.Digit4)) this._select(3);

        if (Input.getKeyDown(KeyCode.KeyP)) {
            this._paused = !this._paused;
            for (const r of this._rotators) r.paused = this._paused;
            this._hintText.text = this._hintLine();
        }
    }

    // ── scene construction ──────────────────────────────────────────

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

    private _buildMolecule(def: MoleculeDef): GameObject {
        const root = new GameObject(def.name);
        const rot = root.addComponent(Rotator) as Rotator;
        rot.speed = 14;
        this._rotators.push(rot);

        for (const atom of def.atoms) {
            const info = ELEMENT[atom.element];
            const go = new GameObject(atom.element);
            go.transform.parent = root.transform;
            go.transform.localPosition = atom.position;
            go.transform.localScale = new Vector3(info.radius, info.radius, info.radius);

            go.addComponent(MeshFilter).sharedMesh = this._atomMesh;
            const mat = new StandardMaterial();
            mat.albedoColor = info.color;
            mat.smoothness = 0.55;
            mat.metallic = 0.05;
            go.addComponent(MeshRenderer).sharedMaterial = mat;
        }

        const bondMat = new StandardMaterial();
        bondMat.albedoColor = new Color(0.72, 0.74, 0.80, 1);
        bondMat.smoothness = 0.4;

        for (const [a, b] of def.bonds) {
            const from = def.atoms[a].position;
            const to = def.atoms[b].position;

            // A double bond is drawn as two sticks offset perpendicular to it.
            for (let k = 0; k < def.bondOrder; k++) {
                const offset = def.bondOrder === 1
                    ? Vector3.zero
                    : this._perpendicular(from, to).multiplyScalar(k === 0 ? 0.12 : -0.12);
                this._buildBond(root, from, to, offset, bondMat);
            }
        }

        root.setActive(false);
        return root;
    }

    private _buildBond(
        root: GameObject, from: Vector3, to: Vector3, offset: Vector3, mat: StandardMaterial,
    ): void {
        const dir = to.clone().subtract(from);
        const length = dir.magnitude();
        if (length <= 0) return;

        const go = new GameObject("Bond");
        go.transform.parent = root.transform;
        go.transform.localPosition = from.clone().add(to).multiplyScalar(0.5).add(offset);

        // The cylinder mesh is Y-up; rotate that axis onto the bond direction.
        go.transform.localRotation = Quaternion.fromToRotation(Vector3.up, dir.normalized);
        go.transform.localScale = new Vector3(1, length, 1);

        go.addComponent(MeshFilter).sharedMesh = this._bondMesh;
        go.addComponent(MeshRenderer).sharedMaterial = mat;
    }

    /** Any unit vector perpendicular to the segment, used to offset double bonds. */
    private _perpendicular(from: Vector3, to: Vector3): Vector3 {
        const dir = to.clone().subtract(from).normalized;
        const reference = Math.abs(dir.y) > 0.9 ? Vector3.right : Vector3.up;
        return Vector3.cross(dir, reference).normalized;
    }

    // ── UI ──────────────────────────────────────────────────────────

    private _createUI(): void {
        const canvas = createUICanvas();

        makeLabel(canvas, {
            anchor: "top-center", y: 18, width: 700, height: 40,
            text: "Молекулярні моделі",
            fontSize: 28, align: TextAlignment.Center, valign: VerticalAlignment.Middle,
        });

        // Info panel (left).
        makePanel(canvas, { anchor: "top-left", x: 20, y: 74, width: 330, height: 250 });

        this._formulaText = makeLabel(canvas, {
            anchor: "top-left", x: 36, y: 88, width: 300, height: 46,
            text: "", fontSize: 34, color: UI.accent,
        });

        this._nameText = makeLabel(canvas, {
            anchor: "top-left", x: 36, y: 134, width: 300, height: 26,
            text: "", fontSize: 19,
        });

        this._infoText = makeLabel(canvas, {
            anchor: "top-left", x: 36, y: 168, width: 300, height: 148,
            text: "", fontSize: 14, color: UI.textDim,
        });

        // Molecule buttons (bottom-centre row).
        const total = MOLECULES.length;
        const btnW = 120;
        const gap = 10;
        const rowW = total * btnW + (total - 1) * gap;
        for (let i = 0; i < total; i++) {
            makeButton(canvas, {
                anchor: "bottom-center",
                x: -rowW / 2 + btnW / 2 + i * (btnW + gap),
                y: 58,
                width: btnW, height: 36,
                text: `${i + 1}. ${MOLECULES[i].formula}`,
                onClick: () => this._select(i),
            });
        }

        this._hintText = makeLabel(canvas, {
            anchor: "bottom-center", y: 20, width: 700, height: 22,
            text: this._hintLine(),
            fontSize: 13, color: UI.textDim,
            align: TextAlignment.Center, valign: VerticalAlignment.Middle,
        });
    }

    private _hintLine(): string {
        return `1–4 — вибір молекули   •   P — ${this._paused ? "продовжити" : "пауза"} обертання`
            + "   •   миша — обертати та наближати";
    }

    private _select(index: number): void {
        if (index < 0 || index >= MOLECULES.length) return;
        this._current = index;

        for (let i = 0; i < this._roots.length; i++) {
            this._roots[i].setActive(i === index);
        }

        const def = MOLECULES[index];
        this._formulaText.text = def.formula;
        this._nameText.text = def.name;
        this._infoText.text =
            `Геометрія: ${def.geometry}\n`
            + `Валентний кут: ${def.bondAngle}\n`
            + `Тип зв'язку: ${def.bondType}\n`
            + `Атомів: ${def.atoms.length}\n\n`
            + def.fact;
    }
}
