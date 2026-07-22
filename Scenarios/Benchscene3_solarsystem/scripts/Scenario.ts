// scripts/Scenario.ts  (Benchmark Scene 3 — Solar System)
// ============================================================
// Adapted from Solar System v3.5 for academic benchmarking.
// Same scene, same visuals — but with CONFIG flags to toggle
// each optimization independently for before/after measurement.
//
// RUN ORDER for paper Table 2:
//   Run 3.1: CONFIG = all false/0           → pure baseline
//   Run 3.2: + textureMaxSize = 2048        → maxSize only
//   Run 3.3: + releaseArchive = true        → + archive release
//   Run 3.4: + releaseSourceImages = true   → + CPU texture release
//   Run 3.5: + shaderWarmup = true          → + shader pre-compilation
//   Run 3.6: + dirtyTransforms = true       → full stack
//
// Each run: change one flag, rebuild ZIP, run 3 times, record avg.
// ============================================================

import {
    ScenarioBehaviour, GameObject, Vector3, Color,
    PointLight, AmbientLight, DirectionalLight,
    MeshFilter, MeshRenderer, Mesh,
    Material, Shader, Input, KeyCode,
    Texture2D, Resources, Transform,
    Cubemap, RenderSettings,
    MemoryProfiler,
    Application,
} from "WebEngineTS";

import { createCameraRig, type ICameraRig } from "./helpers/CameraSetup";
import { createOrbitRing, createTexturedPlanet, normalizeModelToRadius } from "./helpers/PlanetFactory";
import { Orbiter, setSimulationPaused } from "./components/Orbiter";
import { Rotator } from "./components/Rotator";
import { BenchmarkHarness } from "./helpers/BenchmarkHarness";

// ==================== BENCHMARK CONFIGURATION ====================
// Toggle each optimization independently. Change ONE flag per run.

const CONFIG = {
    /** Texture resolution limit. 0 = off (baseline), 2048/4096 = on. */
    textureMaxSize: 0,

    /** Release ZIP archive after all assets loaded. */
    releaseArchive: false,

    /** Release CPU-side texture data after GPU upload. */
    releaseSourceImages: false,

    /** Load .ktx2 compressed textures instead of .png/.jpg.
     *  Requires .ktx2 files in assets/textures/ and basis WASM served at
     *  Texture2D.ktx2TranscoderPath ("/basis/" by default). */
    useKTX2: false,

    /** Pre-compile all shaders before first render frame. */
    shaderWarmup: false,

    /** Use dirty-flag transform updates. */
    dirtyTransforms: false,

    /** Show MemoryProfiler overlay. Off for paper-quality numbers
     *  (the overlay's RAF + DOM writes add ~0.1–0.5 ms per frame). */
    showOverlay: false,
};

// Benchmark timing
const WARMUP = 180;   // 3s — skybox + textures need GPU upload time
const SAMPLES = 600;  // 10s

// ==================== SCALE CONSTANTS (identical to original) ====================

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

// Planet definitions (identical to original except `initialAngle`,
// which fixes the orbital starting position so every benchmark run
// produces the same scene composition — no Math.random() drift).
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
    private _loadedTextures: Texture2D[] = [];
    private _skybox: Cubemap | null = null;
    private _bench!: BenchmarkHarness;

    /** Countdown for deferred CPU texture release. */
    private _releaseCountdown = -1;

    override async awake(): Promise<void> {
        const loadStart = performance.now();

        // ── Build label from config ──
        const flags: string[] = [];
        if (CONFIG.textureMaxSize) flags.push(`max${CONFIG.textureMaxSize}`);
        if (CONFIG.releaseArchive) flags.push("relArc");
        if (CONFIG.releaseSourceImages) flags.push("relSrc");
        if (CONFIG.useKTX2) flags.push("ktx2");
        if (CONFIG.shaderWarmup) flags.push("warmup");
        if (CONFIG.dirtyTransforms) flags.push("dirty");
        const label = `Scene3_Solar_${flags.length ? flags.join("_") : "baseline"}`;

        console.log(`[Scene3] ${label}`);
        console.log("[Scene3] CONFIG:", JSON.stringify(CONFIG, null, 2));

        // ── Enable dirty-flag transforms ──
        if (CONFIG.dirtyTransforms) {
            Transform._setDirtyTransformsEnabled(true);
            console.log("[Scene3] Dirty transforms enabled");
        }

        // ── KTX2: configure transcoder path before loading ──
        if (CONFIG.useKTX2) {
            Texture2D.ktx2TranscoderPath = "/assets/basis/";
            console.log("[Scene3] KTX2 mode enabled — transcoder path:", Texture2D.ktx2TranscoderPath);
        }

        // ── Apply texture limit BEFORE loading ──
        if (CONFIG.textureMaxSize > 0) {
            Texture2D.maxSize = CONFIG.textureMaxSize;
        }

        // ── Camera (identical to original) ──
        this._camera = createCameraRig({
            useSkybox: true, orbitDistance: 38,
            backgroundColor: new Color(0.01, 0.01, 0.03, 1),
        });

        // ── Scene construction (identical to original) ──
        await this._loadSkybox();
        this._createLights();
        await this._createSun();
        await this._createAllPlanets();
        await this._createMoon();

        for (const [name, radius] of Object.entries(ORBIT)) {
            createOrbitRing(`${name} Orbit`, radius);
        }

        // ── Memory snapshot BEFORE optimizations ──
        const heapBefore = (performance as any).memory?.usedJSHeapSize / 1048576;
        console.log(`[Scene3] Heap BEFORE optimizations: ${heapBefore?.toFixed(1)} MB`);
        MemoryProfiler.logReport();

        // ── Apply optimizations ──
        if (CONFIG.releaseArchive) {
            this.context.assets.releaseArchive();
            console.log("[Scene3] Archive released");
        }

        // ── Shader warmup ──
        if (CONFIG.shaderWarmup) {
            Application.current?.warmupShaders();
            console.log("[Scene3] Shader warmup done");
        }

        const loadTime = performance.now() - loadStart;
        console.log(`[Scene3] Scene built in ${loadTime.toFixed(0)}ms`);

        // ── Benchmark harness ──
        this._bench = new BenchmarkHarness({
            warmup: WARMUP, sample: SAMPLES, label,
            firstFrameCount: 60,
        });
        this._bench.loadTimeMs = loadTime;

        if (CONFIG.showOverlay) MemoryProfiler.showOverlay();
    }

    override start(): void {
        // Schedule deferred texture release
        if (CONFIG.releaseSourceImages) {
            this._releaseCountdown = 2;
        }

        // Memory after first render
        const heapAfterRender = (performance as any).memory?.usedJSHeapSize / 1048576;
        console.log(`[Scene3] Heap AFTER first render: ${heapAfterRender?.toFixed(1)} MB`);
    }

    override update(): void {
        // ── Deferred texture release ──
        if (this._releaseCountdown > 0) {
            this._releaseCountdown--;
            if (this._releaseCountdown === 0) {
                for (const tex of this._loadedTextures) {
                    tex.releaseSourceImage();
                }
                if (this._skybox) {
                    this._skybox.releaseSourceImage();
                }
                this._loadedTextures = [];
                console.log("[Scene3] CPU texture data released");

                const heapAfter = (performance as any).memory?.usedJSHeapSize / 1048576;
                console.log(`[Scene3] Heap AFTER release: ${heapAfter?.toFixed(1)} MB`);
                MemoryProfiler.logReport();
            }
        }

        // ── Camera controls ──
        if (Input.getKeyDown(KeyCode.Digit1)) this._camera.activateOrbit();
        if (Input.getKeyDown(KeyCode.Digit2)) this._camera.activateFly();
        if (Input.getKeyDown(KeyCode.Digit3)) this._camera.activateFollow(this._earthTracker.transform);

        if (Input.getKeyDown(KeyCode.KeyP)) {
            this._paused = !this._paused;
            setSimulationPaused(this._paused);
        }

        // ── Benchmark ──
        this._bench.tick();
        if (this._bench.isDone && !this._bench.reported) {
            this._bench.report();
        }
    }

    override onDestroy(): void {
        setSimulationPaused(false);
        if (CONFIG.dirtyTransforms) {
            Transform._setDirtyTransformsEnabled(false);
        }
        if (CONFIG.showOverlay) MemoryProfiler.hideOverlay();
        Texture2D.maxSize = 0;
        Resources.unloadUnused();
    }

    // ═══════════════════ SCENE CONSTRUCTION (identical to original) ═══════════════════

    private _track(tex: Texture2D | null): Texture2D | null {
        if (tex) this._loadedTextures.push(tex);
        return tex;
    }

    /**
     * Returns the asset path for a texture, routing to .ktx2 when
     * CONFIG.useKTX2 is enabled. The KTX2 file must exist alongside
     * the original in assets/textures/ (e.g. "earth.ktx2").
     */
    private _tex(name: string): string {
        return CONFIG.useKTX2 ? `textures/${name}.ktx2` : `textures/${name}`;
    }

    private async _loadSkybox(): Promise<void> {
        try {
            const url = await Resources.getUrl("skybox/stars_panorama.jpg");
            this._skybox = await Cubemap.fromEquirectangular(url);
            RenderSettings.skybox = this._skybox;
            console.log("[Skybox] Loaded");
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
        const sunTex = this._track(await Resources.tryLoad(Texture2D, this._tex("sun")));
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
                const albedo   = this._track(def.texAlbedo   ? await Resources.tryLoad(Texture2D, this._tex(def.texAlbedo))   : null);
                const normal   = this._track(def.texNormal   ? await Resources.tryLoad(Texture2D, this._tex(def.texNormal))   : null);
                const emissive = this._track(def.texEmissive ? await Resources.tryLoad(Texture2D, this._tex(def.texEmissive)) : null);

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
            const albedo = this._track(await Resources.tryLoad(Texture2D, this._tex("moon")));
            const normal = this._track(await Resources.tryLoad(Texture2D, this._tex("moon_normal")));
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