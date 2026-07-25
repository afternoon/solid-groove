import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const baseURL = `http://127.0.0.1:${PORT}`;

// The FND-008 arrangement-spike measurement harness (backlog task; PRD
// section 9.3 "When these budgets are enforced"). Separate from
// `playwright.config.ts`/`e2e/` on purpose:
//
// - This suite drives `/spike/arrangement`, a disposable spike route
//   (`src/routes/spike/arrangement.tsx`), not product behavior — it has
//   nothing to do with the functional E2E suite's job.
// - It runs on its own port so `bun run test:browser` and
//   `bun run bench:arrangement` can run at the same time without fighting
//   over a dev server.
// - It is not gated on the PRD 9.3 performance budgets and is not part of
//   the CI-blocking test matrix; it produces a checked-in baseline
//   measurement (`docs/perf/arrangement-spike-baseline.json`), not a
//   pass/fail signal. See `docs/arrangement-renderer-spike.md`.
export default defineConfig({
	testDir: "./perf",
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: 0,
	reporter: process.env.CI ? [["github"], ["list"]] : "list",
	timeout: 120_000,
	use: {
		baseURL,
		trace: "retain-on-failure",
	},
	webServer: {
		// See `playwright.config.ts` for why `--host 127.0.0.1` matters.
		command: `bun run dev --host 127.0.0.1 --port ${PORT}`,
		url: baseURL,
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
		stdout: "pipe",
		stderr: "pipe",
		env: {
			VITE_MOCK_BACKEND: "true",
		},
	},
	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
