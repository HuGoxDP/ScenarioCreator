// scripts/helpers/Bench.ts
// ============================================================
// Everything on the bench is drawn with lines.
//
// WHY NO MESHES. This is a ray diagram: a flat construction seen straight on,
// and the textbook draws it in exactly these strokes. Two things follow from
// that, and both are worth more than a solid model would be:
//
//   • The lens is its outline, so "thicker in the middle" versus "thinner in
//     the middle" is the shape itself rather than a shading cue that depends
//     on where the light is.
//   • Nothing here can be hidden behind anything else, and a construction line
//     is never confused with a surface.
//
// The pool is fixed-size and reused. A diagram that allocated per redraw would
// make the scene-graph size a function of how many times a slider moved, which
// the render verification compares across both load paths.
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

// ==================== SHAPES ====================

/**
 * Outline of a lens, as a closed loop.
 *
 * Converging: half-width falls to zero at the rim, so the body is thickest on
 * the axis. Diverging: the rim is the thickest part and the waist is thin.
 * Both are generated from one profile function, so the two shapes cannot drift
 * into being drawn by different rules.
 */
export function lensOutline(converging: boolean, halfHeight: number, centre: number, rim: number, segments = 28): number[][] {
    const points: number[][] = [];
    const halfWidth = (t: number): number => {
        const round = Math.sqrt(Math.max(0, 1 - t * t));
        return converging ? (centre / 2) * round : rim / 2 - ((rim - centre) / 2) * round;
    };

    for (let i = 0; i <= segments; i++) {
        const t = -1 + (2 * i) / segments;
        points.push([halfWidth(t), t * halfHeight]);
    }
    for (let i = segments; i >= 0; i--) {
        const t = -1 + (2 * i) / segments;
        points.push([-halfWidth(t), t * halfHeight]);
    }
    points.push(points[0]);
    return points;
}

/**
 * The reflecting arc of a mirror.
 *
 * A mirror of focal length f has radius of curvature R = 2f, and its centre of
 * curvature sits on the object's side for a concave mirror. That is the whole
 * difference between the two, and it is one sign.
 */
export function mirrorArc(focal: number, halfHeight: number, segments = 24): number[][] {
    const radius = Math.abs(2 * focal);
    const centre = focal > 0 ? -radius : radius;
    const points: number[][] = [];

    for (let i = 0; i <= segments; i++) {
        const y = halfHeight * (-1 + (2 * i) / segments);
        const dx = Math.sqrt(Math.max(0, radius * radius - y * y));
        points.push([centre + (focal > 0 ? dx : -dx), y]);
    }
    return points;
}

/** Short strokes on the back of a mirror, the way a diagram marks the silvering. */
export function mirrorHatching(arc: number[][], length = 0.5): number[][][] {
    const strokes: number[][][] = [];
    for (let i = 1; i < arc.length; i += 3) {
        const [x, y] = arc[i];
        const [px, py] = arc[i - 1];
        const nx = y - py;
        const ny = -(x - px);
        const norm = Math.hypot(nx, ny) || 1;
        strokes.push([[x, y], [x + (nx / norm) * length, y + (ny / norm) * length]]);
    }
    return strokes;
}
