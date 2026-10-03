import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { expect, test } from "@playwright/test";
import { guestUid } from "./guest";
import { CLEANUP_FILE, GUEST_FILE, SESSION_FILE, SWEEP_URL } from "./paths";

/** Far more than a run makes; only there so a stuck list cannot loop forever. */
const MAX_DELETES = 200;

type Result = { ok: boolean; deleted: number; remaining: number | null };

const record = (result: Result) => {
  mkdirSync(dirname(CLEANUP_FILE), { recursive: true });
  writeFileSync(CLEANUP_FILE, `${JSON.stringify(result)}\n`);
};

// Deletes every project the run's guest owns, through the dashboard a person
// would use (#859). It writes `cleanup.json` whatever happens, so the run
// summary can say whether anything was left behind.
test("delete every project the sweep's guest made", async ({ browser }) => {
  if (!existsSync(SESSION_FILE)) {
    record({ ok: true, deleted: 0, remaining: 0 });
    return;
  }

  const result: Result = { ok: false, deleted: 0, remaining: null };
  try {
    const context = await browser.newContext({
      storageState: SESSION_FILE,
      baseURL: SWEEP_URL,
    });
    const page = await context.newPage();
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
    // A session that no longer restores signs in as a brand-new guest, whose
    // empty dashboard would read as "nothing left behind". Only the run's own
    // guest can say that.
    expect(await guestUid(page), "signed in as the run's guest").toBe(
      readFileSync(GUEST_FILE, "utf8").trim(),
    );

    const deletes = page.getByRole("button", { name: /^Delete / });
    await expect(deletes.first().or(page.getByText("No projects yet"))).toBeVisible();

    while ((await deletes.count()) > 0 && result.deleted < MAX_DELETES) {
      const before = await deletes.count();
      await deletes.first().click();
      await page
        .getByRole("alertdialog", { name: /delete this project/i })
        .getByRole("button", { name: /^delete$/i })
        .click();
      await expect(deletes).toHaveCount(before - 1);
      result.deleted++;
    }

    // Reload: the list must come back empty from the server, not just the page.
    await page.reload();
    await expect(page.getByText("No projects yet")).toBeVisible();
    result.remaining = await deletes.count();
    result.ok = result.remaining === 0;
    await context.close();
  } finally {
    record(result);
  }
  expect(result.remaining).toBe(0);
});
