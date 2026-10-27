import { test } from "node:test";
import assert from "node:assert/strict";
import { compileCircuitHelpers } from "./helpers.mjs";

const { Circuit, Tasks } = compileCircuitHelpers();
const { solve } = Circuit;
const { isTaskSolved, withinTolerance, scoreOf, TaskProgress, TASKS } = Tasks;

const solved = (key, emf, r, closed = true) => isTaskSolved(key, emf, solve(key, emf, r, closed));

test("there is one task per template, in tab order", () => {
    assert.deepEqual(TASKS.map((t) => t.key), Circuit.TEMPLATES.map((t) => t.key));
});

test("withinTolerance: at, inside and outside 2 %", () => {
    assert.ok(withinTolerance(0.51, 0.5), "exactly +2 % counts");
    assert.ok(withinTolerance(0.49, 0.5), "exactly -2 % counts");
    assert.ok(withinTolerance(0.5, 0.5));
    assert.ok(!withinTolerance(0.5101, 0.5));
    assert.ok(!withinTolerance(0.4899, 0.5));
});

test("DW_2_1 single lamp: 0.5 A at, inside, outside the tolerance", () => {
    assert.ok(solved("single", 12, [24]), "12/24 = 0.5 A");
    assert.ok(solved("single", 12.1, [24]), "inside (+0.8 %)");
    assert.ok(solved("single", 12.24, [24]), "exactly +2 %");
    assert.ok(solved("single", 11.76, [24]), "exactly -2 %");
    assert.ok(!solved("single", 12.3, [24]), "+2.5 % is outside");
    assert.ok(!solved("single", 11.5, [24]), "-4 % is outside");
});

test("DW_2_1 series: 0.2 A at EMF 12 V", () => {
    assert.ok(solved("series", 12, [20, 20, 20]), "12/60 = 0.2 A");
    assert.ok(solved("series", 12, [20.4, 20, 20]), "inside");
    assert.ok(solved("series", 12, [10, 20, 29.4]), "R = 59.4: +1 % current, inside");
    assert.ok(!solved("series", 12, [10, 20, 33]), "R = 63: -4.8 % current, outside");
    assert.ok(!solved("series", 12, [10, 10, 10]), "0.4 A");
    assert.ok(!solved("series", 6, [10, 10, 10]), "0.2 A at the wrong EMF is not the task");
    assert.ok(solved("series", 12.24, [20.4, 20.4, 20.4]), "EMF exactly +2 %, current exactly 0.2 A");
    assert.ok(!solved("series", 12.5, [20.8, 20.8, 20.8]), "EMF +4 % is outside even at 0.2 A");
});

test("DW_2_1 parallel: I(R1) = 2 I(R2)", () => {
    assert.ok(solved("parallel", 12, [10, 20, 20]), "exact");
    assert.ok(solved("parallel", 12, [10.2, 20, 20]), "R1 +2 %: I1 is 1.96 % short of 2*I2, inside");
    assert.ok(solved("parallel", 12, [10.1, 20, 20]), "inside");
    assert.ok(!solved("parallel", 12, [10.5, 20, 20]), "ratio 1.905 outside");
    assert.ok(!solved("parallel", 12, [20, 20, 20]), "equal branches, ratio 1");
});

test("DW_2_1 mixed: R_eq = 50 Ohm", () => {
    assert.ok(solved("mixed", 12, [30, 40, 40]), "30 + 20 = 50");
    assert.ok(solved("mixed", 12, [31, 40, 40]), "exactly +2 % (51)");
    assert.ok(solved("mixed", 12, [29, 40, 40]), "exactly -2 % (49)");
    assert.ok(!solved("mixed", 12, [31.5, 40, 40]), "51.5 outside");
    assert.ok(!solved("mixed", 12, [10, 20, 20]), "R_eq = 20");
});

test("DW_2_1 open switch never solves a task, even where 0 = 2*0", () => {
    assert.ok(!solved("single", 12, [24], false));
    assert.ok(!solved("series", 12, [20, 20, 20], false));
    assert.ok(!solved("parallel", 12, [10, 20, 20], false), "0 = 2*0 must not count");
    assert.ok(!solved("mixed", 12, [30, 40, 40], false), "R_eq ignores the switch, the task must not");
});

test("scoreOf is the share of solved tasks", () => {
    assert.equal(scoreOf([false, false, false, false]), 0);
    assert.equal(scoreOf([true, false, true, false]), 0.5);
    assert.equal(scoreOf([true, true, true, true]), 1);
});

test("TaskProgress reports a change only when the solved set changes", () => {
    const p = new TaskProgress();
    const ok = solve("single", 12, [24], true);
    assert.equal(p.score, 0);
    assert.equal(p.evaluate("single", 12, ok), true);
    assert.equal(p.score, 0.25);
    assert.equal(p.evaluate("single", 12, ok), false, "same set, no new report");
    assert.equal(p.evaluate("single", 12.1, solve("single", 12.1, [24], true)), false, "still solved");
    assert.equal(p.score, 0.25);
});

test("TaskProgress: a solved task that becomes unsolved lowers the score", () => {
    const p = new TaskProgress();
    p.evaluate("single", 12, solve("single", 12, [24], true));
    p.evaluate("mixed", 12, solve("mixed", 12, [30, 40, 40], true));
    assert.equal(p.score, 0.5);
    assert.equal(p.evaluate("mixed", 12, solve("mixed", 12, [30, 40, 40], false)), true, "switch opened");
    assert.equal(p.score, 0.25);
    assert.equal(p.isSolved("single"), true, "a task on another tab is untouched");
    assert.equal(p.isSolved("mixed"), false);
});

test("TaskProgress: all four solved is completed", () => {
    const p = new TaskProgress();
    p.evaluate("single", 12, solve("single", 12, [24], true));
    p.evaluate("series", 12, solve("series", 12, [20, 20, 20], true));
    p.evaluate("parallel", 12, solve("parallel", 12, [10, 20, 20], true));
    assert.equal(p.completed, false);
    p.evaluate("mixed", 12, solve("mixed", 12, [30, 40, 40], true));
    assert.equal(p.score, 1);
    assert.equal(p.completed, true);
});
