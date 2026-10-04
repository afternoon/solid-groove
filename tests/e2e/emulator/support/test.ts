import { basename } from "node:path";
import { test as base } from "@playwright/test";
import { type RegisteredSession, seedRegisteredSession } from "./authSession";

export * from "@playwright/test";

/**
 * Playwright's `test`, with every test signed in as a fresh invited producer
 * before its first line runs (#854).
 *
 * The flows used to begin "signed in as a guest": the app made a guest of
 * anyone who opened `/projects`. Guest start is retired and only an
 * allowlisted Google address can sign in, so the same precondition is now "a
 * fresh, invited Google account with nothing in it", installed by
 * `seedRegisteredSession`. Specs that start from it import `test` from here;
 * the flows about signing in (CF-001, CF-032) and the ones that seed their own
 * account (CF-006) import Playwright's.
 *
 * The session is in the page's browser context, so a test that opens another
 * context for a second person seeds that one itself.
 */
export const test = base.extend<{ invitedProducer: RegisteredSession }>({
  invitedProducer: [
    async ({ page }, use, testInfo) => {
      const spec = basename(testInfo.file, ".spec.ts").toLowerCase();
      const session = await seedRegisteredSession(page, {
        label: `${spec}-${testInfo.project.name}`,
      });
      await use(session);
    },
    { auto: true },
  ],
});
