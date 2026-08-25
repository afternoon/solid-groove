import { test } from "@playwright/test";

/**
 * Warm-up for the emulator suite, run as a Playwright **setup project** (see
 * `tests/e2e/emulator/playwright.config.ts`): walk the app once, in the same browser the
 * suite under test uses, before any real test runs.
 *
 * Why this exists. Vite's dev server does not pre-bundle a dependency until
 * something requests it, so a cold server discovers deps as you navigate,
 * optimizes them, and force-reloads the page each time:
 *
 *     [vite] ✨ new dependencies optimized: firebase/app, firebase/auth, ...
 *     [vite] ✨ optimized dependencies changed. reloading
 *
 * That reload lands mid-test and silently discards whatever interaction was in
 * flight. Observed concretely, and reproduced deterministically: `slice.spec.ts`'s
 * `New Project` click was swallowed, so the URL never left `/dashboard` and the
 * test failed on `toHaveURL(/\/projects\/prj_/)` — which reads exactly like a
 * broken create-project flow and is not one.
 *
 * CI is always the cold case: a fresh checkout has no `node_modules/.vinxi`, so
 * every run pays this. `retries: 2` would usually paper over it (the dev server
 * survives between retries, so retry #1 sees a warm cache), which is worse than
 * failing outright — the suite would go green while the cause stayed invisible.
 *
 * It must reach the **editor**, not just the dashboard: `tone` is only imported
 * when a project page mounts, so a dashboard-only warm-up leaves one more
 * optimize-and-reload to fire during the test. Hence the click through.
 *
 * ## Why a setup project rather than `globalSetup`
 *
 * This started as a `globalSetup` that called `chromium.launch()` directly. That
 * was wrong in CI: `.github/workflows/ci.yml` installs only the matrix browser
 * (`playwright install --with-deps ${{ matrix.browser }}`), so the firefox job
 * had no chromium binary and the warm-up became a silent no-op there — it logged
 * a launch failure, continued, and left that half of the matrix cold.
 *
 * The obvious repair — read the browser from `config.projects[0].use
 * .defaultBrowserType` — does not work either. `FullConfig.projects` is **not**
 * filtered by `--project`; verified empirically by putting firefox first in a
 * throwaway config and running `--project=chromium`, which still reported
 * `projects[0] === firefox`. So `globalSetup` cannot know which browser the run
 * selected.
 *
 * A setup project can, because Playwright resolves it per project: each browser
 * gets its own warm-up project carrying that browser's `use`, and the real
 * project depends on it. `--project=firefox` therefore warms in firefox with no
 * env plumbing, and the warm-up's outcome shows up in the report instead of only
 * in stdout.
 *
 * ## Why it never fails
 *
 * A setup project's failure normally blocks its dependents, which is wrong here:
 * `app.config.ts`'s `optimizeDeps.include` is the load-bearing fix and this is
 * only a backstop for anything left off that list. Measured across 11 cold runs
 * with no effective warm-up, one failed; across 4 cold runs with it, none did.
 * Its absence worsens the odds rather than guaranteeing a failure, so it must not
 * be able to turn a warm-up hiccup into a red suite. Hence the catch: it reports
 * precisely what happened and passes regardless. `slice.spec.ts` still makes
 * every assertion itself, so this cannot turn a real failure green.
 *
 * Creating a project here cannot disturb `slice.spec.ts`'s `No projects yet`
 * precondition: `listProjects` scopes on `where("ownerId", "==", ownerId)`, and
 * this runs in its own browser context with its own anonymous Firebase identity,
 * as does each test.
 */
test("warm the dev server's dependency graph", async ({ page }, testInfo) => {
  const browserName = testInfo.project.use.defaultBrowserType ?? "unknown";

  try {
    // No `waitForLoadState("networkidle")` anywhere here: the app holds an open
    // Firestore listener, so the network never goes idle and the wait can only
    // time out. Wait for real elements instead — those locators re-resolve
    // across a reload, which is exactly the behaviour needed.
    await page.goto("/dashboard", { waitUntil: "commit", timeout: 60_000 });

    const newProject = page.getByRole("button", { name: "New Project" });
    await newProject.waitFor({ state: "visible", timeout: 90_000 });
    await newProject.click();

    // Reaching the grid means the editor mounted and `tone` has been pulled in
    // and optimized. Re-check after a settle so that if this very navigation
    // triggered the reload, the post-reload page is the one left warm.
    const grid = page.getByRole("region", { name: "Step editor" });
    await grid.waitFor({ state: "visible", timeout: 60_000 });
    await page.waitForTimeout(2_000);
    await grid.waitFor({ state: "visible", timeout: 60_000 });

    console.log(
      `[warmDevServer] editor reached in ${browserName}; dependency graph is warm`,
    );
  } catch (error) {
    // Reaching the editor at all is what pulls in `tone`, so a failure here is
    // often the last reload interrupting the final wait rather than a warm-up
    // that achieved nothing. Say that precisely — "skipped" would imply the
    // tests are running fully cold when they may well not be.
    console.warn(
      `[warmDevServer] did not confirm a warm editor in ${browserName}: ${
        error instanceof Error ? error.message : error
      }\n[warmDevServer] continuing anyway — this is an optimization, not an ` +
        "assertion. If a test now fails on a lost interaction, suspect Vite's " +
        "dependency optimization reload and check app.config.ts's optimizeDeps.include.",
    );
  }
});
