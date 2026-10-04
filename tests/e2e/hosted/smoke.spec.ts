import { expect, test } from "@playwright/test";
import { requestAccessUrl } from "../../../site.config.mjs";

// PRD `OPS-01` post-deploy smoke test. Runs against `SMOKE_URL` (the real
// deployed Firebase Hosting URL) with real Firebase Authentication and
// Firestore -- see tests/e2e/hosted/playwright.config.ts. A failing run here is treated
// as a failed deploy: the `deploy` job in .github/workflows/ci.yml runs this
// immediately after `firebase deploy` and does not consider the deploy
// successful until it passes.
//
// This intentionally does not reuse tests/e2e/mock/smoke.spec.ts: that suite drives the
// in-memory mock backend (`VITE_DEV_BACKEND=mock`) against a local dev
// server, which proves the UI works but nothing about whether the deployed
// build can actually reach production Firebase Authentication, Firestore, and
// security rules.
// #854 made the alpha invite-only: guest start is retired, and only an
// allowlisted Google address can sign in. A post-deploy run has no Google
// account to sign in with, so this no longer reaches a project and audio. What
// it proves is that the deployed build loads, offers its two entry points, and
// keeps a visitor with no session out of the app, against the real hosting
// rewrites and the real Firebase SDK.
test.describe("hosted alpha smoke test", () => {
  test("loads the landing page with Request access and Sign in", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { level: 1, name: /Bring a loop/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Request access" }).first(),
    ).toHaveAttribute("href", requestAccessUrl);
    await expect(page.getByRole("button", { name: "Sign in" }).first()).toBeEnabled();
  });

  test("keeps a visitor with no session out of the app", async ({ page }) => {
    // A deep link is served the app shell, boots the Firebase SDK, finds no
    // session, and sends the visitor to the landing page rather than making
    // them a guest.
    await page.goto("/projects");
    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByRole("heading", { level: 1, name: /Bring a loop/ }),
    ).toBeVisible();
  });

  test("serves the not-on-the-alpha-list page", async ({ page }) => {
    await page.goto("/not-invited");
    await expect(
      page.getByRole("heading", { name: "You're not on the alpha list yet" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Request access" })).toHaveAttribute(
      "href",
      requestAccessUrl,
    );
  });
});
