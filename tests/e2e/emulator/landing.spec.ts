import { expect, test } from "@playwright/test";
import { requestAccessUrl } from "../../../site.config.mjs";
import { test as signedInTest } from "./support/test";

// The public landing page (`LOOP-001b`, the PRD PRJ-06 front door) and the
// project list's address. CF-001 walks the landing page's Sign in into a
// playing loop; these pin the page's own claims, its keyboard reach and its
// single analytics disclosure, which no flow asserts. Moved here from the
// retired mock-backend suite's `smoke.spec.ts`. #854 made the alpha
// invite-only, so its two entry points are Request access and Sign in, and a
// visitor here has no session.
test.describe("landing page", () => {
  test("states the promise, the alpha status, and the supported browsers", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(
      page.getByRole("heading", { level: 1, name: /Bring a loop/ }),
    ).toBeVisible();
    await expect(page.getByText(/music studio that runs in your browser/i)).toBeVisible();
    await expect(page.getByText("Private alpha · browser-based")).toBeVisible();
    await expect(page.getByText(/Chrome, Edge and Firefox/)).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Request access" }).first(),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in" }).first()).toBeVisible();
  });

  // PRD section 10: "Interactive controls have accessible names, visible
  // focus". The whole page is reachable and operable from the keyboard alone.
  test("requests access from the keyboard, with visible focus", async ({ page }) => {
    // The form is another site's page; answer it here instead.
    await page.route(`${requestAccessUrl}**`, (route) =>
      route.fulfill({ contentType: "text/html", body: "<title>Request access</title>" }),
    );
    await page.goto("/");

    const cta = page.getByRole("link", { name: "Request access" }).first();
    // The unfocused baseline, so the assertions below cannot be satisfied by
    // a ring that was always there.
    expect(await cta.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe(
      "none",
    );

    // Tabbed to rather than focused programmatically: `:focus-visible`, which
    // is what draws the focus ring, only applies to keyboard focus.
    for (let press = 0; press < 10; press++) {
      await page.keyboard.press("Tab");
      if (await cta.evaluate((element) => element === document.activeElement)) break;
    }
    await expect(cta).toBeFocused();

    // Pins `.landing button:focus-visible` specifically, not merely "some ring
    // is drawn": a UA default ring, or an `outline: none` replaced by a
    // `box-shadow`, does not match the page's own accent-coloured 2px rule.
    // The accent is read from the theme's own custom property and normalised
    // through a probe element so the expectation is not a second copy of the
    // hex. (It read `--landing-accent` until the page stopped aliasing the
    // theme token for one surface; the assertion itself is unchanged.)
    const ring = await cta.evaluate((element) => {
      const styles = getComputedStyle(element);
      const probe = document.createElement("span");
      probe.style.color = styles.getPropertyValue("--color-accent").trim();
      document.body.append(probe);
      const accent = getComputedStyle(probe).color;
      probe.remove();
      return {
        style: styles.outlineStyle,
        width: styles.outlineWidth,
        color: styles.outlineColor,
        accent,
      };
    });
    expect(ring.style).toBe("solid");
    expect(ring.width).toBe("2px");
    expect(ring.color).toBe(ring.accent);

    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(requestAccessUrl);
  });

  test("carries the analytics disclosure and opt-out, exactly once", async ({ page }) => {
    await page.goto("/");
    // Settle on the rendered page first. The opt-out is reachable throughout
    // (the app-chrome copy covers the window before this page's own footer
    // copy exists, and the error screen if it never does), so counting mid
    // hand-over would be counting the loading state, not the page.
    await expect(
      page.getByRole("heading", { level: 1, name: /Bring a loop/ }),
    ).toBeVisible();

    // One control for one preference: the app-chrome copy stands down while
    // this page's footer copy is mounted (see FloatingTelemetryDisclosure), so
    // the page has only the footer's.
    const disclosure = page.getByText("Privacy", { exact: true });
    await expect(disclosure).toHaveCount(1);
    await expect(page.locator("#telemetry-disclosure-note")).toHaveCount(1);

    await disclosure.click();
    const optOut = page.getByRole("checkbox", {
      name: "Share usage and error reports",
    });
    await expect(optOut).toBeChecked();
    await optOut.uncheck();
    await expect(optOut).not.toBeChecked();
  });
});

// The project list keeps a visitor with no session out (#854), so this one
// signs in first.
signedInTest.describe("project list address", () => {
  signedInTest("sends the old /dashboard address on to /projects", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/projects$/);
    await expect(page).toHaveTitle("Projects – Groove");
  });
});
