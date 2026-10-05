import { expect, type Page } from "@playwright/test";

/**
 * The alpha allowlist (#854), from a flow's side.
 *
 * Only an allowlisted Google address may sign in: a blocking `beforeSignIn`
 * function refuses everyone else, and the Auth emulator runs it the way
 * production does. So a flow that signs someone in puts their address on the
 * list first, exactly as an admin would, and a flow about being refused simply
 * does not.
 */

/**
 * Where `firebase emulators:exec` bound Firestore, exported into this process
 * the same way `tests/e2e/emulator/playwright.config.ts` reads it.
 */
const firestoreEmulatorHost = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";

/** The emulator project every suite runs under (`--project` in `package.json`). */
const PROJECT_ID = "demo-solid-groove";

/**
 * A fresh address for one run. Accounts persist in the Auth emulator for the
 * whole run, and a flow's precondition is usually an account with nothing in
 * it, so callers pass something unique (the spec id and browser name, say).
 */
export function uniqueEmail(label: string): string {
  return `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
}

/**
 * Puts `email` on the alpha allowlist, as an admin approving it would.
 *
 * Written through the Firestore emulator's REST API with its `owner` bearer
 * token, which bypasses security rules the way the Admin SDK's credential does
 * in production: the list is not writable by an ordinary account, so this is
 * the honest stand-in for `bun run allowlist:add`.
 */
export async function allowlist(email: string): Promise<void> {
  const normalised = email.trim().toLowerCase();
  const url =
    `http://${firestoreEmulatorHost}/v1/projects/${PROJECT_ID}/databases/(default)` +
    `/documents/allowlist/${encodeURIComponent(normalised)}`;
  const response = await fetch(url, {
    method: "PATCH",
    headers: { Authorization: "Bearer owner", "Content-Type": "application/json" },
    body: JSON.stringify({
      fields: {
        email: { stringValue: normalised },
        addedAt: { integerValue: String(Date.now()) },
      },
    }),
  });
  if (!response.ok) {
    throw new Error(
      `The Firestore emulator refused to allowlist an address (${response.status}): ` +
        `${await response.text()}`,
    );
  }
}

/**
 * Signs in with Google through the Auth emulator's own account chooser, the
 * popup a person sees in place of Google's.
 *
 * `open` is whatever the flow does to start signing in (pressing "Sign in",
 * say); this waits for the popup it opens, adds `email` as a new Google
 * account there, and confirms. Whether the app then lets them in is the
 * flow's to assert.
 */
export async function signInWithGoogle(
  page: Page,
  email: string,
  open: () => Promise<void>,
): Promise<void> {
  const [popup] = await Promise.all([page.waitForEvent("popup"), open()]);
  await popup.waitForLoadState();
  await popup.getByRole("button", { name: "Add new account" }).click();
  await popup.locator("#email-input").fill(email);
  await popup.locator("#display-name-input").fill("Flow Producer");
  const confirm = popup.locator("#sign-in");
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await popup.waitForEvent("close");
}
