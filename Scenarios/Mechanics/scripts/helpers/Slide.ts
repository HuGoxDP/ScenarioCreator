// scripts/helpers/Slide.ts
// ============================================================
// The equation of motion for a block on an inclined plane, integrated here
// rather than handed to the engine's rigid-body solver.
//
// WHY NOT THE SOLVER. Originally because the engine could not carry μ into a
// contact at all: `PhysicMaterial.friction` was written onto a cannon-es
// `Material`, no `ContactMaterial` was ever registered for the pair, and every
// contact fell back to a fixed 0.3. **That was fixed in engine
// 0.1.0-local.1787254037912** — `Physics._registerMaterial` now pairs each
// material with every other and with itself, combining by average. Measured on
// a 30° ramp, a block travels 9.56 units at μ = 0.05 and 2.15 at μ = 0.9, where
// before the two were identical.
//
// So the solver is now an option, and this file still does not use it. The
// reason changed rather than disappeared:
//
//   `a = g(sin α − μ cos α)` is EXACT for an inclined plane. It is not an
//   approximation of what a contact solver would produce — the solver would be
//   the approximation, with its own timestep error. This scenario prints the
//   integrated v and s beside a·t and a·t²/2 and they agree to the digit, which
//   is the demonstration; routing it through a contact solver would put a small
//   unexplained gap between two columns whose agreement is the point.
//
// A scenario that needs genuinely emergent contact behaviour — a tumbling body,
// a stack, a collision — now has a route it did not have before, and should
// take it.
//
// No engine imports: this file is the physics, and it is checked in Node
// against the three claims the scenario makes.
// ============================================================

export type Phase = "rest" | "slope" | "ground" | "stopped";

export const PHASE_LABEL: Record<Phase, string> = {
    rest: "Спокій — тертя утримує",
    slope: "Ковзання по похилій",
    ground: "Гальмування на горизонталі",
    stopped: "Зупинився",
};

const RAD = Math.PI / 180;

/**
 * Does the block move at all?
 *
 * The threshold is `tan α > μ` and nothing else — not the mass, not gravity.
 * Crossing it with the angle slider is the scenario's first demonstration.
 */
export function slides(angleDeg: number, mu: number): boolean {
    return Math.tan(angleDeg * RAD) > mu;
}

/** `a = g(sin α − μ cos α)`, floored at zero: friction cannot drive a body uphill. */
export function slopeAcceleration(gravity: number, angleDeg: number, mu: number): number {
    const a = gravity * (Math.sin(angleDeg * RAD) - mu * Math.cos(angleDeg * RAD));
    return a > 0 ? a : 0;
}

/** On the flat, friction is all that acts along the direction of travel. */
export function groundDeceleration(gravity: number, mu: number): number {
    return gravity * mu;
}

export interface Forces {
    /** Weight, `m·g`. */
    weight: number;
    /** Normal reaction, `m·g·cos α`. */
    normal: number;
    /** Component of weight along the slope, `m·g·sin α`. */
    driving: number;
    /** The most friction this surface pair can supply, `μ·N`. */
    frictionMax: number;
    /**
     * What friction is actually doing right now.
     *
     * At rest it exactly cancels the driving force and is therefore *smaller*
     * than μN — drawing it at full length on a stationary block is the classic
     * wrong free-body diagram.
     */
    friction: number;
    /** Resultant along the slope. Zero whenever the block is at rest. */
    net: number;
}

export function forcesOn(mass: number, gravity: number, angleDeg: number, mu: number, moving: boolean): Forces {
    const weight = mass * gravity;
    const normal = weight * Math.cos(angleDeg * RAD);
    const driving = weight * Math.sin(angleDeg * RAD);
    const frictionMax = mu * normal;
    const friction = moving ? frictionMax : Math.min(driving, frictionMax);

    return { weight, normal, driving, frictionMax, friction, net: moving ? driving - frictionMax : 0 };
}

export interface SlideConfig {
    gravity: number;
    angleDeg: number;
    mu: number;
    /** Length of the ramp, metres. */
    slopeLength: number;
    /** Flat run after it, metres. */
    groundLength: number;
}

/**
 * One block, integrated at a fixed timestep.
 *
 * `distance` is measured along the whole path — down the ramp, then along the
 * ground — so the caller has a single number to place the block with.
 */
export class Slide {
    private _t = 0;
    private _s = 0;
    private _v = 0;
    private _phase: Phase = "rest";
    private _running = false;

    constructor(private _config: SlideConfig) {
        this.reset();
    }

    get time(): number { return this._t; }
    get distance(): number { return this._s; }
    get speed(): number { return this._v; }
    get phase(): Phase { return this._phase; }
    get moving(): boolean { return this._phase === "slope" || this._phase === "ground"; }

    /** Acceleration right now — zero at rest and while stopped. */
    get acceleration(): number {
        if (this._phase === "slope") return slopeAcceleration(this._config.gravity, this._config.angleDeg, this._config.mu);
        if (this._phase === "ground") return -groundDeceleration(this._config.gravity, this._config.mu);
        return 0;
    }

    configure(config: SlideConfig): void {
        this._config = config;
        this.reset();
    }

    reset(): void {
        this._t = 0;
        this._s = 0;
        this._v = 0;
        this._running = false;
        this._phase = "rest";
    }

    start(): void {
        this._running = true;
        if (this._phase === "rest" && slides(this._config.angleDeg, this._config.mu)) {
            this._phase = "slope";
        }
    }

    pause(): void {
        this._running = false;
    }

    step(dt: number): void {
        if (!this._running || this._phase === "rest" || this._phase === "stopped") return;

        this._t += dt;

        // Trapezoidal: `s += (v_old + v_new)/2 · dt`. Under constant
        // acceleration that is exact, so the distance readout agrees with the
        // a·t²/2 printed beside it instead of drifting a fraction of a percent
        // above it — and the two are shown side by side.
        if (this._phase === "slope") {
            const next = this._v + slopeAcceleration(this._config.gravity, this._config.angleDeg, this._config.mu) * dt;
            this._s += (this._v + next) * 0.5 * dt;
            this._v = next;
            if (this._s >= this._config.slopeLength) this._phase = "ground";
            return;
        }

        // On the flat: friction alone, so the block decelerates to a stop.
        const next = this._v - groundDeceleration(this._config.gravity, this._config.mu) * dt;
        if (next <= 0) {
            this._s += (this._v * this._v) / (2 * Math.max(groundDeceleration(this._config.gravity, this._config.mu), 1e-9));
            this._v = 0;
            this._phase = "stopped";
            return;
        }
        this._s += (this._v + next) * 0.5 * dt;
        this._v = next;

        // A frictionless block would coast forever; the bench has an end.
        if (this._s >= this._config.slopeLength + this._config.groundLength) {
            this._s = this._config.slopeLength + this._config.groundLength;
            this._v = 0;
            this._phase = "stopped";
        }
    }
}
