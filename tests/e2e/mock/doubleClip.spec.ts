import { expect, type Locator, type Page, test } from "@playwright/test";

/**
 * Double grows the clip on the arrangement timeline too (#647): a one-bar
 * synth clip doubled in the piano roll reads as a two-bar clip once the roll
 * is left. The timeline is a canvas, so its length is read from the
 * selection's accessible announcement ("bars 1 to 2"), as the arrangement
 * clipboard spec does.
 */

const TICKS_PER_BAR = 768;

const sequenceEditor = (page: Page): Locator =>
  page.getByRole("region", { name: "Sequence editor" });

const announcement = (page: Page): Locator =>
  page.getByTestId("arrangement-selection-live");

/** A point in the synth row (row 2, under the starter "BD") at `bars`. */
async function synthRowAt(page: Page, bars: number) {
  const root = page.getByTestId("arrangement-view-ready");
  const pixelsPerTick = Number(await root.getAttribute("data-pixels-per-tick"));
  const rulerHeight = Number(await root.getAttribute("data-ruler-height"));
  const rowHeight = Number(await root.getAttribute("data-row-height"));
  return {
    x: bars * TICKS_PER_BAR * pixelsPerTick,
    y: rulerHeight + 1.5 * rowHeight,
  };
}

test.describe("Double", () => {
  test("a one-bar clip doubled in the piano roll is two bars on the timeline", async ({
    page,
  }) => {
    await page.goto("/projects");
    await page.getByRole("button", { name: "New Project" }).click();
    await expect(page).toHaveURL(/\/projects\/prj_/);
    await page.getByTestId("arrangement-view-ready").waitFor();
    await page.getByRole("button", { name: "Add synth track" }).click();

    // The new synth clip is one bar long.
    const timeline = page.locator(".arrangement-layer-interactive");
    await timeline.click({ position: await synthRowAt(page, 0.5) });
    await expect(announcement(page)).toHaveText("Selected clip on Synth, bar 1");

    // Open it, add a note, and Double.
    await timeline.dblclick({ position: await synthRowAt(page, 0.5) });
    const editor = sequenceEditor(page);
    await expect(editor.getByRole("region", { name: /^Piano roll\b/ })).toBeVisible();
    const row = await editor
      .getByRole("group", { name: "Pitches" })
      .getByRole("button", { name: "C3" })
      .boundingBox();
    const column = await editor
      .getByRole("group", { name: "Ruler" })
      .getByRole("button", { name: "Step 1", exact: true })
      .boundingBox();
    if (!row || !column) throw new Error("expected the roll's C3 row and step 1");
    await page.mouse.click(column.x + column.width / 2, row.y + row.height / 2);
    await editor.getByRole("button", { name: /^Double\b/ }).click();
    await expect(
      editor
        .getByRole("group", { name: "Ruler" })
        .getByRole("button", { name: "Step 32" }),
    ).toBeVisible();

    // Back to the arrangement with 1: the clip on the timeline is now two
    // bars long.
    await page.keyboard.press("1");
    await expect(editor).toHaveCount(0);
    await page.getByTestId("arrangement-view-ready").waitFor();
    await timeline.click({ position: await synthRowAt(page, 1.5) });
    await expect(announcement(page)).toHaveText("Selected clip on Synth, bars 1 to 2");
  });
});
