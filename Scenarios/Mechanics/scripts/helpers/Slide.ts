// scripts/helpers/Slide.ts
// ============================================================
// The equation of motion for a block on an inclined plane, integrated here
// rather than handed to the engine's rigid-body solver.
//
// WHY NOT THE SOLVER. The scenario turns on one number — the coefficient of
// friction — and the engine cannot currently carry it into a contact.
// `PhysicMaterial(friction, bounciness)` writes `friction` onto a cannon-es
// `Material`, but cannon only uses a material's friction through a
// `ContactMaterial` registered for that *pair* of materials, and the engine
// never calls `world.addContactMaterial` (checked: zero call sites in
// `WebEngineTS.esm.js`). Every contact therefore falls back to
// `world.defaultContactMaterial`, which is a fixed friction of 0.3. A μ slider
// wired to `PhysicMaterial` would move and change nothing.
//
// That is an engine gap and is written up as one. Meanwhile the inclined plane
// is a closed-form problem — `a = g(sin α − μ cos α)` is exact, not an
// approximation of what a solver would produce — so integrating it directly
// costs the scenario nothing it was going to teach.
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
