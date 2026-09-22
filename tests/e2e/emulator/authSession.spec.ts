import { expect, test } from "@playwright/test";
import { seedRegisteredSession } from "./support/authSession";

/**
 * Proves {@link seedRegisteredSession} — the harness plumbing that gets a flow
 * whose precondition is "signed in to an account" to its starting line without
 * driving the login control (see that module for why).
 *
 * It needs proving *here* rather than in the flow that uses it, because that
 * flow (`CF-006`) is still `test.fixme`: a mechanism exercised only by a skipped
 * test is a mechanism nobody has run. These are the tests that fail if the SDK
 * changes how it persists a user. Against the emulator rather than the mock
 * backend for the obvious reason — a session that restores from storage is
 * exactly what the mock backend has none of.
 */

/** What a guest is told, and a signed-in account is not (`UpgradeAccountPrompt`). */
const GUEST_NOTICE = /You're working as a guest/;

test.describe("a seeded registered session", () => {
  test("arrives on the dashboard signed in to an account, not as a guest", async ({
    page,
  }, testInfo) => {
    await seedRegisteredSession(page, {
      label: `seeded-${testInfo.project.name}`,
    });

    await page.goto("/dashboard");

    await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
    await expect(page.getByText(GUEST_NOTICE)).toHaveCount(0);
  });

  test("survives a reload, because it is genuinely persisted", async ({
    page,
  }, testInfo) => {
    await seedRegisteredSession(page, {
      label: `reloaded-${testInfo.project.name}`,
    });

    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();

    // The step every flow ends on. If the session only lived in the page's
    // memory, this is where it would fall back to a fresh anonymous start.
    await page.reload();

    await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
    await expect(page.getByText(GUEST_NOTICE)).toHaveCount(0);
  });

  // Without this, the two assertions above would pass just as happily against a
  // dashboard that had stopped telling guests they are guests.
  test("is a different state from the anonymous start, which does show the notice", async ({
    page,
  }) => {
    await page.goto("/dashboard");

    await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
    await expect(page.getByText(GUEST_NOTICE)).toBeVisible();
  });
});
