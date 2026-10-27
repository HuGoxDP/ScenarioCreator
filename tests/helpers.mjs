// Shared test plumbing: compiles the Circuits helpers (pure TypeScript, no
// engine imports) with the repo's own tsc so Node can require them.
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

export const rootDir = path.resolve(import.meta.dirname, "..");

export function compileCircuitHelpers() {
    const out = mkdtempSync(path.join(tmpdir(), "circuits-helpers-"));
    const helpers = path.join(rootDir, "Scenarios", "Circuits", "scripts", "helpers");
    execFileSync(process.execPath, [
        path.join(rootDir, "node_modules", "typescript", "lib", "tsc.js"),
        "--ignoreConfig", "--target", "ES2020", "--module", "commonjs", "--strict",
        "--skipLibCheck", "--outDir", out,
        path.join(helpers, "Circuit.ts"), path.join(helpers, "Tasks.ts"),
    ], { stdio: "inherit" });
    const require = createRequire(path.join(out, "x.js"));
    return { Circuit: require("./Circuit.js"), Tasks: require("./Tasks.js") };
}
