// scripts/components/ElectronOrbit.ts

import { ScriptableBehaviour, Vector3, Time } from "WebEngineTS";

/**
 * Carries one electron around its shell.
 *
 * The electron is parented to a shell GameObject that holds the shell's tilt,
 * so this only has to move it in that object's local XZ plane — the plane
 * `Mesh.createTorus` builds its ring in, Y-up as Unity has it and not the XY of
 * `THREE.TorusGeometry`. Tilt the parent and ring and electron stay together.
 *
 * Angles are kept in degrees to match the rest of the engine's rotation API.
 */
export class ElectronOrbit extends ScriptableBehaviour {
    /** Orbit radius, world units. */
    radius: number = 1;
    /** Current angle in degrees. Set at build time to space electrons evenly. */
    angle: number = 0;
    /** Degrees per second. Outer shells are given a lower value. */
    speed: number = 40;
    paused: boolean = false;

    /** Reused every frame; a fresh Vector3 per electron per frame is pure GC. */
    private readonly _position: Vector3 = new Vector3(0, 0, 0);

    override update(): void {
        if (this.paused) return;

        this.angle = (this.angle + this.speed * Time.deltaTime) % 360;
        const rad = this.angle * Math.PI / 180;
        this._position.set(Math.cos(rad) * this.radius, 0, Math.sin(rad) * this.radius);
        this.transform.localPosition = this._position;
    }
}
