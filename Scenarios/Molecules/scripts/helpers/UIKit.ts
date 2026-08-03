// scripts/helpers/UIKit.ts
// ============================================================
// Small UI toolkit shared by the educational scenarios.
//
// The engine's RectTransform lays out in screen space with the Y axis
// pointing DOWN (Canvas 2D convention), and anchorMin/anchorMax map to the
// top/bottom edges respectively. The `Anchor` presets below hide that: an
// offset is always measured *inwards* from the named corner, so callers think
// in plain "24 px from the top-left" terms.
// ============================================================

import {
    GameObject, Canvas, CanvasScaler, RectTransform,
    UIText, UIImage, Button,
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
}

export function makeButton(parent: GameObject, opts: ButtonOptions): Button {
    const go = new GameObject(`Button ${opts.text}`);
    place(go, parent, opts);

    const b = go.addComponent(Button);
    b.text = opts.text;
    b.fontSize = opts.fontSize ?? 15;
    b.textColor = UI.text;
    b.normalColor = UI.buttonNormal;
    b.highlightedColor = UI.buttonHover;
    b.pressedColor = UI.buttonPressed;
    b.borderRadius = 6;
    b.onClick = opts.onClick;
    return b;
}
