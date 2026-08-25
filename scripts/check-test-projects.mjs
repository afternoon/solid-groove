#!/usr/bin/env node
/**
 * Guard the partition between the Vitest projects in `vitest.config.ts`.
 *
 * The projects are include-glob based, which makes two silent failures
 * possible, and both of them look like a green run:
 *
 *   - a test file matched by **no** project simply never executes. Adding
 *     `src/newthing/` and forgetting the glob means its suite is dead on
 *     arrival, and nothing says so.
 *   - a file matched by **two** projects runs twice, doubling its cost and,
 *     for anything with shared module state, potentially passing in one
 *     project only because the other ran first.
 *
 * So this asks Vitest itself which files each project collects — not a
 * reimplementation of the globs, which could drift from the real config — and
 * fails if the union is not an exact partition of the test files on disk.
 */

import { execFileSync } from "node:child_process";
import { relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const PROJECTS = ["domain", "audio", "ui", "data", "platform", "library-pipeline"];

/** Every test file git knows about, excluding the separately-configured suites. */
function filesOnDisk() {
  const out = execFileSync("git", ["ls-files", "*.test.ts", "*.test.tsx", "*.test.mjs"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  return new Set(
    out
      .split("\n")
      .filter(Boolean)
      // `tests/` holds the emulator and Playwright suites, which have their own
      // configs and are deliberately not part of this config's projects.
      .filter((f) => !f.startsWith("tests/")),
  );
}

/** The files one project actually collects, straight from Vitest. */
function filesInProject(project) {
  const out = execFileSync(
    "bunx",
    ["vitest", "list", "--filesOnly", "--project", project],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  return (
    out
      .split("\n")
      .map((line) => line.trim())
      // Vitest colours its output and prefixes each path with the owning
      // project, e.g. `[platform] src/telemetry.test.ts`. Strip both — leaving
      // either on makes every path a file that does not exist.
      // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI colour codes
      .map((line) => line.replace(/\[[0-9;]*m/g, ""))
      .map((line) => line.replace(/^\[[^\]]*\]\s*/, ""))
      .filter((line) => /\.test\.(ts|tsx|mjs)$/.test(line))
      .map((line) => (line.startsWith("/") ? relative(ROOT, line) : line))
  );
}

const disk = filesOnDisk();
const owners = new Map(); // file -> [project, ...]

for (const project of PROJECTS) {
  for (const file of filesInProject(project)) {
    if (!owners.has(file)) owners.set(file, []);
    owners.get(file).push(project);
  }
}

const failures = [];

for (const file of disk) {
  if (!owners.has(file))
    failures.push(
      `${file} is matched by no project in vitest.config.ts, so it never runs. Add its directory to one project's include globs.`,
    );
}

for (const [file, claimed] of owners) {
  if (claimed.length > 1)
    failures.push(
      `${file} is matched by ${claimed.length} projects (${claimed.join(", ")}), so it runs more than once. Narrow the globs so exactly one owns it.`,
    );
  if (!disk.has(file))
    failures.push(
      `${file} is collected by ${claimed.join(", ")} but git does not track it as a test file. Check the include globs.`,
    );
}

if (failures.length > 0) {
  console.error(`\ncheck-test-projects — ${failures.length} problem(s):\n`);
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error("");
  process.exit(1);
}

console.log(
  `check-test-projects — ${disk.size} test file(s), each owned by exactly one of ${PROJECTS.length} projects.`,
);
