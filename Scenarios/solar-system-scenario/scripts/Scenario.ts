// scripts/Scenario.ts
// ============================================================
// Solar System v3.5 — Memory-optimized
// ============================================================

import {
    ScenarioBehaviour, GameObject, Vector3, Color,
    PointLight, AmbientLight, DirectionalLight,
    MeshFilter, MeshRenderer, Mesh,
    StandardMaterial, Material, Shader, Input, KeyCode,
    Texture2D, Resources,
    Cubemap, RenderSettings,
    MemoryProfiler,
} from "WebEngineTS";

import { createCameraRig, type ICameraRig } from "./helpers/CameraSetup";
import { createOrbitRing, createTexturedPlanet, normalizeModelToRadius } from "./helpers/PlanetFactory";
import { Orbiter, setSimulationPaused } from "./components/Orbiter";
import { Rotator } from "./components/Rotator";

// Scale constants
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

// Planet definitions
interface PlanetDef {
    name: string; key: string; rotationSpeed: number; tilt: number;
    color: Color; metallic: number; smoothness: number;
    texAlbedo?: string; texNormal?: string; texEmissive?: string;
    emissiveColor?: Color; emissiveIntensity?: number; model?: string;
}

const PLANETS: PlanetDef[] = [
    { name: "Mercury", key: "mercury", rotationSpeed: 30, tilt: 0, color: new Color(0.65, 0.6, 0.55, 1), metallic: 0, smoothness: 0.2, texAlbedo: "mercury", model: "mercury" },
    { name: "Venus", key: "venus", rotationSpeed: 0, tilt: 3, color: new Color(0.9, 0.75, 0.4, 1), metallic: 0, smoothness: 0.6, texAlbedo: "venus_atmosphere", model: "venus" },
    { name: "Earth", key: "earth", rotationSpeed: 90, tilt: 5, color: new Color(0.2, 0.45, 0.85, 1), metallic: 0.1, smoothness: 0.7, texAlbedo: "earth", texNormal: "earth_normal", texEmissive: "earth_night", emissiveColor: new Color(1, 0.9, 0.6, 1), emissiveIntensity: 0.5, model: "earth" },
    { name: "Mars", key: "mars", rotationSpeed: 0, tilt: 2, color: new Color(0.8, 0.35, 0.15, 1), metallic: 0, smoothness: 0.3, texAlbedo: "mars", model: "mars" },
    { name: "Jupiter", key: "jupiter", rotationSpeed: 150, tilt: 0, color: new Color(0.8, 0.7, 0.5, 1), metallic: 0, smoothness: 0.4, texAlbedo: "jupiter", model: "jupiter" },
    { name: "Saturn", key: "saturn", rotationSpeed: 0, tilt: 0, color: new Color(0.85, 0.78, 0.5, 1), metallic: 0, smoothness: 0.4, texAlbedo: "saturn", model: "saturn" },
];

// ══════════════════════════════════════════════════════════

export default class SolarSystem extends ScenarioBehaviour {
    private _camera!: ICameraRig;
    private _earthTracker!: GameObject;
    private _paused = false;
    private _loadedTextures: Texture2D[] = [];

    /**
     * Countdown to release CPU texture data.
     * Set to 2 in start() → decremented each update() →
     * at 0, first render has completed and textures are safe to release.
     *
     * Frame 1: start(countdown=2) → update(2→1) → render (GPU upload!)
     * Frame 2: update(1→0, RELEASE) → render (GPU cache still works)
     */
    private _releaseCountdown = -1;

    override async awake(): Promise<void> {
        Texture2D.maxSize = 4096;
        MemoryProfiler.showOverlay();
        MemoryProfiler.logReport();

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

        // Release ZIP — all assets loaded, no more loading needed
        this.context.assets.releaseArchive();

        MemoryProfiler.logReport();
        console.log("[SolarSystem] Setup complete");
        console.log("[SolarSystem] 1=Orbit  2=Fly  3=Follow(Earth)  P=Pause  M=Memory");
        console.log(`[SolarSystem] Cache: ${Resources.cacheSize} assets`);
    }

    override start(): void {
        // Schedule CPU texture release for after first render completes.
        // Cannot release in awake() or start() — Three.js needs image data
        // for the initial texImage2D GPU upload that happens during render().
        this._releaseCountdown = 2;
    }

    override update(): void {
        // Deferred texture release — wait for first render to complete
        if (this._releaseCountdown > 0) {
            this._releaseCountdown--;
            if (this._releaseCountdown === 0) {
                for (const tex of this._loadedTextures) {
                    tex.releaseSourceImage();
                }
                this._loadedTextures = [];
                console.log("[SolarSystem] CPU texture data released");
                MemoryProfiler.logReport();
            }
        }

        if (Input.getKeyDown(KeyCode.Digit1)) this._camera.activateOrbit();
        if (Input.getKeyDown(KeyCode.Digit2)) this._camera.activateFly();
        if (Input.getKeyDown(KeyCode.Digit3)) this._camera.activateFollow(this._earthTracker.transform);

        if (Input.getKeyDown(KeyCode.KeyP)) {
            this._paused = !this._paused;
            setSimulationPaused(this._paused);
            console.log(`[SolarSystem] ${this._paused ? "\u23f8 Paused" : "\u25b6 Resumed"}`);
        }
        if (Input.getKeyDown(KeyCode.KeyM)) {
            if (MemoryProfiler.isOverlayVisible) MemoryProfiler.hideOverlay();
            else MemoryProfiler.showOverlay();
        }
    }

    override fixedUpdate(): void {}
    override lateUpdate(): void {}

    override onDestroy(): void {
        setSimulationPaused(false);
        MemoryProfiler.hideOverlay();
        Texture2D.maxSize = 0;
        Resources.unloadUnused();
        console.log("[SolarSystem] Ended.");
    }

    // ═══════════════════════════════════════════════════════

    private _track(tex: Texture2D | null): Texture2D | null {
        if (tex) this._loadedTextures.push(tex);
        return tex;
    }

    private async _loadSkybox(): Promise<void> {
        try {
            const url = await Resources.getUrl("skybox/stars_panorama.jpg");
            RenderSettings.skybox = await Cubemap.fromEquirectangular(url);
            console.log("[Skybox] Loaded");
            return;
        } catch { /* */ }
        try {
            const faces = ["px", "nx", "py", "ny", "pz", "nz"];
            const urls = await Promise.all(faces.map(f => Resources.getUrl(`skybox/${f}.jpg`)));
            RenderSettings.skybox = await Cubemap.fromImages(urls[0], urls[1], urls[2], urls[3], urls[4], urls[5]);
            console.log("[Skybox] 6-face loaded");
            return;
        } catch { /* */ }
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
        const sunTex = this._track(await Resources.tryLoad(Texture2D, "textures/sun"));
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
        let modelsLoaded = 0;
        let texturesLoaded = 0;

        for (const def of PLANETS) {
            const radius = SIZE[def.key];
            let planetGo: GameObject;

            const model = def.model ? await Resources.tryLoad(GameObject, `models/${def.model}`) : null;

            if (model) {
                planetGo = model;
                planetGo.name = def.name;
                normalizeModelToRadius(planetGo, radius);
                modelsLoaded++;
            } else {
                const albedo   = this._track(def.texAlbedo   ? await Resources.tryLoad(Texture2D, `textures/${def.texAlbedo}`)   : null);
                const normal   = this._track(def.texNormal   ? await Resources.tryLoad(Texture2D, `textures/${def.texNormal}`)   : null);
                const emissive = this._track(def.texEmissive ? await Resources.tryLoad(Texture2D, `textures/${def.texEmissive}`) : null);
                if (albedo) texturesLoaded++;
                if (normal) texturesLoaded++;
                if (emissive) texturesLoaded++;

                planetGo = createTexturedPlanet({
                    name: def.name, radius,
                    color: def.color, metallic: def.metallic, smoothness: def.smoothness,
                    textures: { albedo: albedo ?? undefined, normal: normal ?? undefined, emissive: emissive ?? undefined },
                    emissiveColor: def.emissiveColor, emissiveIntensity: def.emissiveIntensity,
                });
            }

            this._addOrbit(planetGo, ORBIT[def.key], SPEED[def.key], def.tilt);
            if (def.rotationSpeed > 0) this._addRotator(planetGo, def.rotationSpeed);

            if (def.key === "earth") {
                const EARTH_ANGLE = 45;
                const earthOrbit = planetGo.getComponent(Orbiter) as any;
                if (earthOrbit) earthOrbit.initialAngle = EARTH_ANGLE;
                const tracker = new GameObject("Earth Tracker");
                const to = tracker.addComponent(Orbiter) as any;
                to.radius = ORBIT.earth; to.speed = SPEED.earth;
                to.tilt = def.tilt; to.initialAngle = EARTH_ANGLE;
                this._earthTracker = tracker;
            }
        }
        console.log(`[Planets] ${PLANETS.length} created | ${modelsLoaded} GLB | ${texturesLoaded} textures`);
    }

    private async _createMoon(): Promise<void> {
        const moonModel = await Resources.tryLoad(GameObject, "models/moon");
        let moonGo: GameObject;
        if (moonModel) {
            moonGo = moonModel; moonGo.name = "Moon";
            normalizeModelToRadius(moonGo, SIZE.moon);
        } else {
            const albedo = this._track(await Resources.tryLoad(Texture2D, "textures/moon"));
            const normal = this._track(await Resources.tryLoad(Texture2D, "textures/moon_normal"));
            moonGo = createTexturedPlanet({
                name: "Moon", radius: SIZE.moon,
                color: new Color(0.75, 0.75, 0.72, 1), smoothness: 0.2,
                textures: { albedo: albedo ?? undefined, normal: normal ?? undefined },
            });
        }
        moonGo.transform.parent = this._earthTracker.transform;
        const orb = moonGo.addComponent(Orbiter) as any;
        orb.radius = 1.2; orb.speed = 120; orb.useLocalSpace = true;
    }

    private _addOrbit(go: GameObject, r: number, s: number, t = 0): void {
        const o = go.addComponent(Orbiter) as any;
        o.radius = r; o.speed = s; if (t) o.tilt = t;
    }
    private _addRotator(go: GameObject, speed: number): void {
        // Negated so a planet spins the way it orbits, which is what every planet
        // here does — the two components disagreed on sign. `Orbiter` carries a
        // body from +X toward +Z, while a positive rotation about +Y takes +Z
        // toward +X, as Unity defines it. Orbits ran anticlockwise and spins
        // clockwise until this.
        (go.addComponent(Rotator) as any).speed = -speed;
    }
}