import { expect, type Locator, type Page, test } from "./support/test";

/**
 * #937: the Limiter's meters read the sound that is really playing.
 *
 * The loudness figures are measured off the device's output by an analyser
 * the editor's frame loop polls, and gain reduction is read off the live
 * `DynamicsCompressorNode` — neither exists in jsdom, so only a browser can
 * show that a Limiter on a playing track reads a loudness and, pushed, pulls
 * gain down. Playback is asserted in Chromium only (#43; see CF-007).
 */

const chainPanel = (page: Page): Locator =>
  page.getByRole("region", { name: "Device chain" });

test.describe("Limiter", () => {
  test("meters the playing track's loudness and gain reduction", async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "playback is asserted in Chromium only (#43)");
    test.setTimeout(90_000);

    await page.goto("/projects");
    await page.getByRole("button", { name: "New Project" }).click();
    await expect(page).toHaveURL(/\/projects\/prj_/);
    await page.getByTestId("arrangement-view-ready").waitFor();
    await page
      .getByRole("navigation", { name: "Views" })
      .getByRole("link", { name: "Instrument" })
      .click();
    await chainPanel(page)
      .getByRole("group", { name: "Add device" })
      .getByRole("button", { name: "Add limiter device" })
      .click();
    const limiter = chainPanel(page)
      .getByRole("list", { name: "Device chain" })
      .getByRole("listitem")
      .first();
    await expect(limiter).toContainText("Limiter");

    // Before anything plays, the well rests.
    const shortTerm = limiter.getByTestId("limiter-short-term");
    const integrated = limiter.getByTestId("limiter-integrated");
    const reduction = limiter.getByRole("meter", { name: "Gain reduction" });
    await expect(shortTerm).toHaveText("–");
    await expect(integrated).toHaveText("–");

    // Push it hard: all the drive there is, into a low ceiling.
    const drive = limiter.getByRole("slider", { name: "Drive" });
    await drive.focus();
    await page.keyboard.press("End");
    const ceiling = limiter.getByRole("slider", { name: "Ceiling" });
    await ceiling.focus();
    await page.keyboard.press("Home");

    await page.getByRole("button", { name: "Start playback" }).click();
    await expect(page.getByRole("button", { name: "Stop playback" })).toBeVisible();
    await expect(shortTerm).toHaveText(/^−?\d+\.\d$/, { timeout: 15_000 });
    await expect
      .poll(async () => Number(await reduction.getAttribute("value")), {
        timeout: 15_000,
      })
      .toBeGreaterThan(1);

    // Stopped, nothing is being reduced and the short-term window is gone,
    // but the integrated figure for what was played stays to be read.
    await page.getByRole("button", { name: "Stop playback" }).click();
    await expect(shortTerm).toHaveText("–");
    await expect(reduction).toHaveAttribute("value", "0");
    await expect(integrated).toHaveText(/^−?\d+\.\d$/);
  });
});
