// scripts/helpers/Painter.ts
// ============================================================
// A fixed pool of LineRenderers, reused every redraw.
//
// COPIED from Scenarios/Optics/helpers/Bench.ts, minus the lens and mirror
// shapes. A schematic is drawn in the same strokes a textbook uses, and a pool
// of a fixed size means the scene-graph size never depends on how many times a
// slider moved — which the render verification compares across load paths.
// ============================================================

import {
    GameObject, Vector3, Color, LineRenderer,
} from "WebEngineTS";

/** Renderers in the pool. The worst case — fan on, virtual image — is ~135. */
const POOL_SIZE = 200;

const DASH_LENGTH = 0.55;
const DASH_GAP = 0.4;
/** Dashes one construction line may spend, so a long one cannot drain the pool. */
const MAX_DASHES = 18;

export class Painter {
    private readonly _pool: LineRenderer[] = [];
    private _used = 0;

    constructor(root: GameObject) {
        for (let i = 0; i < POOL_SIZE; i++) {
            const go = new GameObject(`Line ${i}`);
            go.transform.parent = root.transform;
            const line = go.addComponent(LineRenderer);
            line.useWorldSpace = false;
            line.numCornerVertices = 2;
            go.setActive(false);
            this._pool.push(line);
        }
    }

    begin(): void {
        this._used = 0;
    }

    /** Hides whatever the previous frame drew and this one did not. */
    end(): void {
        for (let i = this._used; i < this._pool.length; i++) {
            this._pool[i].gameObject.setActive(false);
        }
    }

    line(x0: number, y0: number, x1: number, y1: number, color: Color, width = 0.06): void {
        const renderer = this._take(color, width);
        if (!renderer) return;
        renderer.setPositions([new Vector3(x0, y0, 0), new Vector3(x1, y1, 0)]);
    }

    polyline(points: number[][], color: Color, width = 0.06): void {
        const renderer = this._take(color, width);
        if (!renderer) return;
        renderer.setPositions(points.map((p) => new Vector3(p[0], p[1], 0)));
    }

    /**
     * A filled dot of the given radius, for marking a point rather than a path.
     *
     * Drawn as a small closed ring struck with a pen wider than the ring itself,
     * which fills the disc: the pool holds lines, and a line with width is the
     * only fill this has. The pen has to overshoot the centre — sized to meet it
     * exactly, anti-aliasing leaves a speck of background in the middle.
     */
    dot(x: number, y: number, radius: number, color: Color): void {
        // 13 steps around a circle of 12: the last retraces the first, so the
        // ribbon overlaps where it closes. Stopping exactly on the start leaves a
        // wedge there — the two ends are ribs facing different ways, and whatever
        // the dot was meant to cover shows through the gap.
        const points: number[][] = [];
        for (let i = 0; i <= 13; i++) {
            const angle = (i / 12) * Math.PI * 2;
            points.push([x + Math.cos(angle) * radius * 0.35, y + Math.sin(angle) * radius * 0.35]);
        }
        this.polyline(points, color, radius * 1.3);
    }

    /** A construction line: it carries no light, so it is never solid. */
    dashed(x0: number, y0: number, x1: number, y1: number, color: Color, width = 0.045): void {
        const dx = x1 - x0;
        const dy = y1 - y0;
        const length = Math.hypot(dx, dy);
        if (length < 1e-4) return;

        const step = DASH_LENGTH + DASH_GAP;
        const count = Math.min(Math.ceil(length / step), MAX_DASHES);
        const ux = dx / length;
        const uy = dy / length;
        const span = length / count;

        for (let i = 0; i < count; i++) {
            const start = i * span;
            const stop = start + Math.min(DASH_LENGTH, span * 0.65);
            this.line(x0 + ux * start, y0 + uy * start, x0 + ux * stop, y0 + uy * stop, color, width);
        }
    }

    /** An upright arrow on the axis at `x`, `height` tall; negative points down. */
    arrow(x: number, height: number, color: Color, width = 0.08, dash = false): void {
        const head = Math.min(Math.abs(height) * 0.28, 0.7);
        const dir = Math.sign(height) || 1;
        const tip = height;

        if (dash) {
            this.dashed(x, 0, x, tip, color, width);
            this.dashed(x, tip, x - head * 0.6, tip - head * dir, color, width);
            this.dashed(x, tip, x + head * 0.6, tip - head * dir, color, width);
            return;
        }
        this.line(x, 0, x, tip, color, width);
        this.line(x, tip, x - head * 0.6, tip - head * dir, color, width);
        this.line(x, tip, x + head * 0.6, tip - head * dir, color, width);
    }

    private _take(color: Color, width: number): LineRenderer | null {
        if (this._used >= this._pool.length) return null;
        const renderer = this._pool[this._used++];
        renderer.gameObject.setActive(true);
        renderer.startWidth = width;
        renderer.endWidth = width;
        renderer.startColor = color;
        renderer.endColor = color;
        return renderer;
    }
}
