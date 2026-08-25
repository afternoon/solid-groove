import { fileURLToPath } from "node:url";
import solid from "vite-plugin-solid";
import { configDefaults, defineConfig } from "vitest/config";

// `vite-plugin-solid` normally auto-injects this setup file by checking
// `require.resolve("@testing-library/jest-dom/vitest")` and, if resolvable,
// handing Vite the *bare specifier* to resolve again later. Resolving that
// bare specifier a second time, inside a nested git worktree (this repo's own
// agent workflow runs each task in one under `.claude/worktrees/`), can walk
// up past the worktree's own `node_modules` and land on the outer checkout's
// copy instead — which Vite then refuses to load as outside its project root,
// failing every single test file before it reaches a single assertion.
// Resolving it once, here, to an absolute path removes the second lookup
// entirely, so the correct local package is used regardless of nesting.
//
// Note this resolves to the package's **ESM** entry. `import.meta.resolve`
// honours the `import` condition; a `createRequire(...).resolve()` here would
// honour `require` and hand back `dist/vitest.js`, the CJS build, which
// `require()`s vitest and dies with "Vitest cannot be imported in a CommonJS
// module" on every file.
const jestDomSetupPath = fileURLToPath(
  import.meta.resolve("@testing-library/jest-dom/vitest"),
);

/** Shared by every project: never collect from a nested worktree checkout. */
const exclude = [...configDefaults.exclude, "tests/**", ".claude/**"];

/**
 * One application project: Solid + jsdom, over a slice of `src/`.
 *
 * Deliberately the same shape as the single un-split config, so each project
 * inherits exactly the behaviour the suite already passed under.
 *
 * **Do not set `test.environment` here.** `vite-plugin-solid` applies `jsdom`
 * itself, but only when the user has not (`if (!userTest.environment)` in the
 * plugin). Setting it explicitly — even to `"jsdom"` — takes that branch away
 * and, with it, the `test.server.deps` inlining of `solid-js` the plugin
 * applies alongside.
 */
const appProject = (name: string, include: string[]) => ({
  plugins: [solid()],
  resolve: { conditions: ["development", "browser"] },
  test: { name, setupFiles: [jestDomSetupPath], exclude, include },
});

/**
 * The unit and component suite, split into named projects along the
 * architecture's own layers (see `docs/architecture.html`).
 *
 * This is a *filtering* device, not a coverage boundary: the projects below
 * partition exactly the files one config collected before, so `bun run
 * test:all` is the same suite it always was. What the split buys is running
 * one layer (`--project=audio`) and reading a failure or a slowdown as
 * belonging to a layer rather than to "the tests".
 *
 * `library-pipeline` is the one project that is *not* application code — it
 * covers the sample-library build tooling under `scripts/`, which an engineer
 * runs by hand and which changes infrequently. It is most of the suite's wall
 * clock, so `bun run test` leaves it out and `bun run test:library` runs it.
 * CI runs `bun run test:all`, which includes it, so nothing merges without it
 * having run — see `.github/workflows/ci.yml`.
 *
 * Adding a new `src/` directory means adding it to one of these projects. A
 * file matched by no project is silently never run, and a file matched by two
 * runs twice — `bun run verify:test-projects` fails on either.
 *
 * **Requires Vitest 4.** This is the `test.projects` API. The `defineWorkspace`
 * file it replaced could not run `vite-plugin-solid` correctly: under a
 * workspace project the plugin's `configEnvironment` hook never received the
 * client conditions, `solid-js/web` resolved to `dist/server.js`, and every
 * component test died on "Client-only API called on the server side". The same
 * config file passed when run with `--config` and failed as a project, which
 * is what identified it as a workspace bug rather than a configuration error.
 *
 * The other two suites are separate again and share nothing with this file:
 * the Firebase Emulator suite is `tests/emulator/vitest.config.ts`, and the
 * Playwright browser suites are under `tests/e2e/`. See `docs/testing.md`.
 */
export default defineConfig({
  test: {
    projects: [
      // The pure contract layers: no Firebase, Tone, or Solid imports.
      appProject("domain", [
        "src/domain/**/*.test.{ts,tsx}",
        "src/commands/**/*.test.{ts,tsx}",
        "src/projection/**/*.test.{ts,tsx}",
        "src/selection/**/*.test.{ts,tsx}",
      ]),
      // The only Tone-touching code, and so the project that needs a real
      // audio output device — see CLAUDE.md, "`bun run test` needs an audio
      // output device". Isolating it makes that dependency legible instead of
      // a property of the whole suite.
      appProject("audio", ["src/audio/**/*.test.{ts,tsx}"]),
      // Components and the view models behind them.
      appProject("ui", [
        "src/editor/**/*.test.{ts,tsx}",
        "src/components/**/*.test.{ts,tsx}",
        "src/instrument/**/*.test.{ts,tsx}",
        "src/arrangement/**/*.test.{ts,tsx}",
      ]),
      // The boundaries that talk to something outside the app: the
      // repository, the sample-library manifest, and auth.
      appProject("data", [
        "src/persistence/**/*.test.{ts,tsx}",
        "src/library/**/*.test.{ts,tsx}",
        "src/auth/**/*.test.{ts,tsx}",
      ]),
      // The cross-cutting rail, plus the handful of root-level
      // `src/*.test.ts` files (telemetry, release, devBackend, firebaseConfig).
      appProject("platform", [
        "src/analytics/**/*.test.{ts,tsx}",
        "src/monitoring/**/*.test.{ts,tsx}",
        "src/shortcuts/**/*.test.{ts,tsx}",
        "src/shared/**/*.test.{ts,tsx}",
        "src/testing/**/*.test.{ts,tsx}",
        "src/*.test.{ts,tsx}",
      ]),
      // Build tooling, not the app: the sample-library pipeline. Node only —
      // it never renders a component — and by far the slowest project.
      {
        test: {
          name: "library-pipeline",
          environment: "node",
          exclude,
          include: ["scripts/**/*.test.mjs"],
        },
      },
    ],
  },
});
