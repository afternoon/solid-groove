import { expect, type Locator, type Page, test } from "@playwright/test";
import { walkthrough } from "../../support/walkthrough";

/**
 * `CF-005` — a producer brings a library loop into their project.
 *
 * Read the flow in `docs/core-flows.md`; the numbered comments below are its
 * steps, in its words. This is the acceptance contract for `LOOP-019` (#281)
 * and is frozen once it lands: a later PR that changes an assertion here has to
 * say so in its body and justify it.
 *
 * **Rewritten by #304**, which makes the library a modal opened from a slot
 * rather than a panel standing open beside the arrangement. This spec used to
 * drag a row out of that panel and drop it on the track area; there is nothing
 * to drag out of a window that covers the thing you would drop onto, so the
 * producer now asks the arrangement for a loop and picks one. The outcome the
 * flow asserts is the same in every particular: a new track at the bottom,
 * carrying that loop as a clip at bar 1, and nothing else in the project moved.
 *
 * `test.fixme` because none of that path exists yet — #281 is the PR that
 * removes this marker. What is missing today:
 *
 *  - **The insertion itself.** `loadSampleCommands` (#225) points a *sampler*
 *    at an asset; nothing turns a chosen loop into a new track carrying an
 *    audio clip. That is #281's subject and the reason this flow exists.
 *  - **The way in.** The arrangement has no affordance that opens the library,
 *    because today the library is always on screen. #304 removes the panel and
 *    owes this entrypoint.
 *  - **The loop's tempo on the row.** Step 3 asks the producer to find a loop
 *    "recorded at a different tempo from the project's", which they can only do
 *    if the browser says what tempo each loop was recorded at. `AssetRow` shows
 *    a name, a role and a pack; the manifest already carries `bpm`. Surfacing
 *    it is #281's, and this spec finds its loop by reading it.
 *  - **The loop brace** step 6 asserts is unchanged, which is #280/#278.
 *    CF-005 is where "nothing in the product moves the brace on the user's
 *    behalf" is proved from the other side, so this flow depends on that
 *    surface existing even though it never touches it.
 *
 * Runs against the Firestore/Auth emulator rather than the mock backend,
 * because step 7 is a real `page.reload()` and the mock repository is a fresh,
 * empty store on every page load.
 *
 * Like CF-004, this spec needs the timeline's horizontal scale to work in a
 * canvas: it reads `data-pixels-per-tick` off the arrangement root, because the
 * only way to observe *where* a canvas-drawn clip landed is to click it and see
 * what gets selected.
 */

/** One bar of the alpha's fixed 4/4 at 192 PPQ (`src/domain/time.ts`). */
const TICKS_PER_BAR = 4 * 192;

/** The ruler strip's height in CSS pixels (`canvasRenderer.RULER_HEIGHT_PX`). */
const RULER_HEIGHT_PX = 22;

/** One track row's height (`ArrangementView.ROW_METRICS.trackHeightPx`). */
const ROW_HEIGHT_PX = 28;

/**
 * The arrangement's way into the library (#304).
 *
 * Matched by what it is for rather than by exact wording, because the flow says
 * "choose to add a loop from the library" and does not dictate the label. What
 * it *does* dictate is that the arrangement has such a control at all: with the
 * library panel gone, a producer with an empty song and no sampler track to
 * fill has no other way to reach a sound.
 */
const addFromLibrary = (page: Page): Locator =>
  page.getByRole("button", { name: /library/i }).first();

/** The library, as the modal #304 makes it (`LibraryBrowser` inside a dialog). */
const library = (page: Page): Locator => page.getByRole("dialog", { name: "Library" });

/**
 * The interaction canvas the tracks are drawn on. A class, deliberately: it is
 * a `<canvas>`, so there is no role or accessible name to reach it by, and the
 * click that inspects the result is a coordinate on it.
 */
const timeline = (page: Page): Locator => page.locator(".arrangement-layer-interactive");

/** The sequence editor #304 opens over the arrangement (see CF-008). */
const sequenceEditor = (page: Page): Locator =>
  page.getByRole("dialog", { name: "Sequence editor" });

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
 * project's — step 3's "a drum loop that was recorded at a different tempo".
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
  test.fixme("a producer brings a library loop into their project", async ({ page }) => {
    const step = walkthrough(page, {
      id: "CF-005",
      title: "A producer brings a library loop into their project",
    });

    // 1. Create a new project. It opens on the arrangement, carrying the
    //    starter kick pattern.
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
    await page.getByRole("button", { name: "New Project" }).click();
    await expect(page).toHaveURL(/\/projects\/prj_/);
    const projectUrl = page.url();
    await page.getByTestId("arrangement-view-ready").waitFor();
    await expect(trackList(page)).toHaveCount(1);
    await step("A new project opens on the arrangement, with the starter pattern");

    // 2. Choose to add a loop from the library. The library opens over the
    //    arrangement.
    const tempoInput = page.getByRole("spinbutton", { name: "Tempo (BPM)" });
    const projectTempo = Number(await tempoInput.inputValue());
    await addFromLibrary(page).click();
    await expect(library(page)).toBeVisible();

    // 3. Find a drum loop that was recorded at a different tempo from the
    //    project's, and insert it.
    //
    // The browser's top level is the packs this project has — a new project
    // has the starter kick's pack, and the drum loops live in it — so finding
    // a loop means opening that pack node and searching within it.
    await library(page).getByRole("searchbox", { name: "Search sounds" }).fill("loop");
    await library(page).getByRole("button", { expanded: false }).first().click();
    const loop = await loopAtAnotherTempo(page, projectTempo);
    await expect(loop.row).toBeVisible();
    await step("Find a loop in the library recorded at another tempo");

    await library(page)
      .getByRole("button", { name: `Insert ${loop.name}` })
      .click();

    // 4. The library closes. A new track appears at the bottom of the track
    //    list, carrying that loop as a clip starting at bar 1.
    await expect(library(page)).toHaveCount(0);
    await expect(trackList(page)).toHaveCount(2);
    await expect(trackList(page).last()).toContainText(loop.name);

    // Where the clip landed can only be read off the canvas by clicking it: a
    // click at bar 1 of the new row selects a placement only if one is
    // actually there.
    const pixelsPerTick = Number(
      await page
        .getByTestId("arrangement-view-ready")
        .getAttribute("data-pixels-per-tick"),
    );
    expect(pixelsPerTick).toBeGreaterThan(0);
    const bar1OfNewTrack = {
      x: (TICKS_PER_BAR / 2) * pixelsPerTick,
      y: RULER_HEIGHT_PX + ROW_HEIGHT_PX + ROW_HEIGHT_PX / 2,
    };
    await timeline(page).click({ position: bar1OfNewTrack });
    await expect(selectedPlacements(page)).toHaveCount(1);
    await step("A new track at the bottom carries the loop at bar 1");

    // 5. Open that clip. It is named as a loop that follows the project tempo
    //    rather than a pitched one-shot, and it states the tempo it was
    //    recorded at. Close it again.
    //
    // `LoopInfo` (INS-02) is the surface that says so, and #304 moves it inside
    // the sequence editor, beside the clip it describes.
    await timeline(page).dblclick({ position: bar1OfNewTrack });
    const loopPanel = sequenceEditor(page).getByRole("region", { name: "Audio loop" });
    await expect(loopPanel).toContainText("Tempo-labelled loop");
    await expect(loopPanel).toContainText(loop.name);
    await expect(loopPanel).toContainText(`${loop.sourceTempo} BPM`);
    await expect(loopPanel).toContainText(`${projectTempo} BPM`);
    await step("Open the clip — it is a tempo-labelled loop, not a one-shot");

    await page.keyboard.press("Escape");
    await expect(sequenceEditor(page)).toHaveCount(0);

    // 6. Nothing else moved: the project tempo is unchanged, the loop brace is
    //    where it was, and the transport is still stopped.
    await expect(tempoInput).toHaveValue(String(projectTempo));
    await expect(loopBrace(page)).toContainText("bar 1");
    await expect(page.getByRole("button", { name: "Start playback" })).toBeVisible();
    await step("The tempo, the brace and the transport are untouched");

    // 7. Reload the page. The new track and its loop are still there.
    //
    // The reload is only meaningful once the insertion has actually been
    // written, which the save status is how the editor reports.
    await expect(page.locator(".save-status")).toHaveText("Saved", {
      timeout: 10_000,
    });
    await page.reload();
    await expect(page).toHaveURL(projectUrl);
    await page.getByTestId("arrangement-view-ready").waitFor();
    await expect(trackList(page)).toHaveCount(2);
    await expect(trackList(page).last()).toContainText(loop.name);
    await step("Reload — the new track and its loop are still there");
  });
});
