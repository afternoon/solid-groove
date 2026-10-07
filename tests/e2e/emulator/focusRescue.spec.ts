import { newProject } from "./support/assistant";
import { expect, type Page, test } from "./support/test";
import { pressView } from "./support/views";

/**
 * Focus is never stranded (#76). When the element holding focus leaves the
 * page — its view swapped out by a view key, its track deleted from its own
 * header — focus goes to the view now on screen, not to `<body>`, where the
 * next Tab would start again from the top and a screen reader says nothing.
 * Asserted in a real browser, because only a real one drops focus on removal
 * the way a keyboard user meets it.
 */

/** Whether focus is on nothing at all. */
const stranded = (page: Page): Promise<boolean> =>
  page.evaluate(() => document.activeElement === document.body);

test.describe("focus rescue", () => {
  test("a view key, and a track deleted from its header, leave focus in the editor", async ({
    page,
  }) => {
    await newProject(page);
    const arrangement = page.getByTestId("arrangement-view-ready");

    // A fader in the mixer has focus; `1` takes the mixer away.
    await pressView(page, "Mixer");
    await page.getByRole("slider", { name: "Volume for BD" }).focus();
    await page.keyboard.press("1");
    await expect(arrangement).toBeFocused();
    expect(await stranded(page)).toBe(false);

    // The arrangement's keys work from there: select all, and hear it.
    await page.keyboard.press("ControlOrMeta+a");
    await expect(page.getByTestId("arrangement-selection-live")).toHaveText(
      "Selected clip on BD, bar 1",
    );

    // Deleting a track from its own header takes the button with it.
    await page.getByRole("button", { name: "Delete BD" }).first().click();
    await expect(arrangement).toBeFocused();
  });
});
