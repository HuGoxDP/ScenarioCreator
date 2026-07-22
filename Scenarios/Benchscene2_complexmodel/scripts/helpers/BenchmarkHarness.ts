// scripts/helpers/BenchmarkHarness.ts
// ============================================================
// Automated benchmark metric collector for academic paper data.
// Pre-allocates all storage — zero allocation during tick().
//
// Usage:
//   private _bench = new BenchmarkHarness({ label: "Scene1", ... });
//   update(): void { this._bench.tick(); }
//
// After completion the result is:
//   - logged to the console as a copyable JSON blob,
//   - pushed to (window as any).__benchResults__ for batch scrapers,
//   - exposed via .result and .reported for programmatic polling.
// ============================================================

import { Application } from "WebEngineTS";

// ==================== CONFIG ====================

export interface BenchConfig {
    /** Frames to skip before sampling (default 120 ≈ 2s). */
    warmup?: number;
    /** Frames to sample after warmup (default 600 ≈ 10s). */
    sample?: number;
    /** Label for console output and JSON export. */
    label?: string;
    /** How many first frames to record individually for shader warmup analysis. */
    firstFrameCount?: number;
}

// ==================== RESULT ====================

export interface BenchResult {
    label: string;
    totalFrames: number;
    frameTime: {
        min: number; max: number; avg: number;
        median: number; p95: number; p99: number; stddev: number;
    };
    fps: { avg: number; min: number; max: number };
    firstFrames: number[];
    loadTimeMs: number;
    renderer: {
        drawCalls: number; triangles: number;
        textures: number; geometries: number; shaderPrograms: number;
    };
    memory: { heapUsedMB: number; heapTotalMB: number } | null;
    scene: { gameObjects: number } | null;
    resolution: { width: number; height: number; pixelRatio: number } | null;
    timestamp: number;
}

// ==================== HARNESS ====================

export class BenchmarkHarness {

    private readonly _warmup: number;
    private readonly _sampleCount: number;
    private readonly _label: string;
    private readonly _firstFrameMax: number;

    // Pre-allocated sample storage
    private readonly _times: Float64Array;
    private readonly _firstFrames: number[] = [];

    private _frame = 0;
    private _sampleIdx = 0;
    private _prevTime = 0;
    private _done = false;
    private _reported = false;
    private _result: BenchResult | null = null;

    /** Set this from awake() to record scene construction time. */
    public loadTimeMs = 0;

    constructor(config?: BenchConfig) {
        this._warmup = config?.warmup ?? 120;
        this._sampleCount = config?.sample ?? 600;
        this._label = config?.label ?? "Benchmark";
        this._firstFrameMax = config?.firstFrameCount ?? 60;
        this._times = new Float64Array(this._sampleCount);
    }

    get isDone(): boolean { return this._done; }
    get reported(): boolean { return this._reported; }
    get result(): BenchResult | null { return this._result; }

    /** Call once per frame from update(). */
    tick(): void {
        if (this._done) return;

        const now = performance.now();
        this._frame++;

        // ── Warmup ──
        if (this._frame <= this._warmup) {
            if (this._frame === 1) {
                console.log(`[Bench] "${this._label}" warmup ${this._warmup} frames...`);
            }
            this._prevTime = now;
            return;
        }

        if (this._frame === this._warmup + 1) {
            console.log(`[Bench] "${this._label}" sampling ${this._sampleCount} frames...`);
            this._prevTime = now;
            return;
        }

        // ── Sampling ──
        const dt = now - this._prevTime;
        this._prevTime = now;

        if (this._firstFrames.length < this._firstFrameMax) {
            this._firstFrames.push(dt);
        }

        this._times[this._sampleIdx] = dt;
        this._sampleIdx++;

        if (this._sampleIdx >= this._sampleCount) {
            this._done = true;
            this._result = this._compute();
        }
    }

    /** Logs formatted report + copyable JSON. Returns result. */
    report(): BenchResult {
        if (!this._result) throw new Error("[Bench] Not done yet.");
        this._reported = true;
        const r = this._result;
        const ft = r.frameTime;

        console.group(`%c[Bench] ${r.label}`, "color:#4FC3F7;font-weight:bold");
        console.log(`Load: ${r.loadTimeMs.toFixed(0)}ms`);
        console.log(
            `Frame: avg=${ft.avg.toFixed(2)} med=${ft.median.toFixed(2)} ` +
            `p95=${ft.p95.toFixed(2)} p99=${ft.p99.toFixed(2)} ` +
            `min=${ft.min.toFixed(2)} max=${ft.max.toFixed(2)} σ=${ft.stddev.toFixed(2)}ms`
        );
        console.log(`FPS: avg=${r.fps.avg.toFixed(1)} min=${r.fps.min.toFixed(1)} max=${r.fps.max.toFixed(1)}`);
        console.log(
            `Render: ${r.renderer.drawCalls} dc | ${r.renderer.triangles} tri | ` +
            `${r.renderer.textures} tex | ${r.renderer.geometries} geo | ${r.renderer.shaderPrograms} shaders`
        );
        if (r.memory) console.log(`Heap: ${r.memory.heapUsedMB.toFixed(1)} / ${r.memory.heapTotalMB.toFixed(1)} MB`);
        if (r.scene) console.log(`GameObjects: ${r.scene.gameObjects}`);
        console.log(`First 10 frames (ms): [${r.firstFrames.slice(0, 10).map(v => v.toFixed(1)).join(", ")}]`);
        console.groupEnd();

        // Push to window-attached results array so external scrapers
        // (Puppeteer, manual DevTools copy, Playwright) can read all runs.
        const w = window as any;
        if (!Array.isArray(w.__benchResults__)) w.__benchResults__ = [];
        w.__benchResults__.push(r);
        w.__lastBenchResult__ = r;

        console.log(`%c[Bench] JSON →`, "color:#8b949e", JSON.stringify(r, null, 2));
        console.log(`%c[Bench] window.__benchResults__ now has ${w.__benchResults__.length} result(s)`, "color:#8b949e");
        return r;
    }

    // ── Computation ──

    private _compute(): BenchResult {
        const n = this._sampleCount;
        const sorted = new Float64Array(this._times);
        sorted.sort();

        let sum = 0;
        for (let i = 0; i < n; i++) sum += sorted[i];
        const avg = sum / n;

        let variance = 0;
        for (let i = 0; i < n; i++) {
            const d = sorted[i] - avg;
            variance += d * d;
        }

        const app = Application.current;
        const renderer = app?._internalThreeRenderer;
        const info = renderer?.info;
        const canvas = app?.canvas;
        const mem = (performance as any).memory;
        const sceneMgr = (globalThis as any).__webengine_scene_manager__;

        return {
            label: this._label,
            totalFrames: n,
            loadTimeMs: this.loadTimeMs,
            timestamp: Date.now(),
            frameTime: {
                min: sorted[0],
                max: sorted[n - 1],
                avg,
                median: sorted[Math.floor(n * 0.5)],
                p95: sorted[Math.floor(n * 0.95)],
                p99: sorted[Math.floor(n * 0.99)],
                stddev: Math.sqrt(variance / n),
            },
            fps: {
                avg: 1000 / avg,
                min: 1000 / sorted[n - 1],
                max: 1000 / sorted[0],
            },
            firstFrames: [...this._firstFrames],
            renderer: {
                drawCalls: info?.render?.calls ?? 0,
                triangles: info?.render?.triangles ?? 0,
                textures: info?.memory?.textures ?? 0,
                geometries: info?.memory?.geometries ?? 0,
                shaderPrograms: info?.programs?.length ?? 0,
            },
            memory: mem ? {
                heapUsedMB: mem.usedJSHeapSize / 1048576,
                heapTotalMB: mem.totalJSHeapSize / 1048576,
            } : null,
            scene: sceneMgr?.activeScene ? {
                gameObjects: sceneMgr.activeScene.gameObjectCount ?? 0,
            } : null,
            resolution: canvas ? {
                width: canvas.width,
                height: canvas.height,
                pixelRatio: window.devicePixelRatio || 1,
            } : null,
        };
    }
}
