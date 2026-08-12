// scripts/helpers/Rays.ts
// ============================================================
// SIGN CONVENTION — decided once, and everything downstream depends on it.
//
//   • The optical axis is world X; light travels +X; the element sits at x = 0.
//   • d  — object distance, POSITIVE to the left of the element.
//   • d′ — image distance, POSITIVE on the far side (a real image).
//   • f  — POSITIVE for a converging lens and a concave mirror,
//          NEGATIVE for a diverging lens and a convex mirror.
//   • 1/f = 1/d + 1/d′   →   d′ = d·f / (d − f)
//   • Γ = −d′/d.  Negative Γ means the image is inverted.
//
// A mirror obeys the same equation; the only difference is that its light
// folds back. Everything here is therefore solved in "unfolded" lens space and
// the caller mirrors the X coordinate — see `pointAt`. Deriving mirrors
// separately would be a second set of signs to keep straight, and they would
// drift apart.
//
// Pure functions, no engine types: this file is the physics, and it can be
// checked against the textbook table without a renderer.
// ============================================================

export type ElementKind = "converging" | "diverging" | "concaveMirror" | "convexMirror";

export const ELEMENT_LABEL: Record<ElementKind, string> = {
    converging: "Збиральна лінза",
    diverging: "Розсіювальна лінза",
    concaveMirror: "Увігнуте дзеркало",
    convexMirror: "Опукле дзеркало",
};

export function isMirror(kind: ElementKind): boolean {
    return kind === "concaveMirror" || kind === "convexMirror";
}

/** Converging elements take a positive focal length, diverging a negative one. */
export function signedFocal(kind: ElementKind, magnitude: number): number {
    return kind === "diverging" || kind === "convexMirror" ? -magnitude : magnitude;
}

/**
 * How close d may come to f before the image is called "at infinity".
 *
 * Without this, d = f divides by zero and the readout shows `Infinity` — which
 * is arithmetically honest and pedagogically useless. The band is in world
 * units, so it is a real distance on the bench rather than a float epsilon.
 */
const PARALLEL_BAND = 0.35;

export interface RayPath {
    /** Object tip → the element. */
    incoming: [number, number, number, number];
    /** The element → out of frame, already folded for a mirror. */
    outgoing: [number, number, number, number];
    /** Backwards construction line to a virtual image, or null. */
    back: [number, number, number, number] | null;
}

export interface Solution {
    d: number;
    f: number;
    h: number;
    reflect: boolean;
    /** d ≈ f: the outgoing rays are parallel and there is no image. */
    parallel: boolean;
    dPrime: number;
    hPrime: number;
    magnification: number;
    real: boolean;
    upright: boolean;
    /** |Γ| > 1. */
    magnified: boolean;
    imageX: number;
    imageY: number;
    rays: RayPath[];
}

/** Folds a point from unfolded lens space into the scene. */
export function pointAt(t: number, y: number, reflect: boolean): [number, number] {
    return [reflect ? -t : t, y];
}

/**
 * Solves one configuration and builds the three principal rays.
 *
 * The rays are not three special cases: every one of them is the same paraxial
 * transfer, `m₂ = m₁ − y₁/f`, applied to a different incoming slope. Writing it
 * once is what makes the diverging lens and the two mirrors fall out for free
 * instead of needing their own constructions.
 */
export function solve(kind: ElementKind, focalMagnitude: number, d: number, h: number, reach: number): Solution {
    const f = signedFocal(kind, focalMagnitude);
    const reflect = isMirror(kind);
    const parallel = Math.abs(d - f) < PARALLEL_BAND;

    const dPrime = parallel ? Number.POSITIVE_INFINITY : (d * f) / (d - f);
    const magnification = parallel ? Number.NEGATIVE_INFINITY : -dPrime / d;
    const hPrime = h * magnification;

    const slopes: number[] = [
        // Parallel to the axis → through the far focus.
        0,
        // Through the optical centre → undeviated.
        -h / d,
    ];
    // Through the near focus → out parallel. Undefined exactly at d = f, where
    // that ray would be vertical; the other two still define the diagram.
    if (!parallel) slopes.push(-h / (d - f));

    const rays: RayPath[] = slopes.map((slope) => {
        const y1 = h + slope * d;
        const exit = slope - y1 / f;

        const start = pointAt(-d, h, reflect);
        const hit = pointAt(0, y1, reflect);
        const far = pointAt(reach, y1 + exit * reach, reflect);

        // A virtual image is where the outgoing rays *appear* to come from, so
        // the construction line runs backwards from the element to it.
        const back = !parallel && dPrime < 0
            ? (() => {
                const tail = pointAt(dPrime, y1 + exit * dPrime, reflect);
                return [hit[0], hit[1], tail[0], tail[1]] as [number, number, number, number];
            })()
            : null;

        return {
            incoming: [start[0], start[1], hit[0], hit[1]],
            outgoing: [hit[0], hit[1], far[0], far[1]],
            back,
        };
    });

    const image = parallel ? [0, 0] : pointAt(dPrime, hPrime, reflect);

    return {
        d, f, h, reflect, parallel,
        dPrime, hPrime, magnification,
        real: !parallel && dPrime > 0,
        upright: magnification > 0,
        magnified: Math.abs(magnification) > 1,
        imageX: image[0],
        imageY: image[1],
        rays,
    };
}

/**
 * A fan of rays from the object tip through the whole aperture.
 *
 * They must all meet where the three principal rays said the image is. That
 * agreement is the proof the construction is not a special case, so the fan is
 * built from the same transfer rule rather than from the answer.
 */
export function fan(kind: ElementKind, focalMagnitude: number, d: number, h: number, aperture: number, count: number, reach: number): RayPath[] {
    const f = signedFocal(kind, focalMagnitude);
    const reflect = isMirror(kind);
    const out: RayPath[] = [];

    for (let i = 0; i < count; i++) {
        const y1 = aperture * (2 * (i / (count - 1)) - 1);
        const slope = (y1 - h) / d;
        const exit = slope - y1 / f;

        const start = pointAt(-d, h, reflect);
        const hit = pointAt(0, y1, reflect);
        const far = pointAt(reach, y1 + exit * reach, reflect);

        out.push({
            incoming: [start[0], start[1], hit[0], hit[1]],
            outgoing: [hit[0], hit[1], far[0], far[1]],
            back: null,
        });
    }
    return out;
}
