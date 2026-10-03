import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { expect, test } from "@playwright/test";
import { guestUid } from "./guest";
import { BUILD_FILE, GUEST_FILE, SESSION_FILE } from "./paths";

// One guest identity per agent per run, made here and nowhere else (#859).
// The live app signs a visitor in anonymously; a fresh guest owns nothing, so
// it cannot read or change anyone's projects (firestore.rules), and every
// project it makes is the sweep's own and is deleted by `cleanup.sweep.ts`.
test("a fresh guest session for this sweep", async ({ page }) => {
  test.skip(existsSync(SESSION_FILE), "This run's guest session already exists.");

  // `?internal=1` marks the browser as team traffic, so the sweep's sessions
  // are excluded from the product's measures (`src/shared/internalTraffic.ts`).
  await page.goto("/?internal=1");
  await page.getByRole("link", { name: "Start in your browser" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();

  const sha = await page.locator("[data-release-sha]").getAttribute("data-release-sha");
  mkdirSync(dirname(BUILD_FILE), { recursive: true });
  writeFileSync(BUILD_FILE, `${JSON.stringify({ sha })}\n`);

  // Firebase keeps the guest's credentials in IndexedDB, not cookies, and
  // writes them a moment after the dashboard paints. Saved any earlier, the
  // file holds no user, and since the app signs a visitor with no user in as a
  // new guest, every spec would quietly run as a stranger cleanup cannot find.
  await expect.poll(() => guestUid(page)).toBeTruthy();
  mkdirSync(dirname(SESSION_FILE), { recursive: true });
  writeFileSync(GUEST_FILE, `${await guestUid(page)}\n`);
  await page.context().storageState({ path: SESSION_FILE, indexedDB: true });
});
