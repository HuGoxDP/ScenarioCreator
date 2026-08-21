// scripts/helpers/UIKit.ts
// ============================================================
// Small UI toolkit shared by the educational scenarios.
//
// The engine's RectTransform lays out in screen space with the Y axis
// pointing DOWN (Canvas 2D convention), and anchorMin/anchorMax map to the
// top/bottom edges respectively. The `Anchor` presets below hide that: an
// offset is always measured *inwards* from the named corner, so callers think
// in plain "24 px from the top-left" terms.
//
// COPIED, NOT SHARED. build-package.mjs compiles each scenario with
// `--rootDir <scenario>/scripts`, so a file outside that tree is a compile
// error — there is no shared folder to put this in. This copy adds the
// slider/toggle/dropdown/readout factories the original lacked; copy *this*
// version forward rather than the one in Molecules.
// ============================================================

import {
    GameObject, Canvas, CanvasScaler, RectTransform,
    UIText, UIImage, Button, Slider, Toggle, Dropdown,
    TextAlignment, VerticalAlignment, Color, Vector2,
} from "WebEngineTS";

// ==================== ANCHORS ====================

export type Anchor =
    | "top-left" | "top-center" | "top-right"
    | "center"
    | "bottom-left" | "bottom-center" | "bottom-right";

interface AnchorSpec {
    /** Anchor point, in RectTransform space (y: 0 = top, 1 = bottom). */
    a: Vector2;
    /** Pivot, in the same space. */
    p: Vector2;
    /** Sign applied to the caller's offset so it always points inwards. */
    sx: number;
    sy: number;
}

function anchorSpec(anchor: Anchor): AnchorSpec {
    switch (anchor) {
        case "top-left":      return { a: new Vector2(0, 0),     p: new Vector2(0, 0),     sx:  1, sy:  1 };
        case "top-center":    return { a: new Vector2(0.5, 0),   p: new Vector2(0.5, 0),   sx:  1, sy:  1 };
        case "top-right":     return { a: new Vector2(1, 0),     p: new Vector2(1, 0),     sx: -1, sy:  1 };
        case "center":        return { a: new Vector2(0.5, 0.5), p: new Vector2(0.5, 0.5), sx:  1, sy:  1 };
        case "bottom-left":   return { a: new Vector2(0, 1),     p: new Vector2(0, 1),     sx:  1, sy: -1 };
        case "bottom-center": return { a: new Vector2(0.5, 1),   p: new Vector2(0.5, 1),   sx:  1, sy: -1 };
        case "bottom-right":  return { a: new Vector2(1, 1),     p: new Vector2(1, 1),     sx: -1, sy: -1 };
    }
}

/** Placement of a UI element: corner to attach to, inward offset, and size. */
export interface Placement {
    anchor: Anchor;
    /** Inward offset from the anchor corner, in canvas units. */
    x?: number;
    y?: number;
    width: number;
    height: number;
}

function place(go: GameObject, parent: GameObject, p: Placement): RectTransform {
    go.transform.parent = parent.transform;

    const spec = anchorSpec(p.anchor);
    const rt = go.addComponent(RectTransform);
    rt.anchorMin = spec.a.clone();
    rt.anchorMax = spec.a.clone();
    rt.pivot = spec.p.clone();
    rt.anchoredPosition = new Vector2((p.x ?? 0) * spec.sx, (p.y ?? 0) * spec.sy);
    rt.sizeDelta = new Vector2(p.width, p.height);
    return rt;
}

// ==================== PALETTE ====================

/** Shared look so every scenario reads as one product. */
export const UI = {
    panelBg: new Color(0, 0, 0, 0.55),
    text: new Color(0.94, 0.96, 1, 1),
    textDim: new Color(0.72, 0.78, 0.88, 1),
    accent: new Color(0.45, 0.75, 1, 1),
    outline: new Color(0, 0, 0, 1),
    buttonNormal: new Color(0.16, 0.20, 0.28, 0.92),
    buttonHover: new Color(0.24, 0.32, 0.44, 0.95),
    buttonPressed: new Color(0.12, 0.15, 0.21, 0.95),
} as const;

// ==================== FACTORY ====================

/** Creates the UI root. Every widget must be parented to the returned object. */
export function createUICanvas(name: string = "UI Canvas"): GameObject {
    const go = new GameObject(name);
    go.addComponent(Canvas);
    go.addComponent(CanvasScaler);
    return go;
}

/** Options for {@link makeLabel}. */
export interface LabelOptions extends Placement {
    text: string;
    fontSize?: number;
    color?: Color;
    align?: TextAlignment;
    valign?: VerticalAlignment;
    wordWrap?: boolean;
    /** Outline width in px; 2 keeps text readable over any 3D background. */
    outline?: number;
}

export function makeLabel(parent: GameObject, opts: LabelOptions): UIText {
    const go = new GameObject("Label");
    place(go, parent, opts);

    const t = go.addComponent(UIText);
    t.text = opts.text;
    t.fontSize = opts.fontSize ?? 16;
    t.color = opts.color ?? UI.text;
    t.alignment = opts.align ?? TextAlignment.Left;
    t.verticalAlignment = opts.valign ?? VerticalAlignment.Top;
    t.wordWrap = opts.wordWrap ?? true;
    t.outlineWidth = opts.outline ?? 2;
    t.outlineColor = UI.outline;
    return t;
}

/** Options for {@link makePanel}. */
export interface PanelOptions extends Placement {
    color?: Color;
    radius?: number;
}

export function makePanel(parent: GameObject, opts: PanelOptions): GameObject {
    const go = new GameObject("Panel");
    place(go, parent, opts);

    const img = go.addComponent(UIImage);
    img.color = opts.color ?? UI.panelBg;
    img.borderRadius = opts.radius ?? 8;
    return go;
}

/** Options for {@link makeButton}. */
export interface ButtonOptions extends Placement {
    text: string;
    onClick: () => void;
    fontSize?: number;
    /** Overrides the resting colour — used to tint a table by category. */
    color?: Color;
}

export function makeButton(parent: GameObject, opts: ButtonOptions): Button {
    const go = new GameObject(`Button ${opts.text}`);
    place(go, parent, opts);

    const b = go.addComponent(Button);
    b.text = opts.text;
    b.fontSize = opts.fontSize ?? 15;
    b.textColor = UI.text;
    b.normalColor = opts.color ?? UI.buttonNormal;
    b.highlightedColor = UI.buttonHover;
    b.pressedColor = UI.buttonPressed;
    b.borderRadius = 6;
    b.onClick = opts.onClick;
    return b;
}

// ==================== CONTROLS ====================
//
// The four factories below are what the original UIKit lacked. All of them
// stack their parts downward from the placement's y, so they belong under a
// `top-*` anchor; under a `bottom-*` anchor the offsets still point inwards but
// the parts stack upward, which is rarely what a caller means.

/** A slider is a row: name on the left, live value on the right, track below. */
export interface SliderOptions extends Placement {
    label: string;
    min: number;
    max: number;
    value: number;
    wholeNumbers?: boolean;
    /** Formats the value shown at the right of the row. */
    format?: (value: number) => string;
    onChange: (value: number) => void;
}

export interface SliderRow {
    slider: Slider;
    /** Moves the handle *and* refreshes the readout without firing onChange. */
    set(value: number): void;
}

export function makeSlider(parent: GameObject, opts: SliderOptions): SliderRow {
    const format = opts.format ?? ((v: number) => (opts.wholeNumbers ? String(Math.round(v)) : v.toFixed(2)));
    const y = opts.y ?? 0;

    makeLabel(parent, {
        anchor: opts.anchor, x: opts.x, y,
        width: opts.width * 0.7, height: 18,
        text: opts.label, fontSize: 13, color: UI.textDim,
    });

    const valueText = makeLabel(parent, {
        anchor: opts.anchor, x: opts.x, y,
        width: opts.width, height: 18,
        text: format(opts.value), fontSize: 13, color: UI.accent,
        align: TextAlignment.Right,
    });

    const go = new GameObject(`Slider ${opts.label}`);
    place(go, parent, {
        anchor: opts.anchor, x: opts.x, y: y + 20,
        width: opts.width, height: opts.height,
    });

    const s = go.addComponent(Slider);
    s.minValue = opts.min;
    s.maxValue = opts.max;
    s.wholeNumbers = opts.wholeNumbers ?? false;
    s.value = opts.value;
    s.fillColor = UI.accent;
    s.backgroundColor = UI.buttonNormal;

    s.onValueChanged.addListener((v: number) => {
        valueText.text = format(v);
        opts.onChange(v);
    });

    return {
        slider: s,
        set(value: number): void {
            // Silent on purpose: the caller is reflecting state it just set
            // itself, and notifying here would run `onChange` a second time.
            //
            // Slider gained `setValueWithoutNotify` in engine
            // 0.1.0-local.1787254037912, matching Toggle, Dropdown and
            // Scrollbar. Before that this needed a suppression flag — see
            // entry 2 of docs/ENGINE-GAPS.md for what it replaced.
            s.setValueWithoutNotify(value);
            valueText.text = format(s.value);
        },
    };
}

/** Options for {@link makeToggle}. */
export interface ToggleOptions extends Placement {
    label: string;
    value: boolean;
    onChange: (on: boolean) => void;
}

export function makeToggle(parent: GameObject, opts: ToggleOptions): Toggle {
    const go = new GameObject(`Toggle ${opts.label}`);
    place(go, parent, opts);

    const t = go.addComponent(Toggle);
    t.label = opts.label;
    t.fontSize = 13;
    t.labelColor = UI.text;
    t.checkedColor = UI.accent;
    t.backgroundColor = UI.buttonNormal;
    t.setIsOnWithoutNotify(opts.value);
    t.onValueChanged.addListener(opts.onChange);
    return t;
}

/** Options for {@link makeDropdown}. */
export interface DropdownOptions extends Placement {
    options: string[];
    value: number;
    maxVisibleItems?: number;
    onChange: (index: number) => void;
}

export function makeDropdown(parent: GameObject, opts: DropdownOptions): Dropdown {
    const go = new GameObject("Dropdown");
    place(go, parent, opts);

    const d = go.addComponent(Dropdown);
    d.options = opts.options;
    d.fontSize = 13;
    d.maxVisibleItems = opts.maxVisibleItems ?? 6;
    d.backgroundColor = UI.buttonNormal;
    d.highlightColor = UI.buttonHover;
    d.textColor = UI.text;
    d.setValueWithoutNotify(opts.value);
    d.onValueChanged.addListener(opts.onChange);
    return d;
}

/** Options for {@link makeReadout}. */
export interface ReadoutOptions extends Placement {
    rows: number;
    fontSize?: number;
    rowHeight?: number;
    color?: Color;
}

/**
 * A fixed block of lines, addressed by index.
 *
 * A pool rather than text appended to one label: a readout that grows the
 * scene as it updates makes the scene-graph size depend on how long the
 * scenario has been open, which the render verification compares across load
 * paths.
 */
export function makeReadout(parent: GameObject, opts: ReadoutOptions): (row: number, text: string) => void {
    const rowHeight = opts.rowHeight ?? 18;
    const lines: UIText[] = [];

    for (let i = 0; i < opts.rows; i++) {
        lines.push(makeLabel(parent, {
            anchor: opts.anchor, x: opts.x, y: (opts.y ?? 0) + i * rowHeight,
            width: opts.width, height: rowHeight,
            text: "", fontSize: opts.fontSize ?? 14,
            color: opts.color ?? UI.text, wordWrap: false,
        }));
    }

    return (row: number, text: string): void => {
        const line = lines[row];
        if (line) line.text = text;
    };
}
