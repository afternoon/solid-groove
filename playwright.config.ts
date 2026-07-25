import { defineConfig, devices } from "@playwright/test";

const PORT = 3000;
const baseURL = `http://127.0.0.1:${PORT}`;

// Browser E2E suite. `bun run test:browser` runs Chromium and Firefox — the
// P0 gating browsers per PRD section 10 — plus WebKit as a non-gating
// signal: it always runs, but CI treats a WebKit-only failure as a warning
// rather than a blocker (see .github/workflows/ci.yml). Edge is Chromium
// under the hood and is not separately covered here.
//
// Playwright drives the app against the in-memory mock backend
// (`VITE_MOCK_BACKEND=true`, see src/model/dataService.ts and
// src/auth/authService.ts) rather than a real Firebase project, so this
// suite has no external dependency and needs no emulator.
export default defineConfig({
	testDir: "./e2e",
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
	use: {
		baseURL,
		trace: "on-first-retry",
	},
	webServer: {
		command: "bun run dev",
		url: baseURL,
		reuseExistingServer: !process.env.CI,
		timeout: 60_000,
		env: {
			VITE_MOCK_BACKEND: "true",
		},
	},
	projects: [
		{ name: "chromium", use: { ...devices["Desktop Chrome"] } },
		{ name: "firefox", use: { ...devices["Desktop Firefox"] } },
		{ name: "webkit", use: { ...devices["Desktop Safari"] } },
	],
});
