// scripts/Scenario.ts  (Benchmark Scene 3 — Solar System)
// ============================================================
// Plain content scene: sun + six orbiting, spinning planets + moon +
// equirectangular skybox. Initial orbital angles are fixed so every run
// renders the same composition (no Math.random() drift).
//
// No benchmarking or optimization toggles live here — the engine harness
// (WebEngineTS benchmarks/run.ts) drives maxSize / relArc / relSrc / KTX2 /
// warmup / dirty / measurement from the outside. See the WebEngineTS
// "Single profiling system" policy.
// ============================================================

import {
    ScenarioBehaviour, GameObject, Vector3, Color,
    PointLight, AmbientLight, DirectionalLight,
    MeshFilter, MeshRenderer, Mesh,
    Material, Shader, Input, KeyCode,
    Texture2D, Resources,
    Cubemap, RenderSettings,
} from "WebEngineTS";

import { createCameraRig, type ICameraRig } from "./helpers/CameraSetup";
import { createOrbitRing, createTexturedPlanet, normalizeModelToRadius } from "./helpers/PlanetFactory";
import { Orbiter, setSimulationPaused } from "./components/Orbiter";
import { Rotator } from "./components/Rotator";

// ==================== SCALE CONSTANTS ====================

const E = 0.5;
const SIZE: Record<string, number> = {
    sun: 2.5, mercury: E * (2440 / 6371), venus: E * (6052 / 6371),
    earth: E, moon: E * (1737 / 6371), mars: E * (3390 / 6371),
    jupiter: E * Math.sqrt(69911 / 6371), saturn: E * Math.sqrt(58232 / 6371),
};
const ORBIT: Record<string, number> = {
    mercury: Math.sqrt(0.387) * 9, venus: Math.sqrt(0.723) * 9,
    earth: Math.sqrt(1.000) * 9, mars: Math.sqrt(1.524) * 9,
    jupiter: Math.sqrt(5.203) * 9, saturn: Math.sqrt(9.537) * 9,
};
const V = 28;
const SPEED: Record<string, number> = {
    mercury: V * Math.sqrt(1 / 0.387), venus: V * Math.sqrt(1 / 0.723),
    earth: V, mars: V * Math.sqrt(1 / 1.524),
    jupiter: V * Math.sqrt(1 / 5.203), saturn: V * Math.sqrt(1 / 9.537),
};

// Deterministic initial angles fix orbital start positions so every run
// produces the same scene composition.
interface PlanetDef {
    name: string; key: string; rotationSpeed: number; tilt: number;
    initialAngle: number;
    color: Color; metallic: number; smoothness: number;
    texAlbedo?: string; texNormal?: string; texEmissive?: string;
    emissiveColor?: Color; emissiveIntensity?: number; model?: string;
}

const PLANETS: PlanetDef[] = [
    { name: "Mercury", key: "mercury", rotationSpeed: 30, tilt: 0, initialAngle: 0,   color: new Color(0.65, 0.6, 0.55, 1), metallic: 0, smoothness: 0.2, texAlbedo: "mercury", model: "mercury" },
    { name: "Venus",   key: "venus",   rotationSpeed: 0,  tilt: 3, initialAngle: 60,  color: new Color(0.9, 0.75, 0.4, 1),  metallic: 0, smoothness: 0.6, texAlbedo: "venus_atmosphere", model: "venus" },
    { name: "Earth",   key: "earth",   rotationSpeed: 90, tilt: 5, initialAngle: 45,  color: new Color(0.2, 0.45, 0.85, 1), metallic: 0.1, smoothness: 0.7, texAlbedo: "earth", texNormal: "earth_normal", texEmissive: "earth_night", emissiveColor: new Color(1, 0.9, 0.6, 1), emissiveIntensity: 0.5, model: "earth" },
    { name: "Mars",    key: "mars",    rotationSpeed: 0,  tilt: 2, initialAngle: 120, color: new Color(0.8, 0.35, 0.15, 1), metallic: 0, smoothness: 0.3, texAlbedo: "mars", model: "mars" },
    { name: "Jupiter", key: "jupiter", rotationSpeed: 150,tilt: 0, initialAngle: 200, color: new Color(0.8, 0.7, 0.5, 1),   metallic: 0, smoothness: 0.4, texAlbedo: "jupiter", model: "jupiter" },
    { name: "Saturn",  key: "saturn",  rotationSpeed: 0,  tilt: 0, initialAngle: 280, color: new Color(0.85, 0.78, 0.5, 1), metallic: 0, smoothness: 0.4, texAlbedo: "saturn", model: "saturn" },
];

// ==================== SCENARIO ====================

export default class BenchSolarSystem extends ScenarioBehaviour {
    private _camera!: ICameraRig;
    private _earthTracker!: GameObject;
    private _paused = false;
    private _skybox: Cubemap | null = null;

    override async awake(): Promise<void> {
        this._camera = createCameraRig({
            useSkybox: true, orbitDistance: 38,
            backgroundColor: new Color(0.01, 0.01, 0.03, 1),
        });

        await this._loadSkybox();
        this._createLights();
        await this._createSun();
        await this._createAllPlanets();
        await this._createMoon();

        for (const [name, radius] of Object.entries(ORBIT)) {
            createOrbitRing(`${name} Orbit`, radius);
        }
    }

    override update(): void {
        if (Input.getKeyDown(KeyCode.Digit1)) this._camera.activateOrbit();
        if (Input.getKeyDown(KeyCode.Digit2)) this._camera.activateFly();
        if (Input.getKeyDown(KeyCode.Digit3)) this._camera.activateFollow(this._earthTracker.transform);

        if (Input.getKeyDown(KeyCode.KeyP)) {
            this._paused = !this._paused;
            setSimulationPaused(this._paused);
        }
    }

    override onDestroy(): void {
        setSimulationPaused(false);
    }

    // ═══════════════════ SCENE CONSTRUCTION ═══════════════════

    private async _loadSkybox(): Promise<void> {
        try {
            const url = await Resources.getUrl("skybox/stars_panorama.jpg");
            this._skybox = await Cubemap.fromEquirectangular(url);
            RenderSettings.skybox = this._skybox;
        } catch { /* no skybox available */ }
    }

    private _createLights(): void {
        const ambGo = new GameObject("Ambient Light");
        const amb = ambGo.addComponent(AmbientLight);
        amb.intensity = 0.4;
        amb.color = new Color(0.5, 0.5, 0.7, 1);

        const dirGo = new GameObject("Directional Light");
        const dir = dirGo.addComponent(DirectionalLight);
        dir.intensity = 0.8;
        dir.color = new Color(1, 0.95, 0.85, 1);
        dirGo.transform.position = new Vector3(10, 20, 10);
    }

    private async _createSun(): Promise<void> {
        const sunTex = await Resources.tryLoad(Texture2D, "textures/sun");
        const go = new GameObject("Sun");
        go.addComponent(MeshFilter).sharedMesh = Mesh.createSphere(SIZE.sun, 48);
        const mat = new Material(Shader.Unlit);
        if (sunTex) { mat.color = Color.white; mat.mainTexture = sunTex; }
        else { mat.color = new Color(1, 0.85, 0.3, 1); }
        go.addComponent(MeshRenderer).sharedMaterial = mat;
        const light = go.addComponent(PointLight);
        light.intensity = 4; light.range = 200; light.decay = 1;
        light.color = new Color(1, 0.95, 0.85, 1);
    }

    private async _createAllPlanets(): Promise<void> {
        for (const def of PLANETS) {
            const radius = SIZE[def.key];
            let planetGo: GameObject;

            const model = def.model
                ? await Resources.tryLoad(GameObject, `models/${def.model}`)
                : null;

            if (model) {
                planetGo = model;
                planetGo.name = def.name;
                normalizeModelToRadius(planetGo, radius);
            } else {
                const albedo   = def.texAlbedo   ? await Resources.tryLoad(Texture2D, `textures/${def.texAlbedo}`)   : null;
                const normal   = def.texNormal   ? await Resources.tryLoad(Texture2D, `textures/${def.texNormal}`)   : null;
                const emissive = def.texEmissive ? await Resources.tryLoad(Texture2D, `textures/${def.texEmissive}`) : null;

                planetGo = createTexturedPlanet({
                    name: def.name, radius,
                    color: def.color, metallic: def.metallic, smoothness: def.smoothness,
                    textures: {
                        albedo: albedo ?? undefined,
                        normal: normal ?? undefined,
                        emissive: emissive ?? undefined,
                    },
                    emissiveColor: def.emissiveColor,
                    emissiveIntensity: def.emissiveIntensity,
                });
            }

            this._addOrbit(planetGo, ORBIT[def.key], SPEED[def.key], def.tilt, def.initialAngle);
            if (def.rotationSpeed > 0) this._addRotator(planetGo, def.rotationSpeed);

            if (def.key === "earth") {
                const tracker = new GameObject("Earth Tracker");
                const to = tracker.addComponent(Orbiter) as any;
                to.radius = ORBIT.earth; to.speed = SPEED.earth;
                to.tilt = def.tilt; to.initialAngle = def.initialAngle;
                this._earthTracker = tracker;
            }
        }
    }

    private async _createMoon(): Promise<void> {
        const moonModel = await Resources.tryLoad(GameObject, "models/moon");
        let moonGo: GameObject;
        if (moonModel) {
            moonGo = moonModel; moonGo.name = "Moon";
            normalizeModelToRadius(moonGo, SIZE.moon);
        } else {
            const albedo = await Resources.tryLoad(Texture2D, "textures/moon");
            const normal = await Resources.tryLoad(Texture2D, "textures/moon_normal");
            moonGo = createTexturedPlanet({
                name: "Moon", radius: SIZE.moon,
                color: new Color(0.75, 0.75, 0.72, 1), smoothness: 0.2,
                textures: { albedo: albedo ?? undefined, normal: normal ?? undefined },
            });
        }
        moonGo.transform.parent = this._earthTracker.transform;
        const orb = moonGo.addComponent(Orbiter) as any;
        orb.radius = 1.2; orb.speed = 120; orb.useLocalSpace = true;
        orb.initialAngle = 0;
    }

    private _addOrbit(go: GameObject, r: number, s: number, t: number, initialAngle: number): void {
        const o = go.addComponent(Orbiter) as any;
        o.radius = r; o.speed = s; o.tilt = t; o.initialAngle = initialAngle;
    }
    private _addRotator(go: GameObject, speed: number): void {
        (go.addComponent(Rotator) as any).speed = speed;
    }
}
