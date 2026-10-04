import { expect, type Page, test } from "@playwright/test";

/**
 * The playhead stays visible while the arrangement follows playback (#964).
 *
 * The timeline is a canvas, so the playhead itself cannot be located, and
 * where follow puts it is the shell's unit test. What a browser shows is the
 * wiring: following moves the native scroll container, so the scrollbar and
 * the page on screen agree, during real playback.
 */

async function openNewProject(page: Page): Promise<void> {
  await page.goto("/projects");
  await page.getByRole("button", { name: "New Project" }).click();
  await expect(page).toHaveURL(/\/projects\/prj_/);
  await page.getByTestId("arrangement-view-ready").waitFor();
}

/** How far the arrangement's native scroll container is scrolled. */
function scrollLeft(page: Page): Promise<number> {
  return page.evaluate(() => {
    const viewport = document.querySelector<HTMLElement>(".arrangement-viewport");
    if (!viewport) throw new Error("expected the arrangement viewport");
    return viewport.scrollLeft;
  });
}

test.describe("Arrangement playhead follow (#964)", () => {
  test("follows a playing playhead by turning the page, scrollbar and all", async ({
    page,
    browserName,
  }) => {
    test.skip(
      browserName !== "chromium",
      "playback is asserted in Chromium only: AudioContext.resume() is refused elsewhere (HARD-001)",
    );
    await openNewProject(page);
    for (let step = 0; step < 8; step++) {
      await page.getByRole("button", { name: "Zoom in" }).click();
    }
    await page.getByRole("button", { name: "Disable loop" }).click();
    expect(await scrollLeft(page)).toBe(0);
    await page.getByRole("button", { name: "Start playback" }).click();
    await expect.poll(() => scrollLeft(page), { timeout: 20_000 }).toBeGreaterThan(0);
    await page.getByRole("button", { name: "Stop playback" }).click();
  });
});
