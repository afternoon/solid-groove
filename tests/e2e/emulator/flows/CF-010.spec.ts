import { expect, type Locator, type Page, test } from "@playwright/test";
import { walkthrough } from "../../support/walkthrough";

/**
 * `CF-010`: a producer selects a stretch of the song across tracks and deletes
 * it.
 *
 * Read the flow in `docs/core-flows.md`. The numbered comments below are its
 * steps, in its words. This is one of the three acceptance contracts for #292
 * (one arrangement selection), and it is frozen once it lands: a later PR that
 * changes an assertion here has to say so in its body and justify it.
 *
 * It is `test.fixme` because none of this exists yet. Today a press on empty
 * space selects one bar on one track, a drag does not extend it, a bar range
 * never selects the placements under it, and Delete acts only on
 * `placementEditingController`'s own ID set. The PR that closes #292 removes
 * this marker.
 *
 * What it holds #292 to, from the product owner's decisions on the issue:
 *
 *  - **A range can cover more than one track**, and it selects every clip it
 *    touches, including one that is only partly inside it.
 *  - **Several covered clips are announced as a count**: "{n} clips selected".
 *  - **Delete removes the covered time, not the covered clips** (Ableton). A
 *    clip wholly inside the range goes. A clip partly inside it is trimmed to
 *    the part outside. Nothing outside the range is touched, and the result
 *    survives a reload.
 *  - **A range across several tracks that covers no clip is named by the
 *    track count and exact position**: "Selected 2 tracks, 2.4.1 to 4.4.1".
 *    The spec drags one over the deleted stretch to show it is empty.
 *
 * The range starts in empty space because pressing on a clip and dragging
 * moves the clip. Ranges do not snap, and the pointer can only land on a whole
 * pixel. At the zoom a new project opens with, a pixel is about 7 ticks and a
 * sixteenth is 48. So every range end here is aimed a quarter of the way into
 * a sixteenth (12 ticks in), far from any bar line or clip edge. A pixel
 * either way cannot leave that sixteenth. Because the aim is short of halfway,
 * naming the sixteenth a position falls in and naming the nearest one agree.
 *
 * Step 1 moves one clip by its body and lengthens another by the resize handle
 * on its right edge. Both are ARR-002 gestures that #292 keeps, and both still
 * snap to whole bars, so those clips are announced by whole bars.
 *
 * Whether a clip is still there is read the way a screen-reader user would
 * find out: select it and listen.
 */

/** Musical time at 192 PPQ in the alpha's fixed 4/4 (`src/domain/time.ts`). */
const TICKS_PER_SIXTEENTH = 48;
const TICKS_PER_BEAT = 4 * TICKS_PER_SIXTEENTH;
const TICKS_PER_BAR = 4 * TICKS_PER_BEAT;

/**
 * The tick a quarter of the way into sixteenth `bar.beat.sixteenth` (all
 * 1-based, as announcements name them). See the note above for why.
 */
const insideSixteenth = (bar: number, beat: number, sixteenth: number): number =>
  (bar - 1) * TICKS_PER_BAR +
  (beat - 1) * TICKS_PER_BEAT +
  (sixteenth - 1) * TICKS_PER_SIXTEENTH +
  TICKS_PER_SIXTEENTH / 4;

/** The middle of `bar` (1-based), in ticks: where a one-bar clip is clicked. */
const midBar = (bar: number): number => (bar - 0.5) * TICKS_PER_BAR;

/**
 * The interaction canvas the clips are drawn on. A class, deliberately: it is a
 * `<canvas>`, so it has no role or accessible name to reach it by, and a clip
 * can only be clicked as a coordinate on it (see CF-004 and CF-008).
 */
const timeline = (page: Page): Locator => page.locator(".arrangement-layer-interactive");

/** The arrangement's `aria-live` selection announcement (`ArrangementView`). */
const announcement = (page: Page): Locator =>
  page.getByTestId("arrangement-selection-live");

/** The arrangement's accessible mirror of the track list, top to bottom. */
const trackList = (page: Page): Locator =>
  page.getByRole("list", { name: "Arrangement tracks" }).getByRole("listitem");

/**
 * The point at `ticks` on track row `rowIndex`, in the timeline canvas's own
 * coordinates.
 *
 * Both scales are read off the arrangement root, never copied: the horizontal
 * one is `data-pixels-per-tick` (CF-004) and the vertical one is
 * `data-ruler-height`/`data-row-height` (CF-008). The flow never scrolls or
 * zooms, so a tick's x is its distance from the canvas's left edge.
 */
async function pointAt(
  page: Page,
  rowIndex: number,
  ticks: number,
): Promise<{ x: number; y: number }> {
  const root = page.getByTestId("arrangement-view-ready");
  const pixelsPerTick = Number(await root.getAttribute("data-pixels-per-tick"));
  const rulerHeight = Number(await root.getAttribute("data-ruler-height"));
  const rowHeight = Number(await root.getAttribute("data-row-height"));
  expect(pixelsPerTick).toBeGreaterThan(0);
  expect(rowHeight).toBeGreaterThan(0);
  return {
    x: ticks * pixelsPerTick,
    y: rulerHeight + rowIndex * rowHeight + rowHeight / 2,
  };
}

/** Click at `ticks` on track row `rowIndex`. */
async function clickAt(page: Page, rowIndex: number, ticks: number): Promise<void> {
  await timeline(page).click({ position: await pointAt(page, rowIndex, ticks) });
}

/** Press at one canvas point, drag to another, and release. */
async function drag(
  page: Page,
  start: { x: number; y: number },
  end: { x: number; y: number },
): Promise<void> {
  const box = await timeline(page).boundingBox();
  if (!box) throw new Error("The arrangement timeline has no box to drag on.");
  await page.mouse.move(box.x + start.x, box.y + start.y);
  await page.mouse.down();
  await page.mouse.move(box.x + end.x, box.y + end.y, { steps: 12 });
  await page.mouse.up();
}

/**
 * The state steps 3 and 5 both promise.
 *
 *  - The "BD" clip in bar 1 is still there, and still one bar long.
 *  - The "Sampler" clip is still there. Only the start of the announcement is
 *    asserted, because the trim left the clip ending wherever the pointer
 *    started the range, not on a bar line. Whether such a clip is named by
 *    whole bars or by position has not been decided.
 *  - Nothing is left on either track from bar 2, beat 4 onwards. A range
 *    dragged over that stretch covers no clip, so it is announced in the range
 *    form. That also shows the Sampler clip no longer reaches it.
 */
async function expectAfterDelete(page: Page): Promise<void> {
  await clickAt(page, 0, midBar(1));
  await expect(announcement(page)).toHaveText("Selected clip on BD, bar 1");
  await clickAt(page, 1, insideSixteenth(1, 2, 1));
  await expect(announcement(page)).toHaveText(/^Selected clip on Sampler, /);
  await drag(
    page,
    await pointAt(page, 0, insideSixteenth(2, 4, 1)),
    await pointAt(page, 1, insideSixteenth(4, 4, 1)),
  );
  await expect(announcement(page)).toHaveText("Selected 2 tracks, 2.4.1 to 4.4.1");
}

test.describe("CF-010", () => {
  // `test.fixme` until #292 lands: the PR that closes it removes this marker in
  // the same diff that makes the flow pass.
  test.fixme(
    "a producer selects a stretch of the song across tracks and deletes it",
    async ({ page }) => {
      const step = walkthrough(page, {
        id: "CF-010",
        title: "A producer selects a stretch of the song across tracks and deletes it",
      });

      // 1. Create a new project, duplicate the "BD" clip, and drag the copy
      //    along to bar 3, so "BD" has a clip in bar 1 and another in bar 3
      //    with bar 2 empty between them. Add a sampler track and drag the
      //    right edge of its clip out to the end of bar 3, so "Sampler" has one
      //    clip across bars 1 to 3.
      await page.goto("/dashboard");
      await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
      await page.getByRole("button", { name: "New Project" }).click();
      await expect(page).toHaveURL(/\/projects\/prj_/);
      const projectUrl = page.url();
      await page.getByTestId("arrangement-view-ready").waitFor();

      await clickAt(page, 0, midBar(1));
      await page.getByRole("button", { name: /^Duplicate as a linked copy/ }).click();
      // Pressing on a clip's body and dragging moves it, a bar at a time.
      await drag(
        page,
        await pointAt(page, 0, midBar(2)),
        await pointAt(page, 0, midBar(3)),
      );

      await page.getByRole("button", { name: "Add sampler track" }).click();
      await expect(trackList(page)).toHaveText(["BD", "Sampler"]);
      // One pixel inside the clip's right edge, which is its resize handle.
      const rightEdge = await pointAt(page, 1, TICKS_PER_BAR);
      await drag(
        page,
        { ...rightEdge, x: rightEdge.x - 1 },
        await pointAt(page, 1, 3 * TICKS_PER_BAR),
      );

      await clickAt(page, 0, midBar(3));
      await expect(announcement(page)).toHaveText("Selected clip on BD, bar 3");
      await clickAt(page, 1, midBar(2));
      await expect(announcement(page)).toHaveText(
        "Selected clip on Sampler, bars 1 to 3",
      );
      await step("BD has clips in bars 1 and 3; Sampler has one clip across bars 1 to 3");

      // 2. Press in the empty bar 2 on "BD", at 2.3.1, and drag down and along
      //    to 4.3.1 on "Sampler". A dotted outline covers that stretch on both
      //    tracks. The "BD" clip in bar 3, which is wholly inside it, and the
      //    "Sampler" clip, which is only partly inside it, each get a solid
      //    outline, and the arrangement announces "2 clips selected". The "BD"
      //    clip in bar 1 is not selected.
      await drag(
        page,
        await pointAt(page, 0, insideSixteenth(2, 3, 1)),
        await pointAt(page, 1, insideSixteenth(4, 3, 1)),
      );
      // Two: the BD clip in bar 3 and the partly covered Sampler clip. Not
      // three, because the BD clip in bar 1 ends before the range begins.
      await expect(announcement(page)).toHaveText("2 clips selected");
      await step("Drag across both tracks: the two clips it touches are selected");

      // 3. Press Delete. The "BD" clip in bar 3 is gone. The "Sampler" clip now
      //    stops at 2.3.1, where the stretch began, and the "BD" clip in bar 1
      //    is untouched.
      await page.keyboard.press("Delete");
      await expectAfterDelete(page);
      await step("Press Delete: the BD clip in bar 3 is gone, the Sampler clip trimmed");

      // 4. Reload the page.
      //
      // Not a step of the flow. The promise after the reload only means
      // something once the delete has been written, and the save status is how
      // the editor reports that a revision-checked write completed.
      await expect(page.locator(".save-status")).toHaveText("Saved", {
        timeout: 10_000,
      });
      await page.reload();

      // 5. The project reopens exactly as step 3 left it.
      await expect(page).toHaveURL(projectUrl);
      await page.getByTestId("arrangement-view-ready").waitFor();
      await expect(trackList(page)).toHaveText(["BD", "Sampler"]);
      await expectAfterDelete(page);
      await step("Reopened exactly as the delete left it");
    },
  );
});
