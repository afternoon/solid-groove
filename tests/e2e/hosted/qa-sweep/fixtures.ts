import { readFileSync } from "node:fs";
import { test as base, expect } from "@playwright/test";
import { persistedUid } from "../../support/firebaseSession";
import { ACCOUNT_FILE, SWEEP_URL } from "./paths";

/**
 * `test` for a QA sweep agent's scratch specs (#859). Import it instead of
 * `@playwright/test`'s: it is the same `test`, plus a check at the end of
 * every test that the page was still signed in as the agent's QA account. A spec that
 * lost the session (signed out, cleared storage, opened its own context) made
 * its projects as someone else, and those are projects the cleanup cannot reach,
 * so it fails loudly instead of leaving them behind quietly.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    await use(page);
    if (page.isClosed() || !page.url().startsWith(SWEEP_URL)) return;
    const expected = readFileSync(ACCOUNT_FILE, "utf8").trim();
    expect(await persistedUid(page), "still signed in as the agent's QA account").toBe(
      expected,
    );
  },
});

export { expect };
