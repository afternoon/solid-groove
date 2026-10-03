import { readFileSync } from "node:fs";
import { test as base, expect } from "@playwright/test";
import { guestUid } from "./guest";
import { GUEST_FILE, SWEEP_URL } from "./paths";

/**
 * `test` for a QA sweep agent's scratch specs (#859). Import it instead of
 * `@playwright/test`'s: it is the same `test`, plus a check at the end of
 * every test that the page was still signed in as the run's guest. A spec that
 * lost the session (signed out, cleared storage, opened its own context) made
 * its projects as a stranger, and those are projects the cleanup cannot reach,
 * so it fails loudly instead of leaving them behind quietly.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    await use(page);
    if (page.isClosed() || !page.url().startsWith(SWEEP_URL)) return;
    const expected = readFileSync(GUEST_FILE, "utf8").trim();
    expect(await guestUid(page), "still signed in as the run's guest").toBe(expected);
  },
});

export { expect };
