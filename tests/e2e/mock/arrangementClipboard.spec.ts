import { expect, type Locator, type Page, test } from "@playwright/test";

/**
 * The arrangement clipboard through the real keys (#292).
 *
 * Paste had no browser test, and it was dead in the real UI: a cut, or a click
 * in empty space, cleared the only selection that made Mod+V reachable, and
 * paste went to the playhead instead of where the user pointed. A component
 * test fires synthetic `keydown`s at `window`; this presses
 * `ControlOrMeta+c/x/v` in a browser, so the platform modifier and the
 * canvas's focus handling are the real ones.
 *
 * Positions are read the way a screen-reader user would: select and listen.
 * A click lands on a whole pixel (about 7 ticks at the opening zoom), so the
 * insertion point is aimed a quarter of the way into a sixteenth, as CF-010
 * aims its ranges, and the pasted clip is named by that sixteenth.
 */

const TICKS_PER_SIXTEENTH = 48;
const TICKS_PER_BAR = 16 * TICKS_PER_SIXTEENTH;

/** A quarter of the way into the first sixteenth of `bar` (1-based). */
const startOfBar = (bar: number): number =>
  (bar - 1) * TICKS_PER_BAR + TICKS_PER_SIXTEENTH / 4;

/** The middle of `bar` (1-based). */
const midBar = (bar: number): number => (bar - 0.5) * TICKS_PER_BAR;

const announcement = (page: Page): Locator =>
  page.getByTestId("arrangement-selection-live");

/** Click the first track row at `ticks`, scales read off the arrangement root. */
async function clickAt(page: Page, ticks: number): Promise<void> {
  const root = page.getByTestId("arrangement-view-ready");
  const pixelsPerTick = Number(await root.getAttribute("data-pixels-per-tick"));
  const rulerHeight = Number(await root.getAttribute("data-ruler-height"));
  const rowHeight = Number(await root.getAttribute("data-row-height"));
  await page.locator(".arrangement-layer-interactive").click({
    position: { x: ticks * pixelsPerTick, y: rulerHeight + rowHeight / 2 },
  });
}

test.describe("arrangement clipboard", () => {
  test("copy, click an empty bar, paste; then cut and paste it back", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "New Project" }).click();
    await expect(page).toHaveURL(/\/projects\/prj_/);
    await page.getByTestId("arrangement-view-ready").waitFor();

    // The starter clip sits on BD in bar 1.
    await clickAt(page, midBar(1));
    await expect(announcement(page)).toHaveText("Selected clip on BD, bar 1");
    await page.keyboard.press("ControlOrMeta+c");

    // A click in empty bar 3 sets the insertion point, and paste lands there.
    await clickAt(page, startOfBar(3));
    await expect(announcement(page)).toHaveText("Position 3.1.1");
    await page.keyboard.press("ControlOrMeta+v");
    await expect(announcement(page)).toHaveText("Selected clip on BD, 3.1.1 to 4.1.1");

    // Cut leaves the time it took selected, so paste puts the clip back.
    await page.keyboard.press("ControlOrMeta+x");
    await expect(announcement(page)).toHaveText("Selected BD, 3.1.1 to 4.1.1");
    await page.keyboard.press("ControlOrMeta+v");
    await expect(announcement(page)).toHaveText("Selected clip on BD, 3.1.1 to 4.1.1");

    // Both clips are there: the source, untouched, and the copy.
    await clickAt(page, midBar(1));
    await expect(announcement(page)).toHaveText("Selected clip on BD, bar 1");
    await clickAt(page, midBar(3));
    await expect(announcement(page)).toHaveText("Selected clip on BD, 3.1.1 to 4.1.1");
  });
});
