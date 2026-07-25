import solid from "vite-plugin-solid";
import { configDefaults, defineConfig } from "vitest/config";

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
		// `.claude/**` keeps the runner out of git worktrees, which the agent
		// workflow creates under `.claude/worktrees/`. Each is a full checkout,
		// so without this a stray worktree's suites are collected alongside the
		// real ones and fail against the main checkout's paths.
		exclude: [
			...configDefaults.exclude,
			"e2e/**",
			"tests/emulator/**",
			".claude/**",
		],
		// Explicit rather than left to vite-plugin-solid's auto-detected bare
		// specifier (`@testing-library/jest-dom/vitest`, resolved directly
		// against `test.setupFiles` outside Vite's own module graph): running
		// from a git-worktree checkout nested under the main checkout (see the
		// `exclude` note above) can make that raw specifier resolve against the
		// main checkout's `node_modules` instead of the worktree's own, which
		// then fails to load. A real relative setup file resolves through
		// Vite's normal import graph like every other project module instead.
		setupFiles: ["./src/testing/jest-dom-setup.ts"],
	},
});
