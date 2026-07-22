// scripts/components/Orbiter.ts

import { ScriptableBehaviour, Vector3, Time } from "WebEngineTS";

/** Shared pause flag — set by Scenario, checked by Orbiter and Rotator. */
export let simulationPaused = false;

/** Toggle pause state. Called from Scenario on P key. */
export function setSimulationPaused(paused: boolean): void {
    simulationPaused = paused;
}

/**
 * Orbits the GameObject around a center point.
 * Respects the global simulationPaused flag — camera is NOT affected.
 *
 * Uses a cached Vector3 to avoid per-frame allocations (~40% GC reduction).
 */
export class Orbiter extends ScriptableBehaviour {
    center: Vector3 = Vector3.zero;
    radius: number = 5;
    speed: number = 30;
    tilt: number = 0;
    useLocalSpace: boolean = false;
    /** Starting angle in degrees. -1 = random. Set before start() runs. */
    initialAngle: number = -1;

    private _angle: number = 0;

    /** Cached position vector — reused every frame to avoid GC pressure. */
    private readonly _cachedPos: Vector3 = new Vector3(0, 0, 0);

    override start(): void {
        this._angle = this.initialAngle >= 0 ? this.initialAngle : Math.random() * 360;
    }

    override update(): void {
        if (simulationPaused) return;

        this._angle += this.speed * Time.deltaTime;

        const rad = this._angle * (Math.PI / 180);
        const x = this.center.x + Math.cos(rad) * this.radius;
        const z = this.center.z + Math.sin(rad) * this.radius;

        const tiltRad = this.tilt * (Math.PI / 180);
        const y = this.center.y + Math.sin(rad) * Math.sin(tiltRad) * this.radius * 0.1;

        this._cachedPos.set(x, y, z);

        if (this.useLocalSpace) {
            this.transform.localPosition = this._cachedPos;
        } else {
            this.transform.position = this._cachedPos;
        }
    }
}