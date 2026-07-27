import { chromium, type FullConfig } from "@playwright/test";

/**
 * Playwright `globalSetup` for the emulator suite: walk the app once, in a real
 * browser, before any test runs. Runs after `webServer` is up.
 *
 * Why this exists. Vite's dev server does not pre-bundle a dependency until
 * something requests it, so a cold server discovers deps as you navigate,
 * optimizes them, and force-reloads the page each time:
 *
 *     [vite] ✨ new dependencies optimized: firebase/app, firebase/auth, ...
 *     [vite] ✨ optimized dependencies changed. reloading
 *
 * That reload lands mid-test and silently discards whatever interaction was in
 * flight. Observed concretely: `slice.spec.ts`'s `New Project` click was
 * swallowed, so the URL never left `/dashboard` and the test failed on
 * `toHaveURL(/\/projects\/prj_/)` — which looks exactly like a broken
 * create-project flow but is not one. The same suite passes in 17s warm.
 *
 * CI is always the cold case: a fresh checkout has no `node_modules/.vinxi`,
 * so every run pays this. `retries: 2` would usually paper over it (the dev
 * server survives between retries, so retry #1 sees a warm cache), which is
 * worse than failing outright — the suite would go green while the real cause
 * stayed invisible.
 *
 * It must reach the **editor**, not just the dashboard: `tone` is only imported
 * when a project page mounts, so a dashboard-only warm-up leaves one more
 * optimize-and-reload to fire during the test. That is why this clicks through
 * to a project.
 *
 * Creating a project here does not disturb `slice.spec.ts`'s "No projects yet"
 * precondition, because this runs in its own browser context and therefore gets
 * its own anonymous Firebase identity — the dashboard lists only the signed-in
 * user's projects, and each test gets a fresh context of its own.
 *
 * Deliberately tolerant: a warm-up that cannot complete must not fail the run,
 * because it is an optimization and not an assertion. If the app is genuinely
 * broken, the tests are what should say so.
 */
export default async function warmDevServer(config: FullConfig) {
	const baseURL = config.projects[0]?.use?.baseURL;
	if (!baseURL) return;

	// The container's pre-installed Chromium may be a different build than the
	// one this repo's @playwright/test pins; the tests' own `launchOptions` cover
	// that, and this warm-up simply skips if no browser can launch.
	let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
	try {
		browser = await chromium.launch({
			executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
		});
		const page = await browser.newPage({ baseURL });

		// No `waitForLoadState("networkidle")` anywhere here: this app holds an
		// open Firestore listener, so the network never goes idle and the wait can
		// only ever time out. Wait for real elements instead — those locators
		// re-resolve across a reload, which is exactly the behaviour needed.
		await page.goto("/dashboard", { waitUntil: "commit", timeout: 60_000 });

		const newProject = page.getByRole("button", { name: "New Project" });
		await newProject.waitFor({ state: "visible", timeout: 90_000 });
		await newProject.click();

		// Reaching the grid means the editor mounted and `tone` has been pulled in
		// and optimized. Re-check after a settle so that if this very navigation
		// triggered the reload, the post-reload page is the one left warm.
		const grid = page.getByRole("group", { name: "16-step sequence" });
		await grid.waitFor({ state: "visible", timeout: 60_000 });
		await page.waitForTimeout(2_000);
		await grid.waitFor({ state: "visible", timeout: 60_000 });
		console.log("[warmDevServer] editor reached; dependency graph is warm");
	} catch (error) {
		// Reaching the editor at all is what pulls in `tone`, so a failure here is
		// usually the last reload interrupting the final wait rather than a warm-up
		// that achieved nothing. Say that precisely — "skipped" would imply the
		// tests are running against a cold server when they may well not be.
		console.warn(
			`[warmDevServer] did not confirm a warm editor: ${
				error instanceof Error ? error.message : error
			}\n[warmDevServer] continuing anyway — this is an optimization, not an assertion. ` +
				"If a test now fails on a lost interaction, suspect Vite's dependency " +
				"optimization reload and check app.config.ts's optimizeDeps.include.",
		);
	} finally {
		await browser?.close();
	}
}
