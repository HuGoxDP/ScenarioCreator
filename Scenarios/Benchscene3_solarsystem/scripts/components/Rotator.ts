// scripts/components/Rotator.ts

import { ScriptableBehaviour, Vector3, Time } from "WebEngineTS";
import { simulationPaused } from "./Orbiter";

/**
 * Rotates the GameObject around its own axis every frame.
 *
 * Uses a cached Vector3 to avoid per-frame allocations.
 */
export class Rotator extends ScriptableBehaviour {
    speed: number = 20;
    axis: Vector3 = new Vector3(0, 1, 0);

    /** Cached euler vector — reused every frame to avoid GC pressure. */
    private readonly _cachedEulers: Vector3 = new Vector3(0, 0, 0);

    override update(): void {
        if (simulationPaused) return;

        this._cachedEulers.set(
            this.axis.x * this.speed * Time.deltaTime,
            this.axis.y * this.speed * Time.deltaTime,
            this.axis.z * this.speed * Time.deltaTime,
        );
        this.transform.rotate(this._cachedEulers);
    }
}