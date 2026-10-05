import { expect, type Locator, type Page, test } from "@playwright/test";
import { newProject } from "./support/assistant";
import { backToArrangement, expectView, sequenceView } from "./support/views";

/**
 * The arrangement's clips from the keyboard alone (#76). The clips are canvas
 * drawings; the "Clips" listbox is their DOM twin. This presses the real keys
 * in a browser, so the registry's `clip_list` context, the focus it follows
 * and the keys that act on a selection are the real ones. Nothing here
 * touches the canvas.
 */

const announcement = (page: Page): Locator =>
  page.getByTestId("arrangement-selection-live");

const clipList = (page: Page): Locator => page.getByRole("listbox", { name: "Clips" });

/** Tab from the page's start until the clip list has focus. */
async function tabToClipList(page: Page): Promise<void> {
  await page.locator("body").focus();
  for (let presses = 0; presses < 80; presses += 1) {
    await page.keyboard.press("Tab");
    if (await clipList(page).evaluate((el) => el === document.activeElement)) return;
  }
  throw new Error("Tab never reached the clip list");
}

test.describe("the clip list", () => {
  test("picks, opens, duplicates and deletes a clip with the keyboard alone", async ({
    page,
  }) => {
    await newProject(page);
    await tabToClipList(page);

    // The starter clip sits on BD in bar 1; Down selects it.
    await page.keyboard.press("ArrowDown");
    await expect(announcement(page)).toHaveText("Selected clip on BD, bar 1");
    await expect(clipList(page).getByRole("option", { selected: true })).toHaveCount(1);
    // While the list has focus, the timeline it speaks for shows the ring.
    const outline = await page
      .locator(".arrangement-viewport")
      .evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).toBe("solid");

    // Cmd/Ctrl+D duplicates it, and the copy is the selection.
    await page.keyboard.press("ControlOrMeta+d");
    await expect(announcement(page)).toHaveText("Selected clip on BD, bar 2");
    await expect(clipList(page).getByRole("option")).toHaveCount(2);

    // Up walks back to the original; Enter opens it in the sequence view.
    await page.keyboard.press("ArrowUp");
    await expect(announcement(page)).toHaveText("Selected clip on BD, bar 1");
    await page.keyboard.press("Enter");
    await expectView(page, "Sequence");
    await expect(sequenceView(page)).toBeVisible();

    // Back in the arrangement the clip is still selected, and the list takes
    // up from it: Down moves on to the copy, and Delete removes it.
    await backToArrangement(page);
    await tabToClipList(page);
    await expect(announcement(page)).toHaveText("Selected clip on BD, bar 1");
    await page.keyboard.press("ArrowDown");
    await expect(announcement(page)).toHaveText("Selected clip on BD, bar 2");
    await page.keyboard.press("Delete");
    await expect(clipList(page).getByRole("option")).toHaveCount(1);
  });
});
