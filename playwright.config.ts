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
// (`VITE_MOCK_BACKEND=true`, see src/projectRepositoryClient.ts and
// src/auth/authService.ts) rather than a real Firebase project, so this
// suite has no external dependency and needs no emulator. `page.reload()`
// cannot be used to prove persistence here — the in-memory repository is a
// fresh, empty store every page load — see playwright.emulator.config.ts.
export default defineConfig({
	testDir: "./e2e",
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
	// The suite runs against the dev server, so the first test to reach a route
	// pays for compiling that route's chunks on demand — the dashboard pulls in
	// the Firebase SDK, which is measurably slow the first time. Cold locally
	// that leaves the anonymous-start assertion at ~4.8s against Playwright's 5s
	// default, i.e. passing by 200ms and certain to tip over on a slower runner.
	// Give assertions real headroom; it costs nothing when they pass promptly.
	expect: {
		timeout: 15_000,
	},
	use: {
		baseURL,
		trace: "on-first-retry",
	},
	webServer: {
		// `--host 127.0.0.1` pins the dev server to IPv4. Without it vinxi binds
		// whatever `localhost` resolves to, and on a dual-stack host (GitHub
		// runners resolve localhost to both 127.0.0.1 and ::1) that can be the
		// IPv6 address while `url` below polls IPv4 — the server comes up, nothing
		// ever answers on 127.0.0.1, and the run dies on the webServer timeout.
		command: "bun run dev --host 127.0.0.1",
		url: baseURL,
		reuseExistingServer: !process.env.CI,
		// A cold start takes a few seconds locally, but CI runners are slower and
		// build from an empty Vite cache, so allow real headroom.
		timeout: 120_000,
		// Vinxi's startup banner and any boot error go to stdout, which Playwright
		// discards by default — a webServer timeout is then unattributable from the
		// CI log alone. Pipe it so the next failure explains itself.
		stdout: "pipe",
		stderr: "pipe",
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
