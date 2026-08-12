// scripts/helpers/GasSim.ts
// ============================================================
// A box of molecules, integrated here rather than handed to the rigid-body
// solver. Three reasons, in order of weight:
//
//   1. Determinism. A seeded generator plus explicit integration gives it
//      exactly; a contact solver does not, and the render verification
//      compares the scene across both load paths.
//   2. Six hundred rigid bodies is a lot of solver for a problem whose exact
//      answer is three lines of vector algebra.
//   3. The pressure measurement needs the wall impulse in this file. Reading it
//      back out of a general solver is harder than doing the reflection here.
//
// UNITS ARE REAL SI. The molecules are nitrogen (m = 4.65e-26 kg) in a box
// twenty nanometres across, so the pressure that comes out is in pascals and
// the temperature in kelvin — numbers a student can check against a textbook
// rather than "simulation units". Only time is scaled: one second of wall
// clock is TIME_COMPRESSION seconds of gas, or nothing would be visible.
//
// No engine imports: this is the physics, and it is checked in Node against
// the gas laws before anything draws it.
// ============================================================

export const BOLTZMANN = 1.380649e-23;
/** Nitrogen molecule. */
export const MOLECULE_MASS = 4.65e-26;

/** Box edge in x and y; z is the piston axis. */
export const BOX_EDGE = 20e-9;

/**
 * Collision radius, which is also the drawn radius.
 *
 * Far larger than a real N₂ molecule (~0.15 nm). Real molecules at this density
 * would have a mean free path several times the box and would almost never
 * meet, so the Maxwell distribution would never form on screen. The scenario
 * says so in words rather than pretending otherwise.
 */
export const MOLECULE_RADIUS = 0.32e-9;

/** One second of wall clock is this many seconds of gas. */
const TIME_COMPRESSION = 1.2e-11;

/** Substeps per frame. Displacement per substep stays well under one radius. */
const SUBSTEPS = 4;

/** How fast the piston travels, in box fractions per wall second. */
const PISTON_SPEED = 0.35;

/** Wall-clock time constant of the thermostat. */
const THERMOSTAT_TAU = 1.5;

/** Wall-clock length of the pressure averaging window. */
const PRESSURE_WINDOW = 0.25;

export const MAX_COUNT = 600;

/** The Brownian particle: this many molecular masses, this many radii. */
const HEAVY_MASS_FACTOR = 220;
const HEAVY_RADIUS_FACTOR = 3.4;

/** Deterministic generator — same seed, same gas, every run. */
export function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Maxwell–Boltzmann speed density, for the curve drawn over the histogram. */
export function maxwellDensity(speed: number, temperature: number, mass = MOLECULE_MASS): number {
    const a = mass / (2 * Math.PI * BOLTZMANN * temperature);
    return 4 * Math.PI * Math.pow(a, 1.5) * speed * speed
        * Math.exp(-mass * speed * speed / (2 * BOLTZMANN * temperature));
}

export function rmsSpeed(temperature: number, mass = MOLECULE_MASS): number {
    return Math.sqrt(3 * BOLTZMANN * temperature / mass);
}

export function meanSpeed(temperature: number, mass = MOLECULE_MASS): number {
    return Math.sqrt(8 * BOLTZMANN * temperature / (Math.PI * mass));
}

export function mostProbableSpeed(temperature: number, mass = MOLECULE_MASS): number {
    return Math.sqrt(2 * BOLTZMANN * temperature / mass);
}

export class GasSim {
    readonly position = new Float64Array(MAX_COUNT * 3);
    readonly velocity = new Float64Array(MAX_COUNT * 3);
    readonly mass = new Float64Array(MAX_COUNT);
    readonly radius = new Float64Array(MAX_COUNT);

    private _count = 300;
    private _boxZ = BOX_EDGE;
    private _targetFraction = 1;
    private _targetTemperature = 300;
    private _heavy = -1;

    private _impulse = 0;
    private _windowSimTime = 0;
    private _windowWallTime = 0;
    private _pressure = 0;

    /** Grid used to find collision partners; sized for the fullest box. */
    private readonly _head: Int32Array;
    private readonly _next = new Int32Array(MAX_COUNT);
    private readonly _cells: number;
    private readonly _gridN: number;

    private _rng: () => number;
    private _seed: number;

    constructor(seed = 12345) {
        this._seed = seed;
        this._rng = mulberry32(seed);

        // One cell per collision diameter: a pair can then only be in the 27
        // cells around it, and the search never depends on the count.
        this._gridN = Math.max(1, Math.floor(BOX_EDGE / (2 * MOLECULE_RADIUS * HEAVY_RADIUS_FACTOR)));
        this._cells = this._gridN * this._gridN * this._gridN;
        this._head = new Int32Array(this._cells);

        this.reset(false);
    }

    get count(): number { return this._count; }
    get boxZ(): number { return this._boxZ; }
    get volume(): number { return BOX_EDGE * BOX_EDGE * this._boxZ; }
    get heavyIndex(): number { return this._heavy; }
    get targetTemperature(): number { return this._targetTemperature; }

    /** Wall area the pressure is measured over. */
    get area(): number {
        return 2 * (BOX_EDGE * BOX_EDGE + 2 * BOX_EDGE * this._boxZ);
    }

    /** `T = m⟨v²⟩ / 3k` — measured from the molecules, not read off the slider. */
    get temperature(): number {
        let sum = 0;
        for (let i = 0; i < this._count; i++) {
            if (i === this._heavy) continue;
            const o = i * 3;
            sum += this.velocity[o] ** 2 + this.velocity[o + 1] ** 2 + this.velocity[o + 2] ** 2;
        }
        const n = this._heavy >= 0 ? this._count - 1 : this._count;
        return n === 0 ? 0 : MOLECULE_MASS * (sum / n) / (3 * BOLTZMANN);
    }

    /** Measured from wall impulses: `P = Σ|Δp| / (Δt·A)`. */
    get pressure(): number { return this._pressure; }

    /** `P = NkT/V` at the temperature the gas actually has. */
    get idealPressure(): number {
        return this._count * BOLTZMANN * this.temperature / this.volume;
    }

    get rms(): number {
        let sum = 0;
        for (let i = 0; i < this._count; i++) {
            if (i === this._heavy) continue;
            const o = i * 3;
            sum += this.velocity[o] ** 2 + this.velocity[o + 1] ** 2 + this.velocity[o + 2] ** 2;
        }
        const n = this._heavy >= 0 ? this._count - 1 : this._count;
        return n === 0 ? 0 : Math.sqrt(sum / n);
    }

    speedOf(index: number): number {
        const o = index * 3;
        return Math.hypot(this.velocity[o], this.velocity[o + 1], this.velocity[o + 2]);
    }

    setCount(count: number): void {
        this._count = Math.max(2, Math.min(Math.round(count), MAX_COUNT));
        this.reset(false);
    }

    setTargetTemperature(temperature: number): void {
        this._targetTemperature = temperature;
    }

    setVolumeFraction(fraction: number): void {
        this._targetFraction = Math.max(0.3, Math.min(fraction, 1));
    }

    setBrownian(on: boolean): void {
        this._heavy = on ? 0 : -1;
        this.reset(false);
    }

    /**
     * @param equalSpeeds give every molecule the same speed instead of a
     *        Maxwell sample — the non-equilibrium start the histogram mode uses
     *        to show the distribution forming on its own.
     */
    reset(equalSpeeds: boolean): void {
        this._rng = mulberry32(this._seed);
        this._boxZ = BOX_EDGE * this._targetFraction;
        this._impulse = 0;
        this._windowSimTime = 0;
        this._windowWallTime = 0;
        this._pressure = 0;

        const sigma = Math.sqrt(BOLTZMANN * this._targetTemperature / MOLECULE_MASS);
        const speed = rmsSpeed(this._targetTemperature);

        for (let i = 0; i < this._count; i++) {
            const o = i * 3;
            const heavy = i === this._heavy;
            this.mass[i] = heavy ? MOLECULE_MASS * HEAVY_MASS_FACTOR : MOLECULE_MASS;
            this.radius[i] = heavy ? MOLECULE_RADIUS * HEAVY_RADIUS_FACTOR : MOLECULE_RADIUS;

            const r = this.radius[i];
            this.position[o] = r + this._rng() * (BOX_EDGE - 2 * r);
            this.position[o + 1] = r + this._rng() * (BOX_EDGE - 2 * r);
            this.position[o + 2] = r + this._rng() * (this._boxZ - 2 * r);

            if (heavy) {
                this.velocity[o] = 0;
                this.velocity[o + 1] = 0;
                this.velocity[o + 2] = 0;
            } else if (equalSpeeds) {
                // Same speed, random direction: momentum is spread over the
                // sphere but the speed distribution is a spike.
                const z = this._rng() * 2 - 1;
                const t = this._rng() * Math.PI * 2;
                const ring = Math.sqrt(Math.max(0, 1 - z * z));
                this.velocity[o] = speed * Math.cos(t) * ring;
                this.velocity[o + 1] = speed * Math.sin(t) * ring;
                this.velocity[o + 2] = speed * z;
            } else {
                // Each component normal with σ = √(kT/m) is exactly Maxwell.
                this.velocity[o] = this._gauss() * sigma;
                this.velocity[o + 1] = this._gauss() * sigma;
                this.velocity[o + 2] = this._gauss() * sigma;
            }
        }
    }

    /** @param wallDt seconds of real time since the last frame. */
    step(wallDt: number): void {
        const dt = Math.min(wallDt, 0.05);
        const simDt = dt * TIME_COMPRESSION / SUBSTEPS;

        // The piston travels toward its target, and molecules bouncing off a
        // moving wall gain or lose speed — which is where adiabatic heating
        // comes from, without anyone putting it in by hand.
        const target = BOX_EDGE * this._targetFraction;
        let pistonVelocity = 0;
        if (Math.abs(target - this._boxZ) > 1e-13) {
            const travel = BOX_EDGE * PISTON_SPEED * dt;
            const move = Math.min(travel, Math.abs(target - this._boxZ)) * Math.sign(target - this._boxZ);
            this._boxZ += move;
            pistonVelocity = (move / dt) * TIME_COMPRESSION;
        }

        for (let s = 0; s < SUBSTEPS; s++) {
            this._advance(simDt, pistonVelocity);
            this._collide();
            this._windowSimTime += simDt;
        }

        this._thermostat(dt);

        this._windowWallTime += dt;
        if (this._windowWallTime >= PRESSURE_WINDOW) {
            const measured = this._impulse / (this._windowSimTime * this.area);
            // Smoothed: a bare window count of a few hundred impacts is noisy
            // enough to make the reading jump about while nothing changes.
            this._pressure = this._pressure === 0 ? measured : this._pressure * 0.6 + measured * 0.4;
            this._impulse = 0;
            this._windowSimTime = 0;
            this._windowWallTime = 0;
        }
    }

    // ── internals ───────────────────────────────────────────────────

    private _advance(dt: number, pistonVelocity: number): void {
        for (let i = 0; i < this._count; i++) {
            const o = i * 3;
            const r = this.radius[i];
            const m = this.mass[i];

            this.position[o] += this.velocity[o] * dt;
            this.position[o + 1] += this.velocity[o + 1] * dt;
            this.position[o + 2] += this.velocity[o + 2] * dt;

            // A reflection transfers 2m|v⊥|, not m|v⊥| — the factor of two is
            // the single easiest thing to lose here, and losing it halves the
            // measured pressure.
            if (this.position[o] < r) {
                this.position[o] = r;
                this._impulse += 2 * m * Math.abs(this.velocity[o]);
                this.velocity[o] = Math.abs(this.velocity[o]);
            } else if (this.position[o] > BOX_EDGE - r) {
                this.position[o] = BOX_EDGE - r;
                this._impulse += 2 * m * Math.abs(this.velocity[o]);
                this.velocity[o] = -Math.abs(this.velocity[o]);
            }

            if (this.position[o + 1] < r) {
                this.position[o + 1] = r;
                this._impulse += 2 * m * Math.abs(this.velocity[o + 1]);
                this.velocity[o + 1] = Math.abs(this.velocity[o + 1]);
            } else if (this.position[o + 1] > BOX_EDGE - r) {
                this.position[o + 1] = BOX_EDGE - r;
                this._impulse += 2 * m * Math.abs(this.velocity[o + 1]);
                this.velocity[o + 1] = -Math.abs(this.velocity[o + 1]);
            }

            if (this.position[o + 2] < r) {
                this.position[o + 2] = r;
                this._impulse += 2 * m * Math.abs(this.velocity[o + 2]);
                this.velocity[o + 2] = Math.abs(this.velocity[o + 2]);
            } else if (this.position[o + 2] > this._boxZ - r) {
                this.position[o + 2] = this._boxZ - r;
                // Moving wall: v' = −v + 2u. Compressing (u < 0) speeds the
                // molecule up, which is the gas being worked on.
                const before = this.velocity[o + 2];
                const after = -before + 2 * pistonVelocity;
                this._impulse += m * Math.abs(after - before);
                this.velocity[o + 2] = after;
            }
        }
    }

    private _collide(): void {
        const cell = BOX_EDGE / this._gridN;
        const nz = Math.max(1, Math.min(this._gridN, Math.floor(this._boxZ / cell)));
        this._head.fill(-1);

        const indexOf = (x: number, y: number, z: number): number =>
            (z * this._gridN + y) * this._gridN + x;

        for (let i = 0; i < this._count; i++) {
            const o = i * 3;
            const cx = Math.min(this._gridN - 1, Math.max(0, Math.floor(this.position[o] / cell)));
            const cy = Math.min(this._gridN - 1, Math.max(0, Math.floor(this.position[o + 1] / cell)));
            const cz = Math.min(nz - 1, Math.max(0, Math.floor(this.position[o + 2] / cell)));
            const c = indexOf(cx, cy, cz);
            this._next[i] = this._head[c];
            this._head[c] = i;
        }

        for (let i = 0; i < this._count; i++) {
            const o = i * 3;
            const cx = Math.min(this._gridN - 1, Math.max(0, Math.floor(this.position[o] / cell)));
            const cy = Math.min(this._gridN - 1, Math.max(0, Math.floor(this.position[o + 1] / cell)));
            const cz = Math.min(nz - 1, Math.max(0, Math.floor(this.position[o + 2] / cell)));

            for (let dz = -1; dz <= 1; dz++) {
                const z = cz + dz;
                if (z < 0 || z >= nz) continue;
                for (let dy = -1; dy <= 1; dy++) {
                    const y = cy + dy;
                    if (y < 0 || y >= this._gridN) continue;
                    for (let dx = -1; dx <= 1; dx++) {
                        const x = cx + dx;
                        if (x < 0 || x >= this._gridN) continue;

                        for (let j = this._head[indexOf(x, y, z)]; j !== -1; j = this._next[j]) {
                            if (j <= i) continue;
                            this._resolve(i, j);
                        }
                    }
                }
            }
        }
    }

    /** Elastic collision of two spheres along the line of centres. */
    private _resolve(i: number, j: number): void {
        const a = i * 3;
        const b = j * 3;
        let nx = this.position[b] - this.position[a];
        let ny = this.position[b + 1] - this.position[a + 1];
        let nz = this.position[b + 2] - this.position[a + 2];

        const distance = Math.hypot(nx, ny, nz);
        const touching = this.radius[i] + this.radius[j];
        if (distance >= touching || distance < 1e-18) return;

        nx /= distance; ny /= distance; nz /= distance;

        const rvx = this.velocity[b] - this.velocity[a];
        const rvy = this.velocity[b + 1] - this.velocity[a + 1];
        const rvz = this.velocity[b + 2] - this.velocity[a + 2];
        const approach = rvx * nx + rvy * ny + rvz * nz;
        // Already separating: without this test a pair that overlaps for two
        // steps is "collided" twice and gains energy out of nothing.
        if (approach > 0) return;

        const mi = this.mass[i];
        const mj = this.mass[j];
        const impulse = (2 * approach) / (mi + mj);

        this.velocity[a] += impulse * mj * nx;
        this.velocity[a + 1] += impulse * mj * ny;
        this.velocity[a + 2] += impulse * mj * nz;
        this.velocity[b] -= impulse * mi * nx;
        this.velocity[b + 1] -= impulse * mi * ny;
        this.velocity[b + 2] -= impulse * mi * nz;

        // Push apart so the pair does not stay overlapped into the next step.
        const overlap = (touching - distance) / 2;
        this.position[a] -= nx * overlap;
        this.position[a + 1] -= ny * overlap;
        this.position[a + 2] -= nz * overlap;
        this.position[b] += nx * overlap;
        this.position[b + 1] += ny * overlap;
        this.position[b + 2] += nz * overlap;
    }

    /**
     * Relaxes toward the slider's temperature over ~1.5 s of wall time.
     *
     * Gradual rather than instant on purpose: an immediate rescale is a jump
     * and reads as a bug, and the lag is what lets compression heat the gas
     * visibly before the walls carry it away again.
     */
    private _thermostat(wallDt: number): void {
        const current = this.temperature;
        if (current <= 0) return;

        const blend = Math.min(1, wallDt / THERMOSTAT_TAU);
        const goal = current + (this._targetTemperature - current) * blend;
        const factor = Math.sqrt(goal / current);
        if (Math.abs(factor - 1) < 1e-9) return;

        for (let i = 0; i < this._count; i++) {
            if (i === this._heavy) continue;
            const o = i * 3;
            this.velocity[o] *= factor;
            this.velocity[o + 1] *= factor;
            this.velocity[o + 2] *= factor;
        }
    }

    private _gauss(): number {
        // Box–Muller, from the seeded stream so the gas is reproducible.
        const u = Math.max(this._rng(), 1e-12);
        const v = this._rng();
        return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    }
}
