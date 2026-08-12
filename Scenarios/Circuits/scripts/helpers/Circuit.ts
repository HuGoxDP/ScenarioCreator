// scripts/helpers/Circuit.ts
// ============================================================
// Four circuits, four closed-form solvers.
//
// NOT a general network solver. Three lines per template that anyone can check
// against the textbook beat one clever routine that nobody can — and the
// scenario ships four fixed circuits precisely so that this file can be read
// in one sitting.
//
// No engine imports: the electricity is checkable in Node, and the acceptance
// numbers at the bottom of this file were checked there before anything drew.
// ============================================================

export type TemplateKey = "single" | "series" | "parallel" | "mixed";

export interface Template {
    key: TemplateKey;
    name: string;
    /** How many of R₁…R₃ this circuit uses. */
    resistors: number;
    /** Template 1's load is the lamp itself. */
    hasLamp: boolean;
    lesson: string;
}

export const TEMPLATES: Template[] = [
    {
        key: "single", name: "Одна лампа", resistors: 1, hasLamp: true,
        lesson: "Закон Ома для ділянки кола: I = U/R. Опір лампи задає повзунок R₁, а яскравість пропорційна потужності P = U·I.",
    },
    {
        key: "series", name: "Послідовне з'єднання", resistors: 3, hasLamp: false,
        lesson: "R = R₁+R₂+R₃. Струм однаковий скрізь, а напруга ділиться пропорційно опорам. Носії заряду рухаються з однаковою швидкістю до й після резистора — струм не «витрачається».",
    },
    {
        key: "parallel", name: "Паралельне з'єднання", resistors: 3, hasLamp: false,
        lesson: "1/R = 1/R₁+1/R₂+1/R₃. Напруга однакова на всіх вітках, а струм ділиться обернено пропорційно опорам: найменший опір бере найбільший струм.",
    },
    {
        key: "mixed", name: "Змішане: R₁ і (R₂ ∥ R₃)", resistors: 3, hasLamp: false,
        lesson: "Обидва правила одразу — саме це питання трапляється на іспиті. Спершу згорніть паралельну пару, потім додайте послідовний опір.",
    },
];

export interface ElementReading {
    id: string;
    label: string;
    resistance: number;
    voltage: number;
    current: number;
    power: number;
}

export interface Solution {
    /** Equivalent resistance of the whole circuit. */
    equivalent: number;
    /** Current drawn from the source. */
    current: number;
    elements: ElementReading[];
    totalPower: number;
    /** True when the switch is open: everything is at rest. */
    open: boolean;
    /**
     * True when the equivalent resistance fell below the guard.
     *
     * The sliders start at 1 Ω so it cannot normally be reached, but the
     * parallel solver divides by a sum of reciprocals and a readout showing
     * `Infinity` teaches nothing.
     */
    shorted: boolean;
}

/** Below this the circuit is called shorted rather than divided by. */
const MIN_RESISTANCE = 0.05;

export function solve(key: TemplateKey, emf: number, resistances: number[], closed: boolean): Solution {
    const r = resistances.map((value) => Math.max(value, MIN_RESISTANCE));
    const labels = ["R₁", "R₂", "R₃"];

    let equivalent: number;
    let branchCurrents: number[];

    if (key === "single") {
        equivalent = r[0];
    } else if (key === "series") {
        equivalent = r[0] + r[1] + r[2];
    } else if (key === "parallel") {
        equivalent = 1 / (1 / r[0] + 1 / r[1] + 1 / r[2]);
    } else {
        equivalent = r[0] + 1 / (1 / r[1] + 1 / r[2]);
    }

    const shorted = equivalent < MIN_RESISTANCE * 2;
    const current = !closed || shorted ? 0 : emf / equivalent;

    if (key === "single") {
        branchCurrents = [current];
    } else if (key === "series") {
        // One current everywhere — the fact students most often doubt.
        branchCurrents = [current, current, current];
    } else if (key === "parallel") {
        // Same voltage across every branch; current splits as 1/R.
        branchCurrents = [emf, emf, emf].map((u, i) => (!closed || shorted ? 0 : u / r[i]));
    } else {
        const parallelVoltage = current * (1 / (1 / r[1] + 1 / r[2]));
        branchCurrents = [current, parallelVoltage / r[1], parallelVoltage / r[2]];
    }

    const used = key === "single" ? 1 : 3;
    const elements: ElementReading[] = [];
    for (let i = 0; i < used; i++) {
        const branchCurrent = branchCurrents[i] ?? 0;
        const voltage = branchCurrent * r[i];
        elements.push({
            id: `R${i + 1}`,
            label: key === "single" ? "Лампа" : labels[i],
            resistance: r[i],
            voltage,
            current: branchCurrent,
            power: voltage * branchCurrent,
        });
    }

    return {
        equivalent,
        current,
        elements,
        totalPower: emf * current,
        open: !closed,
        shorted,
    };
}

/**
 * Development guard, run once at load.
 *
 * These are the textbook identities the scenario exists to make visible, so
 * they are asserted rather than trusted: in series the current is the same
 * everywhere and the voltages sum to the EMF; in parallel the voltages are
 * equal and the currents sum to the total. The mixed case is checked against
 * the worked example from the task document.
 */
export function validateSolver(): string[] {
    const problems: string[] = [];
    const close = (a: number, b: number, tolerance = 1e-9): boolean => Math.abs(a - b) <= tolerance;

    const series = solve("series", 12, [10, 20, 30], true);
    if (!close(series.equivalent, 60)) problems.push(`series: R = ${series.equivalent}, expected 60`);
    if (!series.elements.every((e) => close(e.current, series.current))) {
        problems.push("series: currents differ between elements");
    }
    const seriesVoltage = series.elements.reduce((sum, e) => sum + e.voltage, 0);
    if (!close(seriesVoltage, 12, 1e-9)) problems.push(`series: voltages sum to ${seriesVoltage}, expected 12`);

    const parallel = solve("parallel", 12, [10, 20, 20], true);
    if (!close(parallel.equivalent, 5)) problems.push(`parallel: R = ${parallel.equivalent}, expected 5`);
    if (!parallel.elements.every((e) => close(e.voltage, 12, 1e-9))) {
        problems.push("parallel: voltages differ between branches");
    }
    const parallelCurrent = parallel.elements.reduce((sum, e) => sum + e.current, 0);
    if (!close(parallelCurrent, parallel.current, 1e-9)) {
        problems.push(`parallel: branch currents sum to ${parallelCurrent}, total is ${parallel.current}`);
    }

    // The worked example: R₁ = 10, R₂ = R₃ = 20, U = 12 V.
    const mixed = solve("mixed", 12, [10, 20, 20], true);
    if (!close(mixed.equivalent, 20)) problems.push(`mixed: R = ${mixed.equivalent}, expected 20`);
    if (!close(mixed.current, 0.6)) problems.push(`mixed: I = ${mixed.current}, expected 0.6`);
    if (!close(mixed.elements[0].voltage, 6)) problems.push(`mixed: U₁ = ${mixed.elements[0].voltage}, expected 6`);
    if (!close(mixed.elements[1].current, 0.3)) problems.push(`mixed: I₂ = ${mixed.elements[1].current}, expected 0.3`);
    if (!close(mixed.elements[2].current, 0.3)) problems.push(`mixed: I₃ = ${mixed.elements[2].current}, expected 0.3`);

    const openCircuit = solve("series", 12, [10, 20, 30], false);
    if (openCircuit.current !== 0) problems.push("open switch still passes current");

    return problems;
}
