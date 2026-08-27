import { expect, type Locator, type Page, test } from "@playwright/test";
import { walkthrough } from "../../support/walkthrough";

/**
 * `CF-005` — a producer drops a loop from the library onto a new track.
 *
 * Read the flow in `docs/core-flows.md`; the numbered comments below are its
 * steps, in its words. This is the acceptance contract for `LOOP-019` (#281)
 * and is frozen once it lands: a later PR that changes an assertion here has to
 * say so in its body and justify it.
 *
 * `test.fixme` because the drop path does not exist yet — #281 is the PR that
 * removes this marker. What is missing today:
 *
 *  - **The drop itself.** `src/library/assetDrag.ts` already carries a browsed
 *    sound on a `DataTransfer` under `LIBRARY_SAMPLE_MIME`, and this spec drags
 *    a real library row so that mechanism is what is exercised — but the only
 *    thing that reads the payload today is the instrument panel (#225), which
 *    loads a sampler. Nothing turns a dropped *loop* into a new track.
 *  - **The loop's tempo on the row.** Step 2 asks the producer to find a loop
 *    "recorded at a different tempo from the project's", which they can only do
 *    if the browser says what tempo each loop was recorded at. `AssetRow` shows
 *    a name, a role and a pack; the manifest already carries `bpm`. Surfacing
 *    it is #281's, and this spec finds its loop by reading it.
 *  - **The loop brace** step 5 asserts is unchanged, which is #280/#278.
 *    CF-005 is where "nothing in the product moves the brace on the user's
 *    behalf" is proved from the other side, so this flow depends on that
 *    surface existing even though it never touches it.
 *
 * Runs against the Firestore/Auth emulator rather than the mock backend,
 * because step 6 is a real `page.reload()` and the mock repository is a fresh,
 * empty store on every page load.
 *
 * Like CF-004, this spec needs the timeline's horizontal scale to work in a
 * canvas: #281 reads `data-pixels-per-tick` off the arrangement root, the hook
 * CF-004 introduces, because the only way to observe *where* a canvas-drawn
 * clip landed is to click it and see what gets selected.
 */

/** One bar of the alpha's fixed 4/4 at 192 PPQ (`src/domain/time.ts`). */
const TICKS_PER_BAR = 4 * 192;

/** The ruler strip's height in CSS pixels (`canvasRenderer.RULER_HEIGHT_PX`). */
const RULER_HEIGHT_PX = 22;

/** One track row's height (`ArrangementView.ROW_METRICS.trackHeightPx`). */
const ROW_HEIGHT_PX = 28;

/** The library panel (`LibraryBrowser`'s `<section aria-label="Library">`). */
const library = (page: Page): Locator => page.getByRole("region", { name: "Library" });

/**
 * The interaction canvas the tracks are drawn on. A class, deliberately: it is
 * a `<canvas>`, so there is no role or accessible name to reach it by, and both
 * the drop and the click that inspects the result are coordinates on it.
 */
const timeline = (page: Page): Locator => page.locator(".arrangement-layer-interactive");

/** The arrangement's accessible mirror of the loop brace (see CF-004). */
const loopBrace = (page: Page): Locator => page.getByTestId("arrangement-loop-live");

/** The arrangement's accessible mirror of the track list, top to bottom. */
const trackList = (page: Page): Locator =>
  page.getByRole("list", { name: "Arrangement tracks" }).getByRole("listitem");

/** The arrangement's accessible mirror of the placement selection. */
const selectedPlacements = (page: Page): Locator =>
  page.getByTestId("placement-selection").locator("li");

/**
 * The first loop in the browser recorded at some tempo other than the
 * project's — step 2's "a drum loop that was recorded at a different tempo".
 *
 * Found by reading the rows rather than by naming a sound, so the flow keeps
 * proving what it is about — a loop whose tempo differs from the song's — as
 * the delivered library changes underneath it.
 */
async function loopAtAnotherTempo(
  page: Page,
  projectTempo: number,
): Promise<{ row: Locator; name: string; sourceTempo: number }> {
  const auditions = library(page).getByRole("button", { name: /^Audition / });
  const count = await auditions.count();
  for (let index = 0; index < count; index += 1) {
    const audition = auditions.nth(index);
    const row = audition.locator("..");
    const sourceTempo = Number(
      (await row.textContent())?.match(/(\d+)\s*BPM/)?.[1] ?? Number.NaN,
    );
    if (!Number.isFinite(sourceTempo) || sourceTempo === projectTempo) continue;
    const name = ((await audition.getAttribute("aria-label")) ?? "").replace(
      /^Audition /,
      "",
    );
    return { row, name, sourceTempo };
  }
  throw new Error(
    `No loop in the library states a tempo other than the project's ${projectTempo} BPM.`,
  );
}

test.describe("CF-005", () => {
  // `test.fixme` until #281 (LOOP-019) lands: that PR removes this marker in
  // the same diff that makes the flow pass.
  test.fixme(
    "a producer drops a loop from the library onto a new track",
    async ({ page }) => {
      const step = walkthrough(page, {
        id: "CF-005",
        title: "A producer drops a loop from the library onto a new track",
      });

      // 1. Create a new project. It opens on the starter kick pattern.
      await page.goto("/dashboard");
      await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
      await page.getByRole("button", { name: "New Project" }).click();
      await expect(page).toHaveURL(/\/projects\/prj_/);
      const projectUrl = page.url();
      await expect(page.getByRole("button", { name: "Notes, step 1, on" })).toBeVisible();
      await page.getByTestId("arrangement-view-ready").waitFor();
      await expect(trackList(page)).toHaveCount(1);
      await step("A new project opens on the starter kick pattern");

      // 2. In the library browser, find a drum loop that was recorded at a
      //    different tempo from the project's.
      //
      // The panel's top level is the packs this project has — a new project
      // has the starter kick's pack, and the drum loops live in it — so
      // finding a loop means opening that pack node and searching within it.
      const tempoInput = page.getByRole("spinbutton", { name: "Tempo (BPM)" });
      const projectTempo = Number(await tempoInput.inputValue());
      await library(page).getByRole("searchbox", { name: "Search sounds" }).fill("loop");
      await library(page).getByRole("button", { expanded: false }).first().click();
      const loop = await loopAtAnotherTempo(page, projectTempo);
      await expect(loop.row).toBeVisible();
      await step("Find a loop in the library recorded at another tempo");

      // 3. Drag it out of the browser and drop it on empty space in the track
      //    area.
      //
      // Empty space: below every existing row, and at a bar that is not bar 1,
      // so step 4's "starting at bar 1" cannot pass by accident — the product
      // deliberately ignores the bar the pointer was over.
      const box = await timeline(page).boundingBox();
      if (!box) throw new Error("The arrangement timeline has no box to drop on.");
      await loop.row.dragTo(timeline(page), {
        targetPosition: {
          x: Math.min(box.width - 8, box.width / 2),
          y: RULER_HEIGHT_PX + ROW_HEIGHT_PX * 3,
        },
      });

      // 4. A new track appears at the bottom of the track list, carrying that
      //    loop as a clip starting at bar 1, marked as a loop that follows the
      //    project tempo rather than a pitched one-shot.
      await expect(trackList(page)).toHaveCount(2);
      await expect(trackList(page).last()).toContainText(loop.name);

      // Where the clip landed can only be read off the canvas by clicking it:
      // a click at bar 1 of the new row selects a placement only if one is
      // actually there.
      const pixelsPerTick = Number(
        await page
          .getByTestId("arrangement-view-ready")
          .getAttribute("data-pixels-per-tick"),
      );
      expect(pixelsPerTick).toBeGreaterThan(0);
      await timeline(page).click({
        position: {
          x: (TICKS_PER_BAR / 2) * pixelsPerTick,
          y: RULER_HEIGHT_PX + ROW_HEIGHT_PX + ROW_HEIGHT_PX / 2,
        },
      });
      await expect(selectedPlacements(page)).toHaveCount(1);

      // Marked as a loop, not a pitched one-shot: `LoopInfo` (INS-02) is the
      // surface that says so, and it reports the tempo the loop was recorded
      // at against the tempo it is playing at.
      const loopPanel = page.getByRole("region", { name: "Audio loop" });
      await expect(loopPanel).toContainText("Tempo-labelled loop");
      await expect(loopPanel).toContainText(loop.name);
      await expect(loopPanel).toContainText(`${loop.sourceTempo} BPM`);
      await expect(loopPanel).toContainText(`${projectTempo} BPM`);
      await step("A new track at the bottom carries the loop at bar 1");

      // 5. Nothing else moved: the project tempo is unchanged, the loop brace
      //    is where it was, and the transport is still stopped.
      await expect(tempoInput).toHaveValue(String(projectTempo));
      await expect(loopBrace(page)).toContainText("bars 1 to 1");
      await expect(page.getByRole("button", { name: "Start playback" })).toBeVisible();
      await step("The tempo, the brace and the transport are untouched");

      // 6. Reload the page. The new track and its loop are still there.
      //
      // The reload is only meaningful once the drop has actually been written,
      // which the save status is how the editor reports.
      await expect(page.locator(".save-status")).toHaveText("Saved", {
        timeout: 10_000,
      });
      await page.reload();
      await expect(page).toHaveURL(projectUrl);
      await page.getByTestId("arrangement-view-ready").waitFor();
      await expect(trackList(page)).toHaveCount(2);
      await expect(trackList(page).last()).toContainText(loop.name);
      await expect(page.getByRole("region", { name: "Audio loop" })).toContainText(
        loop.name,
      );
      await step("Reload — the new track and its loop are still there");
    },
  );
});
