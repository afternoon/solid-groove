import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const baseURL = `http://127.0.0.1:${PORT}`;

/**
 * `firebase emulators:exec` (see `test:browser:emulator` in `package.json`)
 * sets these in this process's environment once the Firestore/Auth emulators
 * it starts from `firebase.json` are up, the same way it does for
 * `tests/emulator/setup.ts`. Falling back to the documented default host/port
 * keeps this config loadable (though not connectable) outside that wrapper —
 * e.g. `bunx playwright test --config=playwright.emulator.config.ts --list`.
 */
const firestoreEmulatorHost =
	process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
const authEmulatorHost =
	process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";

// `FND-009`'s emulator-backed browser E2E suite (`e2e-emulator/`).
//
// Distinct from `playwright.config.ts`: that suite drives the in-memory mock
// backend, which is a fresh, empty store on every page load and so cannot
// prove the foundation slice's "save it, reload it, reproduce playback" step
// — a real `page.reload()` cannot be answered by state that lives only in a
// JS module the reload just discarded. This config points the *real*
// Firebase SDK at a local Firestore + Auth emulator instead (see
// `src/firebaseConfig.ts`'s emulator wiring), so a reload here answers from
// the emulator the way it would from production.
//
// Only the two PRD section 10 P0-gating browsers run here (chromium,
// firefox) — this suite is additional coverage for one task's slice, not a
// third full cross-browser matrix.
export default defineConfig({
	testDir: "./e2e-emulator",
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
	expect: {
		timeout: 15_000,
	},
	use: {
		baseURL,
		trace: "on-first-retry",
	},
	webServer: {
		// `--host 127.0.0.1` pins the dev server to IPv4 — see the identical
		// comment in `playwright.config.ts`. A different port than that suite's
		// so both can run concurrently without colliding.
		command: `bun run dev --host 127.0.0.1 --port ${PORT}`,
		url: baseURL,
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
		stdout: "pipe",
		stderr: "pipe",
		env: {
			VITE_MOCK_BACKEND: "false",
			VITE_FIRESTORE_EMULATOR_HOST: firestoreEmulatorHost,
			VITE_AUTH_EMULATOR_HOST: authEmulatorHost,
			// Emulator-only, fake-by-design values (the Firebase-documented
			// `demo-*` convention — see `docs/testing.md`'s Firebase Emulator
			// suite section): the emulator does not validate them against a real
			// project, and they are never used against production.
			VITE_FIREBASE_PROJECT_ID: "demo-solid-groove",
			VITE_FIREBASE_API_KEY: "demo-api-key",
			VITE_FIREBASE_AUTH_DOMAIN: "demo-solid-groove.firebaseapp.com",
			VITE_FIREBASE_APP_ID: "demo-app-id",
		},
	},
	// Each gating browser gets a warm-up project plus the real suite that depends
	// on it. The warm-up walks the app once so Vite's cold-start dependency
	// optimization does its force-reload before any assertion — see
	// `e2e-emulator/warmDevServer.setup.ts` for what that reload broke and why
	// this is a setup project rather than a `globalSetup` (short version:
	// `globalSetup` cannot tell which browser `--project` selected, and CI
	// installs only the matrix browser, so a hardcoded chromium launch silently
	// no-opped in the firefox job).
	//
	// `--project=firefox` pulls in `warmup:firefox` automatically, so CI needs no
	// extra step. The real projects ignore the setup spec so they do not run it a
	// second time as an ordinary test.
	projects: [
		{
			name: "warmup:chromium",
			testMatch: /warmDevServer\.setup\.ts/,
			use: { ...devices["Desktop Chrome"] },
		},
		{
			name: "chromium",
			testIgnore: /warmDevServer\.setup\.ts/,
			use: { ...devices["Desktop Chrome"] },
			dependencies: ["warmup:chromium"],
		},
		{
			name: "warmup:firefox",
			testMatch: /warmDevServer\.setup\.ts/,
			use: { ...devices["Desktop Firefox"] },
		},
		{
			name: "firefox",
			testIgnore: /warmDevServer\.setup\.ts/,
			use: { ...devices["Desktop Firefox"] },
			dependencies: ["warmup:firefox"],
		},
	],
});
