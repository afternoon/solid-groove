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
		exclude: [...configDefaults.exclude, "e2e/**", "tests/emulator/**"],
	},
});
