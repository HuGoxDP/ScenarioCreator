import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readScenarioMeta } from "../scenario-meta.mjs";
import { rootDir } from "./helpers.mjs";

function metaWith(extra) {
    const dir = mkdtempSync(path.join(tmpdir(), "meta-"));
    writeFileSync(path.join(dir, "scenario.meta.json"), JSON.stringify({ id: "x", ...extra }));
    return readScenarioMeta(dir, "X");
}

test("readScenarioMeta: only a literal true is graded", () => {
    assert.equal(metaWith({ graded: true }).graded, true);
    assert.equal(metaWith({ graded: false }).graded, undefined);
    assert.equal(metaWith({ graded: "yes" }).graded, undefined);
    assert.equal(metaWith({}).graded, undefined);
});

test("DW_2_2 only Circuits declares graded in scenario.meta.json", () => {
    for (const root of ["Scenarios", "TestScenarios"]) {
        for (const name of readdirSync(path.join(rootDir, root))) {
            const meta = path.join(rootDir, root, name, "scenario.meta.json");
            if (!existsSync(meta)) continue;
            const graded = JSON.parse(readFileSync(meta, "utf8")).graded;
            assert.equal(graded === true, name === "Circuits", `${name} graded=${graded}`);
        }
    }
});

function manifestOf(zip) {
    const tar = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
    return JSON.parse(execFileSync(existsSync(tar) ? tar : "tar", ["-xOf", zip, "manifest.json"], { encoding: "utf8" }));
}

test("DW_2_2 built archives: Circuits manifest has graded true, Molecules has no graded key",
    { timeout: 300000 }, () => {
        execFileSync(process.execPath, ["build-package.mjs", "--scenario", "Circuits,Molecules"], {
            cwd: rootDir, stdio: "pipe",
        });
        const circuits = manifestOf(path.join(rootDir, "ReleaseScenarios", "Circuits.zip"));
        assert.equal(circuits.id, "electric-circuits");
        assert.strictEqual(circuits.graded, true);
        const molecules = manifestOf(path.join(rootDir, "ReleaseScenarios", "Molecules.zip"));
        assert.equal("graded" in molecules, false);
    });
