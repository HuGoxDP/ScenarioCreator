// scripts/helpers/AtomBuilder.ts
// ============================================================
// Turns an element record plus two student-controlled numbers — how many
// neutrons, what charge — into a scene.
//
// Built fresh on every change and thrown away, which is the opposite of what
// Molecules does with its 46 cached structures. The reason is the nucleus:
// krypton is 84 nucleons, so caching all 36 elements would keep ~2000 objects
// alive to save a rebuild that costs a millisecond.
//
// Nothing here is random. The nucleus packing is a spherical Fibonacci
// distribution and the orbital cloud is sampled from a generator seeded with
// the proton count, so the same element always produces the same picture — and
// the scene-graph size never depends on the run.
// ============================================================

import {
    GameObject, Vector3, Quaternion, Color,
    MeshFilter, MeshRenderer, InstancedMeshRenderer,
    Mesh, StandardMaterial, SphereCollider,
} from "WebEngineTS";

import { ElectronOrbit } from "../components/ElectronOrbit";
import type { ElementInfo } from "../data/elements";

export type ParticleKind = "proton" | "neutron" | "electron";

export interface ParticleRef {
    kind: ParticleKind;
    /** 0-based shell index; electrons only. */
    shell?: number;
}

export interface BuiltAtom {
    root: GameObject;
    /** Everything a click can land on. */
    particleOf: Map<GameObject, ParticleRef>;
    orbits: ElectronOrbit[];
    /** Electrons per shell after the charge has been applied. */
    occupancy: number[];
    /** Radius of the outermost drawn feature — the camera frames on this. */
    extent: number;
}

/** 2n² — the capacity of shells K…N. */
const SHELL_CAPACITY = [2, 8, 18, 32];

const NUCLEON_RADIUS = 0.17;
const ELECTRON_RADIUS = 0.14;
const SHELL_BASE = 2.4;
const SHELL_STEP = 1.3;
const RING_TUBE = 0.02;

/** Shell tilts, in euler degrees. Four coplanar rings would read as one disc. */
const SHELL_TILT: [number, number, number][] = [
    [0, 0, 0], [62, 0, 14], [-48, 0, -22], [26, 0, 38],
];

/** Degrees per second per shell — outer electrons visibly lag inner ones. */
const SHELL_SPEED = [46, 33, 25, 19];

const POINTS_PER_ELECTRON = 110;
const MAX_CLOUD_POINTS = 4000;

/**
 * Electrons per shell once the ion charge is applied.
 *
 * Positive charge strips the outermost electrons, negative adds them — and
 * neither touches the nucleus. Exported because the readout states the result
 * («Na⁺ → 2, 8, конфігурація неону») and should not recompute it differently.
 */
export function occupancyFor(shells: number[], charge: number): number[] {
    const result = shells.slice();

    for (let removed = 0; removed < charge; removed++) {
        let i = result.length - 1;
        while (i >= 0 && result[i] === 0) i--;
        if (i < 0) break;
        result[i]--;
    }

    for (let added = 0; added < -charge; added++) {
        let i = result.length - 1;
        while (i >= 0 && result[i] === 0) i--;
        if (i < 0) { result[0] = (result[0] ?? 0) + 1; continue; }

        // Fill the outermost shell to 2n², then open the next one.
        if (result[i] < SHELL_CAPACITY[i]) result[i]++;
        else if (i + 1 < SHELL_CAPACITY.length) result[i + 1] = (result[i + 1] ?? 0) + 1;
    }

    while (result.length > 1 && result[result.length - 1] === 0) result.pop();
    return result;
}

/** Deterministic generator — same seed, same cloud, every run. */
function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export class AtomBuilder {
    private readonly _particleMesh: Mesh;
    private readonly _cloudMesh: Mesh;
    private readonly _ringMeshes = new Map<number, Mesh>();

    private readonly _protonMat: StandardMaterial;
    private readonly _neutronMat: StandardMaterial;
    private readonly _electronMat: StandardMaterial;
    private readonly _ringMat: StandardMaterial;
    private readonly _cloudMat: StandardMaterial;

    constructor() {
        // One unit sphere serves protons, neutrons and electrons; size comes
        // from the transform, so no particle needs a mesh of its own.
        this._particleMesh = Mesh.createSphere(1, 14);
        this._cloudMesh = Mesh.createSphere(1, 6);

        this._protonMat = this._material(new Color(0.88, 0.26, 0.24, 1), 0.5);
        this._neutronMat = this._material(new Color(0.62, 0.65, 0.70, 1), 0.3);
        this._electronMat = this._material(new Color(0.35, 0.72, 1.00, 1), 0.7);
        this._ringMat = this._material(new Color(0.35, 0.45, 0.62, 1), 0.2);
        this._cloudMat = this._material(new Color(0.40, 0.72, 1.00, 1), 0.6);
    }

    /**
     * @param info      the element
     * @param neutrons  after the isotope slider
     * @param charge    after the ion slider; positive strips electrons
     * @param cloud     draw the orbital cloud instead of Bohr rings
     */
    build(info: ElementInfo, neutrons: number, charge: number, cloud: boolean): BuiltAtom {
        const root = new GameObject(`${info.symbol} atom`);
        const particleOf = new Map<GameObject, ParticleRef>();
        const orbits: ElectronOrbit[] = [];

        const occupancy = occupancyFor(info.shells, charge);
        const nucleusRadius = this._buildNucleus(root, particleOf, info.z, neutrons);

        const extent = cloud
            ? this._buildCloud(root, info, occupancy)
            : this._buildShells(root, particleOf, orbits, occupancy);

        return { root, particleOf, orbits, occupancy, extent: Math.max(extent, nucleusRadius) };
    }

    // ── nucleus ─────────────────────────────────────────────────────

    /** @returns the packed radius, so a lone proton does not get framed like krypton. */
    private _buildNucleus(
        root: GameObject, particleOf: Map<GameObject, ParticleRef>,
        protons: number, neutrons: number,
    ): number {
        const total = protons + neutrons;
        if (total === 0) return 0;

        const packRadius = 0.30 * Math.cbrt(total);
        const golden = Math.PI * (3 - Math.sqrt(5));
        const nucleus = new GameObject("Nucleus");
        nucleus.transform.parent = root.transform;

        let protonsUsed = 0;
        for (let i = 0; i < total; i++) {
            // Interleave rather than filling protons first, or every nucleus
            // would be a red core inside a grey shell.
            const wantProton = protonsUsed < protons
                && (neutrons === 0 || (protonsUsed + 1) / (i + 1) <= protons / total);
            const kind: ParticleKind = wantProton ? "proton" : "neutron";
            if (wantProton) protonsUsed++;

            // Fibonacci direction, radius by cube root so the ball fills rather
            // than hollowing into a surface.
            const y = total === 1 ? 0 : 1 - (i / (total - 1)) * 2;
            const ring = Math.sqrt(Math.max(0, 1 - y * y));
            const theta = golden * i;
            const r = packRadius * Math.cbrt((i + 0.5) / total);

            const go = new GameObject(kind);
            go.transform.parent = nucleus.transform;
            go.transform.localPosition = new Vector3(
                Math.cos(theta) * ring * r, y * r, Math.sin(theta) * ring * r,
            );
            go.transform.localScale = new Vector3(NUCLEON_RADIUS, NUCLEON_RADIUS, NUCLEON_RADIUS);

            go.addComponent(MeshFilter).sharedMesh = this._particleMesh;
            go.addComponent(MeshRenderer).sharedMaterial =
                kind === "proton" ? this._protonMat : this._neutronMat;
            go.addComponent(SphereCollider).radius = 1;

            particleOf.set(go, { kind });
        }

        return packRadius + NUCLEON_RADIUS;
    }

    // ── Bohr shells ─────────────────────────────────────────────────

    private _buildShells(
        root: GameObject, particleOf: Map<GameObject, ParticleRef>,
        orbits: ElectronOrbit[], occupancy: number[],
    ): number {
        let extent = 0;

        for (let i = 0; i < occupancy.length; i++) {
            const count = occupancy[i];
            if (count === 0) continue;

            const radius = SHELL_BASE + i * SHELL_STEP;
            extent = radius;

            const shell = new GameObject(`Shell ${i + 1}`);
            shell.transform.parent = root.transform;
            const tilt = SHELL_TILT[i] ?? SHELL_TILT[SHELL_TILT.length - 1];
            shell.transform.localRotation = Quaternion.euler(tilt[0], tilt[1], tilt[2]);

            // The ring: createTorus builds in the XY plane, which is the plane
            // ElectronOrbit moves its electron in. They share the parent's tilt.
            const ring = new GameObject("Ring");
            ring.transform.parent = shell.transform;
            ring.addComponent(MeshFilter).sharedMesh = this._ring(radius);
            ring.addComponent(MeshRenderer).sharedMaterial = this._ringMat;

            for (let e = 0; e < count; e++) {
                const go = new GameObject("electron");
                go.transform.parent = shell.transform;
                go.transform.localScale = new Vector3(ELECTRON_RADIUS, ELECTRON_RADIUS, ELECTRON_RADIUS);

                go.addComponent(MeshFilter).sharedMesh = this._particleMesh;
                go.addComponent(MeshRenderer).sharedMaterial = this._electronMat;
                go.addComponent(SphereCollider).radius = 1;

                const orbit = go.addComponent(ElectronOrbit);
                orbit.radius = radius;
                orbit.angle = (360 / count) * e;
                orbit.speed = SHELL_SPEED[i] ?? 16;
                orbits.push(orbit);

                particleOf.set(go, { kind: "electron", shell: i });
            }
        }

        return extent;
    }

    /** Torus meshes are per-radius, so cache the four the scenario can ask for. */
    private _ring(radius: number): Mesh {
        let mesh = this._ringMeshes.get(radius);
        if (!mesh) {
            // radialSegments divides the ring, tubularSegments the tube — the
            // opposite of THREE.TorusGeometry. Passed Three's way, this drew a
            // hexagon instead of a shell.
            mesh = Mesh.createTorus(radius, RING_TUBE, 96, 6);
            this._ringMeshes.set(radius, mesh);
        }
        return mesh;
    }

    // ── orbital cloud ───────────────────────────────────────────────

    private _buildCloud(root: GameObject, info: ElementInfo, occupancy: number[]): number {
        const electrons = occupancy.reduce((a, b) => a + b, 0);
        const total = Math.min(electrons * POINTS_PER_ELECTRON, MAX_CLOUD_POINTS);
        if (total === 0) return SHELL_BASE;

        const go = new GameObject("Orbital cloud");
        go.transform.parent = root.transform;

        const inst = go.addComponent(InstancedMeshRenderer);
        inst.mesh = this._cloudMesh;
        inst.sharedMaterial = this._cloudMat;
        inst.count = total;

        const rng = mulberry32(info.z * 7919 + 13);
        const scale = new Vector3(0.045, 0.045, 0.045);
        let written = 0;
        let extent = SHELL_BASE;

        for (let i = 0; i < occupancy.length && written < total; i++) {
            const count = occupancy[i];
            if (count === 0) continue;

            const radius = SHELL_BASE + i * SHELL_STEP;
            extent = radius;
            const share = Math.min(Math.round(total * count / electrons), total - written);

            // Only the outermost shell of a p-block element gets lobes. The
            // d electrons are drawn as a plain shell rather than a wrong shape;
            // the readout says so.
            const lobed = info.block === "p" && i === occupancy.length - 1;

            for (let k = 0; k < share; k++) {
                const dir = lobed ? this._lobeDirection(rng, k % 3) : this._sphereDirection(rng);
                // Sum of three uniforms ≈ bell curve: no sharp edge on the cloud.
                const jitter = 1 + 0.34 * ((rng() + rng() + rng()) / 1.5 - 1);
                dir.multiplyScalar(radius * jitter);
                inst.setInstanceTransform(written, dir, Quaternion.identity, scale);
                written++;
            }
        }

        inst.apply();
        return extent * 1.35;
    }

    private _sphereDirection(rng: () => number): Vector3 {
        const z = rng() * 2 - 1;
        const t = rng() * Math.PI * 2;
        const r = Math.sqrt(Math.max(0, 1 - z * z));
        return new Vector3(Math.cos(t) * r, Math.sin(t) * r, z);
    }

    /** Rejection sampling against cos²θ — the two-lobed p shape, about one axis. */
    private _lobeDirection(rng: () => number, axis: number): Vector3 {
        let dir = this._sphereDirection(rng);
        for (let tries = 0; tries < 12; tries++) {
            const along = axis === 0 ? dir.x : axis === 1 ? dir.y : dir.z;
            if (rng() < along * along) return dir;
            dir = this._sphereDirection(rng);
        }
        return dir;
    }

    // ── shared ──────────────────────────────────────────────────────

    private _material(color: Color, smoothness: number): StandardMaterial {
        const mat = new StandardMaterial();
        mat.albedoColor = color;
        mat.smoothness = smoothness;
        mat.metallic = 0.05;
        return mat;
    }
}
