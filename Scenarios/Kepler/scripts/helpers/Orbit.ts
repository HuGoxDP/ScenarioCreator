// scripts/helpers/Orbit.ts
// ============================================================
// Two-body motion, integrated here rather than handed to the rigid-body
// solver — which has no inverse-square attraction, and reintroducing one
// through addForce every step would buy nothing but its timestep.
//
// UNITS: astronomical units and years, which makes GM = 4π² for the Sun.
// Working in metres and seconds would put 6.674e-11 and 1.989e30 on screen;
// in AU and years, Kepler's third law reads T² = a³ with no constant at all,
// and that is the form a student can check against the planets.
//
// THE INTEGRATOR IS VELOCITY VERLET, and that choice is the difference between
// a demonstration and a bug. Euler leaks energy: a circular orbit under it
// spirals visibly outward within a minute, and a student watching an orbit
// decay while nothing removes energy has been taught something false. Verlet
// is symplectic — the orbit stays closed.
//
// No engine imports: the mechanics is checked in Node before anything draws.
// ============================================================

/** Solar GM in AU³/year². */
export const GM = 4 * Math.PI * Math.PI;

export type Conic = "ellipse" | "parabola" | "hyperbola";

export const CONIC_LABEL: Record<Conic, string> = {
    ellipse: "еліпс — замкнена орбіта",
    parabola: "парабола — рівно друга космічна",
    hyperbola: "гіпербола — тіло йде назавжди",
};

/** `v = √(GM/r)` — the speed that makes a circle at radius `r`. */
export function circularSpeed(radius: number): number {
    return Math.sqrt(GM / radius);
}

/** `v = √(2GM/r)` — escape speed, exactly √2 times the circular one. */
export function escapeSpeed(radius: number): number {
    return Math.sqrt(2 * GM / radius);
}

export interface Elements {
    /** Distance from the focus. */
    radius: number;
    speed: number;
    /** Specific orbital energy `ε = v²/2 − GM/r`. Its sign is the conic. */
    energy: number;
    /** Specific angular momentum `L = x·v_y − y·v_x`. Constant, by Kepler 2. */
    angularMomentum: number;
    semiMajor: number;
    semiMinor: number;
    eccentricity: number;
    /** Years; Infinity for an open orbit. */
    period: number;
    periapsis: number;
    apoapsis: number;
    /** Direction of periapsis, as a unit vector. */
    periapsisDirection: [number, number];
    conic: Conic;
    /** `dA/dt = L/2` — Kepler's second law, in AU²/year. */
    areaRate: number;
}

/**
 * Orbital elements from one state vector.
 *
 * Everything below is derived from `ε` and `L` alone. That matters for the
 * escape-velocity demonstration: the sign of `ε` and the name of the conic
 * come from the same two numbers, so they cannot disagree about where the
 * threshold is.
 */
export function elementsOf(x: number, y: number, vx: number, vy: number): Elements {
    const radius = Math.hypot(x, y);
    const speed = Math.hypot(vx, vy);
    const energy = (speed * speed) / 2 - GM / radius;
    const angularMomentum = x * vy - y * vx;

    // e² = 1 + 2εL²/GM². Clamped at zero: a circular orbit lands a hair below
    // it in floating point and a negative square root is not a nicer answer.
    const eSquared = Math.max(0, 1 + (2 * energy * angularMomentum * angularMomentum) / (GM * GM));
    const eccentricity = Math.sqrt(eSquared);

    const conic: Conic = energy < -1e-9 ? "ellipse" : energy > 1e-9 ? "hyperbola" : "parabola";
    const semiMajor = conic === "parabola" ? Number.POSITIVE_INFINITY : -GM / (2 * energy);
    const semiMinor = conic === "ellipse" ? semiMajor * Math.sqrt(1 - eSquared) : Number.NaN;
    const period = conic === "ellipse" ? 2 * Math.PI * Math.sqrt(semiMajor ** 3 / GM) : Number.POSITIVE_INFINITY;

    // Eccentricity vector: points from the focus toward periapsis.
    const rv = x * vx + y * vy;
    const factor = speed * speed - GM / radius;
    const ex = (factor * x - rv * vx) / GM;
    const ey = (factor * y - rv * vy) / GM;
    const eLength = Math.hypot(ex, ey);
    const periapsisDirection: [number, number] = eLength > 1e-9
        ? [ex / eLength, ey / eLength]
        : [x / radius, y / radius];

    return {
        radius, speed, energy, angularMomentum,
        semiMajor, semiMinor, eccentricity, period,
        periapsis: conic === "parabola" ? radius : semiMajor * (1 - eccentricity),
        apoapsis: conic === "ellipse" ? semiMajor * (1 + eccentricity) : Number.POSITIVE_INFINITY,
        periapsisDirection,
        conic,
        areaRate: angularMomentum / 2,
    };
}

/** Points of the predicted orbit, for the dashed ellipse drawn over the trail. */
export function conicPoints(elements: Elements, count = 120): [number, number][] {
    if (elements.conic !== "ellipse") return [];

    const [ux, uy] = elements.periapsisDirection;
    const a = elements.semiMajor;
    const b = elements.semiMinor;
    const c = a * elements.eccentricity;
    const points: [number, number][] = [];

    for (let i = 0; i <= count; i++) {
        const t = (i / count) * Math.PI * 2;
        // Ellipse in its own frame, centred a distance c from the focus along
        // the periapsis direction, then rotated onto that direction.
        const px = a * Math.cos(t) - c;
        const py = b * Math.sin(t);
        points.push([px * ux - py * uy, px * uy + py * ux]);
    }
    return points;
}

// ==================== INTEGRATOR ====================

export type StopReason = "none" | "impact" | "escaped";

export class Orbit {
    x = 1;
    y = 0;
    vx = 0;
    vy = 0;
    time = 0;
    stopped: StopReason = "none";

    /** Radius of the central body; hitting it is the model's one singularity. */
    constructor(private readonly _bodyRadius: number, private readonly _farLimit: number) {}

    launch(radius: number, speed: number, angleDeg: number): void {
        this.x = -radius;
        this.y = 0;
        // Angle measured from the transverse direction, so 0° is a clean
        // sideways launch and 90° drops the body straight at the star.
        const angle = angleDeg * Math.PI / 180;
        this.vx = speed * Math.sin(angle);
        this.vy = -speed * Math.cos(angle);
        this.time = 0;
        this.stopped = "none";
    }

    get elements(): Elements {
        return elementsOf(this.x, this.y, this.vx, this.vy);
    }

    /**
     * Velocity Verlet, substepped.
     *
     * The step count rises near periapsis, where the acceleration is largest:
     * a fixed step that is fine at apoapsis will visibly cut the corner at
     * closest approach and slowly change the orbit it is meant to preserve.
     */
    step(dt: number): void {
        if (this.stopped !== "none" || dt <= 0) return;

        const radius = Math.hypot(this.x, this.y);
        const substeps = Math.max(1, Math.min(240, Math.ceil(dt / (0.0016 * radius ** 1.5))));
        const h = dt / substeps;

        for (let i = 0; i < substeps; i++) {
            let [ax, ay] = this._acceleration(this.x, this.y);

            this.x += this.vx * h + 0.5 * ax * h * h;
            this.y += this.vy * h + 0.5 * ay * h * h;

            const [nx, ny] = this._acceleration(this.x, this.y);
            this.vx += 0.5 * (ax + nx) * h;
            this.vy += 0.5 * (ay + ny) * h;

            ax = nx; ay = ny;
            this.time += h;

            const r = Math.hypot(this.x, this.y);
            if (r <= this._bodyRadius) { this.stopped = "impact"; return; }
            if (r >= this._farLimit) { this.stopped = "escaped"; return; }
        }
    }

    private _acceleration(x: number, y: number): [number, number] {
        const r = Math.hypot(x, y);
        const factor = -GM / (r * r * r);
        return [factor * x, factor * y];
    }
}

// ==================== KEPLER 3 ====================

export interface Planet {
    name: string;
    /** Semi-major axis, AU. */
    a: number;
    /** Orbital period, years. */
    period: number;
}

/** The eight planets, for the T² against a³ plot. */
export const PLANETS: Planet[] = [
    { name: "Меркурій", a: 0.387, period: 0.2408 },
    { name: "Венера", a: 0.723, period: 0.6152 },
    { name: "Земля", a: 1.000, period: 1.0000 },
    { name: "Марс", a: 1.524, period: 1.8808 },
    { name: "Юпітер", a: 5.203, period: 11.862 },
    { name: "Сатурн", a: 9.537, period: 29.457 },
    { name: "Уран", a: 19.191, period: 84.017 },
    { name: "Нептун", a: 30.070, period: 164.79 },
];

/**
 * Development guard, run once at load.
 *
 * Checks the three things the scenario claims: the circular speed really does
 * give `e ≈ 0`, the energy changes sign exactly at escape speed, and the real
 * planets obey `T² = a³` in these units — which is what makes the plot a
 * straight line rather than a shape.
 */
export function validateOrbits(): string[] {
    const problems: string[] = [];

    const circular = elementsOf(-1, 0, 0, -circularSpeed(1));
    if (circular.eccentricity > 1e-6) problems.push(`circular launch gives e = ${circular.eccentricity}`);
    if (Math.abs(circular.period - 1) > 1e-6) problems.push(`1 AU circular period = ${circular.period}, expected 1 year`);

    const belowEscape = elementsOf(-1, 0, 0, -escapeSpeed(1) * 0.999);
    const atEscape = elementsOf(-1, 0, 0, -escapeSpeed(1));
    const aboveEscape = elementsOf(-1, 0, 0, -escapeSpeed(1) * 1.001);
    if (belowEscape.energy >= 0) problems.push("below escape speed the energy is not negative");
    if (Math.abs(atEscape.energy) > 1e-9) problems.push(`at escape speed ε = ${atEscape.energy}, expected 0`);
    if (aboveEscape.energy <= 0) problems.push("above escape speed the energy is not positive");
    if (belowEscape.conic !== "ellipse" || aboveEscape.conic !== "hyperbola") {
        problems.push("conic classification disagrees with the sign of the energy");
    }

    for (const planet of PLANETS) {
        const ratio = (planet.period ** 2) / (planet.a ** 3);
        if (Math.abs(ratio - 1) > 0.01) {
            problems.push(`${planet.name}: T²/a³ = ${ratio.toFixed(4)}, expected 1`);
        }
    }
    return problems;
}
