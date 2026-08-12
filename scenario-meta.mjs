// scenario-meta.mjs — one answer to "what is this scenario called, and what is
// each of its assets called", shared by both builders.
//
// WHY THIS IS SHARED RATHER THAN COPIED
//   build-package.mjs writes the ZIP's manifest.json and build-manifest.mjs
//   writes scenario.json. They describe the same content through different
//   doors, and two things have to agree across them or the doors lead to
//   different rooms:
//
//     - the scenario **id**, because the platform records it and a scenario
//       that renames itself depending on which artifact you read is worse than
//       one with a placeholder name;
//     - the asset **guid**, because a scene serialized while running from a ZIP
//       has to keep resolving when the same scenario is later served from a
//       manifest. Derive them separately and they silently diverge.
//
// WHAT REPLACED THE TEMPLATE PLACEHOLDERS
//   Every archive used to report id `template.<name>` and version
//   `0.0.1-template`, so the platform's admin screen showed `0.0.1-template`
//   where a version belongs. The fallbacks below are *derived* rather than
//   fictional: an id is the folder name slugified, a name is the folder name.
//   Fields nobody has stated — description, author — are left out rather than
//   filled with a plausible-looking invention, because a wrong author is worse
//   in a catalogue than a missing one.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/** The file a scenario states its own identity in. Optional. */
export const META_FILENAME = "scenario.meta.json";

/** Folder name to catalogue slug: `Benchscene3_solarsystem` → `benchscene3-solarsystem`. */
export function slugFor(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/**
 * Stable per-asset identity.
 *
 * Derived from the scenario id and the asset's path, never from its bytes: a
 * guid has to survive re-encoding a texture, or a serialized scene stops
 * resolving the moment the asset is rebuilt. The engine drops assets without a
 * guid rather than minting one, for exactly this reason — an id that does not
 * outlive a reload is worse than none. Renaming an asset does change its guid,
 * which is the honest limit of deriving identity from a path.
 *
 * @param scenarioId the id from {@link readScenarioMeta}
 * @param assetPath the `assets/`-prefixed path, forward slashes
 */
export function assetGuid(scenarioId, assetPath) {
    // NUL separator: paths may contain spaces, and "a" + "b/c" must not be
    // able to collide with "a/b" + "c".
    return createHash("sha256")
        .update(`${scenarioId}\u0000${assetPath}`)
        .digest("hex")
        .slice(0, 32);
}

/**
 * Reads `<scenario>/scenario.meta.json`, filling in derived defaults.
 *
 * Absent is a normal state, not an error: a scenario nobody has written metadata
 * for still builds, and still gets a sane id instead of a placeholder one.
 *
 * @param scenarioDir absolute path to the scenario folder
 * @param scenarioName the folder's name
 */
export function readScenarioMeta(scenarioDir, scenarioName) {
    const metaPath = path.join(scenarioDir, META_FILENAME);
    const raw = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, "utf8")) : {};

    const str = (value) => (typeof value === "string" && value.length > 0 ? value : undefined);

    return {
        present: existsSync(metaPath),
        id: str(raw.id) ?? slugFor(scenarioName),
        name: str(raw.name) ?? scenarioName,
        description: str(raw.description),
        // The human release version, as the ZIP manifest and the platform's
        // catalogue show it.
        version: str(raw.version) ?? "1.0.0",
        // The streaming manifest's `version` is a number and answers a different
        // question: which build of the content the urls point at. Kept separate
        // rather than parsed out of the semver, because bumping a release does
        // not necessarily change a byte and vice versa.
        contentVersion: typeof raw.contentVersion === "number" ? raw.contentVersion : 1,
        category: str(raw.category),
        author: raw.author && typeof raw.author === "object" ? raw.author : undefined,
        priorities: raw.streaming?.priorities ? Object.entries(raw.streaming.priorities) : [],
    };
}

/**
 * The engine version this build compiled against.
 *
 * `node_modules/WebEngineTS/package.json` now carries a unique
 * `0.1.0-local.<timestamp>` per release, so this is a real answer to "which
 * engine was this built against" rather than the `0.0.0-template` it replaced —
 * and the first thing to check when a scenario compiles here but fails at
 * runtime in the platform, since each repository keeps its own engine tarball.
 */
export function installedEngineVersion(rootDir) {
    const pkg = path.join(rootDir, "node_modules", "WebEngineTS", "package.json");
    if (!existsSync(pkg)) return "unknown";
    try {
        return JSON.parse(readFileSync(pkg, "utf8")).version ?? "unknown";
    } catch {
        return "unknown";
    }
}
