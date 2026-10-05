import { expect, test } from "@playwright/test";
import { requestAccessUrl } from "../../../../site.config.mjs";
import { walkthrough } from "../../support/walkthrough";
import { signInWithGoogle, uniqueEmail } from "../support/access";

/**
 * `CF-032` — a visitor who is not on the alpha list is told so and asks for
 * access (#854).
 *
 * The other side of CF-001. Only an allowlisted Google address can sign in, so
 * this flow signs in with one that is not on the list and follows what the
 * product offers instead: a page saying they are not on the alpha list yet,
 * and a Request access button to the form. The refusal is made by the blocking
 * `beforeSignIn` function, which the Auth emulator runs as production does, so
 * nothing here fakes being refused.
 *
 * The request-access form is a third-party page (Tally). Following the button
 * is asserted by where the browser goes, and that address is answered locally
 * so the flow never depends on a site outside the product being up.
 *
 * Parked at `test.fixme` until #854's stack lands; the PR that closes #854
 * removes the marker in the same diff that makes it pass.
 */

// `test.fixme` (on the describe, so the body keeps its indentation) until
// #854's stack lands: the PR that closes it removes this marker in the same
// diff that makes the flow pass.
test.describe.fixme("CF-032", () => {
  test("a visitor who is not on the alpha list is told so and asks for access", async ({
    page,
    browserName,
  }) => {
    const step = walkthrough(page, {
      id: "CF-032",
      title: "A visitor who is not on the alpha list is told so and asks for access",
    });

    // Precondition: a Google address nobody has put on the alpha list.
    const email = uniqueEmail(`cf-032-${browserName}`);

    // The form lives on another site; answer it here instead.
    await page.context().route(`${requestAccessUrl}**`, (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><title>Request access</title><h1>Request access</h1>",
      }),
    );

    // 1. Open the landing page.
    await page.goto("/");
    await expect(
      page.getByRole("heading", { level: 1, name: /Bring a loop/ }),
    ).toBeVisible();
    await step("Open the landing page");

    // 2. Choose Sign in, and sign in with Google as an address that is not on
    //    the list.
    await signInWithGoogle(page, email, () =>
      page.getByRole("button", { name: "Sign in", exact: true }).first().click(),
    );

    // 3. You are not let in. A page tells you you're not on the alpha list
    //    yet, and offers Request access.
    await expect(
      page.getByRole("heading", { name: /not on the alpha list yet/i }),
    ).toBeVisible();
    const requestAccess = page.getByRole("link", { name: "Request access" });
    await expect(requestAccess).toBeVisible();
    await expect(page.getByRole("button", { name: "New Project" })).toHaveCount(0);
    await step("You're told you're not on the alpha list yet, with Request access");

    // 4. Reload the page. You are still not signed in: the page still says
    //    so, and nothing of the app has opened.
    await page.reload();
    await expect(
      page.getByRole("heading", { name: /not on the alpha list yet/i }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(0);

    // 5. Open your projects page directly. You are not let in there either, and
    //    land back on the landing page.
    await page.goto("/projects");
    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByRole("heading", { level: 1, name: /Bring a loop/ }),
    ).toBeVisible();

    // 6. Go back, and follow Request access. The request-access form opens.
    await page.goBack();
    await expect(
      page.getByRole("heading", { name: /not on the alpha list yet/i }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Request access" }).click();
    await expect(page).toHaveURL(requestAccessUrl);
    await expect(page.getByRole("heading", { name: "Request access" })).toBeVisible();
    await step("Follow Request access — the request-access form opens");
  });
});
