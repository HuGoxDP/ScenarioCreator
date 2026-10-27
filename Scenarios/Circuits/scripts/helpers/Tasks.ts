// scripts/helpers/Tasks.ts
// ============================================================
// Task mode: one task per circuit template, checked against the same solver
// the readout uses.
//
// Pure, like Circuit.ts: no engine imports, so the checks run in Node and
// `tests/tasks.test.mjs` pins them at, inside and outside the tolerance.
// ============================================================

import type { Solution, TemplateKey } from "./Circuit";

/** A task counts as solved within this share of its target. */
export const TOLERANCE = 0.02;

/**
 * `actual` within ±TOLERANCE of `target`. The epsilon makes "exactly ±2 %"
 * count: 0.51 − 0.5 is 0.010000000000000009 in floating point, just over the
 * 0.01 it is supposed to equal.
 */
export function withinTolerance(actual: number, target: number): boolean {
    return Math.abs(actual - target) <= TOLERANCE * Math.abs(target) + 1e-9;
}

export interface Task {
    key: TemplateKey;
    /** Statement shown in the task panel. */
    text: string;
    /** Is the task solved by this solution at this EMF? Assumes a live circuit. */
    check(emf: number, solution: Solution): boolean;
}

export const TASKS: Task[] = [
    {
        key: "single",
        text: "Лампа: струм 0,5 А",
        check: (_emf, s) => withinTolerance(s.elements[0].current, 0.5),
    },
    {
        key: "series",
        text: "Послідовне: загальний струм 0,2 А при ЕРС 12 В",
        check: (emf, s) => withinTolerance(emf, 12) && withinTolerance(s.current, 0.2),
    },
    {
        key: "parallel",
        text: "Паралельне: струм через R₁ вдвічі більший, ніж через R₂",
        check: (_emf, s) => withinTolerance(s.elements[0].current, 2 * s.elements[1].current),
    },
    {
        key: "mixed",
        text: "Змішане: R_екв = 50 Ом",
        check: (_emf, s) => withinTolerance(s.equivalent, 50),
    },
];

/**
 * Whether the task for `key` is solved. An open switch (or a short) never
 * solves one: currents are 0, which would otherwise satisfy "I₁ = 2·I₂" and
 * would leave the mixed task's R_екв, which ignores the switch, solved by an
 * unpowered circuit.
 */
export function isTaskSolved(key: TemplateKey, emf: number, solution: Solution): boolean {
    if (solution.open || solution.shorted) return false;
    const task = TASKS.find((t) => t.key === key);
    return task !== undefined && task.check(emf, solution);
}

/** Share of solved tasks, 0..1. */
export function scoreOf(solved: readonly boolean[]): number {
    return solved.filter(Boolean).length / TASKS.length;
}

/** Which tasks are solved, and the score that follows from it. */
export class TaskProgress {
    private readonly _solved: boolean[] = TASKS.map(() => false);

    /** Re-checks `key`'s task; returns true when that changed the solved set. */
    evaluate(key: TemplateKey, emf: number, solution: Solution): boolean {
        const index = TASKS.findIndex((t) => t.key === key);
        const solved = isTaskSolved(key, emf, solution);
        if (index < 0 || this._solved[index] === solved) return false;
        this._solved[index] = solved;
        return true;
    }

    isSolved(key: TemplateKey): boolean {
        return this._solved[TASKS.findIndex((t) => t.key === key)] === true;
    }

    get score(): number {
        return scoreOf(this._solved);
    }

    get completed(): boolean {
        return this.score === 1;
    }
}

export interface TaskResult {
    score: number;
    completed: boolean;
}

/**
 * Glue between the checks and the host: re-checks a task and passes the score
 * to `sink` (the scenario's `reportResult`) once from {@link start}, then only
 * when the solved set changes. Before `start()` it tracks silently, because the
 * engine accepts reports only from `start()` on while the scenario builds its
 * first state in `awake()`.
 */
export class TaskReporter {
    readonly progress = new TaskProgress();
    private _reporting = false;

    constructor(private readonly _sink: (result: TaskResult) => void) {}

    start(): void {
        this._reporting = true;
        this._report();
    }

    evaluate(key: TemplateKey, emf: number, solution: Solution): void {
        if (this.progress.evaluate(key, emf, solution)) this._report();
    }

    private _report(): void {
        if (this._reporting) {
            this._sink({ score: this.progress.score, completed: this.progress.completed });
        }
    }
}
