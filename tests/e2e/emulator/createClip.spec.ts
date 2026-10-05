import { expect, type Locator, type Page, test } from "./support/test";

/**
 * Double-clicking an empty bar creates a one-bar clip there (#661), selected
 * and not opened. The timeline is a canvas, so the clip is read from the
 * selection's accessible announcement, as the arrangement clipboard spec does.
 */

const TICKS_PER_BAR = 768;

const announcement = (page: Page): Locator =>
  page.getByTestId("arrangement-selection-live");

/** A point in the first track row ("BD") at `bars` from the song start. */
async function bdRowAt(page: Page, bars: number) {
  const root = page.getByTestId("arrangement-view-ready");
  const pixelsPerTick = Number(await root.getAttribute("data-pixels-per-tick"));
  const rulerHeight = Number(await root.getAttribute("data-ruler-height"));
  const rowHeight = Number(await root.getAttribute("data-row-height"));
  return { x: bars * TICKS_PER_BAR * pixelsPerTick, y: rulerHeight + rowHeight / 2 };
}

test.describe("creating a clip", () => {
  test("double-clicking an empty bar creates a selected one-bar clip there", async ({
    page,
  }) => {
    await page.goto("/projects");
    await page.getByRole("button", { name: "New Project" }).click();
    await expect(page).toHaveURL(/\/projects\/prj_/);
    await page.getByTestId("arrangement-view-ready").waitFor();
    const timeline = page.locator(".arrangement-layer-interactive");

    // Bar 3 of the starter "BD" track is empty.
    await timeline.click({ position: await bdRowAt(page, 2.5) });
    await expect(announcement(page)).toHaveText("Position 3.1.1");

    await timeline.dblclick({ position: await bdRowAt(page, 2.5) });
    await expect(announcement(page)).toHaveText("Selected clip on BD, bar 3");
    // It is created, not opened.
    await expect(page.getByRole("region", { name: "Sequence editor" })).toHaveCount(0);

    // One undo takes it back.
    await page.keyboard.press("ControlOrMeta+z");
    await timeline.click({ position: await bdRowAt(page, 2.5) });
    await expect(announcement(page)).toHaveText("Position 3.1.1");
  });
});
