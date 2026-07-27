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
const jestDomSetupPath = fileURLToPath(
	import.meta.resolve("@testing-library/jest-dom/vitest"),
);

// Unit and component suites: fast, no external services, jsdom-backed
// (vite-plugin-solid sets `test.environment: "jsdom"` automatically).
//
// The Firebase Emulator suite (`vitest.emulator.config.ts`) and the
// Playwright browser suite (`playwright.config.ts`, `e2e/`) are isolated
// into their own configs/runners — see docs/testing.md — so this default
// `bun run test` stays fast and never needs a running emulator or browser.
export default defineConfig({
	plugins: [solid()],
	resolve: {
		conditions: ["development", "browser"],
	},
	test: {
		setupFiles: [jestDomSetupPath],
		// `.claude/**` keeps the runner out of git worktrees, which the agent
		// workflow creates under `.claude/worktrees/`. Each is a full checkout,
		// so without this a stray worktree's suites are collected alongside the
		// real ones and fail against the main checkout's paths.
		exclude: [
			...configDefaults.exclude,
			"e2e/**",
			"e2e-hosted/**",
			"e2e-emulator/**",
			"tests/emulator/**",
			// The FND-008 arrangement-spike measurement harness: Playwright specs
			// (`playwright.bench.config.ts`), not Vitest ones.
			"perf/**",
			".claude/**",
		],
	},
});
