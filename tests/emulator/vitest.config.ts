import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The Firebase Emulator suite: contract tests that talk to a real (local)
// Firestore instance instead of mocks, so security rules and query behavior
// are verified against the actual service rather than assumed. It is
// isolated from the root `vitest.config.ts` — see `bun run test:emulator` in
// package.json, which starts the emulator, runs this config, then tears the
// emulator down — so the default `bun run test` never needs an emulator
// running and this suite never runs twice under two configs.
export default defineConfig({
  // Pin the project root to this directory. Vitest resolves `include` against
  // the root, not against the config file, and the root otherwise defaults to
  // the process's cwd — the repo root, since `bun run test:emulator` runs from
  // there. A repo-relative glob would then sweep the whole checkout, including
  // the full copies under `.claude/worktrees/` that the agent workflow creates.
  root: fileURLToPath(new URL(".", import.meta.url)),
  test: {
    // A machine-readable transcript of the run alongside the terminal output,
    // uploaded by CI as an artifact (`.github/workflows/ci.yml`). The path is
    // resolved from this file rather than left relative because Vitest resolves
    // `outputFile` against the project root pinned above — a relative path
    // would bury the report inside `tests/emulator/`, away from every other
    // suite's. `vitest-report/` is the repo root's, shared with the unit
    // suite's own `unit.json`.
    reporters: [
      "default",
      [
        "json",
        {
          outputFile: fileURLToPath(
            new URL("../../vitest-report/emulator.json", import.meta.url),
          ),
        },
      ],
    ],
    environment: "node",
    include: ["**/*.test.ts"],
    hookTimeout: 30_000,
    testTimeout: 20_000,
  },
});
