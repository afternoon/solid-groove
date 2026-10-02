import { expect, type Locator, type Page, test } from "@playwright/test";
import { walkthrough } from "../../support/walkthrough";
import { library } from "../support/library";
import { backToArrangement, expectView, pressView, sequenceView } from "../support/views";

/**
 * `CF-002` — a producer turns a loop into a song outline.
 *
 * Read the flow in `docs/core-flows.md`; the numbered comments below are its
 * steps, in its words. This is the acceptance contract for `ARR-003` (#61) and
 * is frozen once it lands: a later PR that changes an assertion here has to say
 * so in its body and justify it.
 *
 * `test.fixme` because none of it is built yet. Two things are worth knowing
 * about what that means here:
 *
 *  - Steps 2-5 depend on work outside `ARR-003` — creating a sampler track
 *    (#223) and loading a library sound onto one (#225; since #817, from its
 *    sample slot through the Library view, not by dragging). Neither
 *    affordance exists, so the selectors this file uses for them are the shape
 *    those issues are expected to deliver, not names read off a built UI.
 *  - Steps 7-11 are `ARR-003`'s own surface: the loop-range selection, the
 *    structure template, and section markers on the ruler.
 *
 * **Revised for #496 (a sampler is a tonal instrument; the drum machine is the
 * one-shot player).** Hats and Claps are drum-machine tracks sequenced on the
 * step grid by pad ("HH, step 3, on"); Chords and Bass are sampler tracks
 * written in the piano roll at C4, which plays the sample as recorded. The
 * starter kick is read off the "BD" pad. Only what the new model forces has
 * changed: the loop, the outline and the undos are as before.
 *
 * **Revised for #817.** The sequence editor is a view on `2`, not a dialog over
 * the arrangement: opening a clip lands on it (`/sequence`), and `1` leaves it
 * instead of Escape. Parked at `test.fixme` until #817's stack lands too; the
 * PR that closes the last of these issues removes the marker.
 *
 * Where an existing surface already has an accessible name — the dashboard, the
 * step grid, the transport, undo, the arrangement's DOM mirror of its selection
 * — this file uses the real one. Everything else is a requirement being placed
 * on the implementation, and is called out where it appears.
 */

// Grid steps are 1-indexed, matching the accessible names the step editor and
// the piano roll emit.

/** The "and" of each beat: the offbeat a closed hat sits on. */
const OFFBEATS = [3, 7, 11, 15];
/** Beats 2 and 4 — the backbeat, not beat 1, which would just double the kick. */
const BACKBEAT = [5, 13];
/** Every third 16th: the rave stab. */
const RAVE_STAB = [1, 4, 7, 10, 13, 16];
/** Four on the floor, with the starter kick. */
const WITH_THE_KICK = [1, 5, 9, 13];
/** C4 plays a sampler's sample as it was recorded (#496). */
const AS_RECORDED = "C4";

/** One bar of the alpha's fixed 4/4 at 192 PPQ (`src/domain/time.ts`). */
const TICKS_PER_BAR = 4 * 192;

/** The interaction canvas the tracks are drawn on: a `<canvas>`, so a class (CF-016). */
const timeline = (page: Page): Locator => page.locator(".arrangement-layer-interactive");

/** Open the clip in bar 1 of track row `rowIndex`, and return the sequence view. */
async function openClip(page: Page, rowIndex: number): Promise<Locator> {
  const root = page.getByTestId("arrangement-view-ready");
  const pixelsPerTick = Number(await root.getAttribute("data-pixels-per-tick"));
  const rulerHeight = Number(await root.getAttribute("data-ruler-height"));
  const rowHeight = Number(await root.getAttribute("data-row-height"));
  expect(pixelsPerTick).toBeGreaterThan(0);
  expect(rowHeight).toBeGreaterThan(0);
  await timeline(page).dblclick({
    position: {
      x: 0.5 * TICKS_PER_BAR * pixelsPerTick,
      y: rulerHeight + rowIndex * rowHeight + rowHeight / 2,
    },
  });
  await expectView(page, "Sequence");
  await expect(sequenceView(page)).toBeVisible();
  return sequenceView(page);
}

/**
 * Name the track just added, the way the arrangement renames any track: a
 * click on its name in the header opens the "Track name" field. A new track
 * opens no name field of its own, and the newest track is the last header.
 * `.track-header-name` is the class the header's own tests click.
 */
async function nameTrack(page: Page, name: string): Promise<void> {
  await page.locator(".track-header-name").last().click();
  await page.getByRole("textbox", { name: "Track name" }).fill(name);
  await page.getByRole("textbox", { name: "Track name" }).press("Enter");
}

/**
 * Add a named drum-machine track and put one of its pads on `steps`, on the
 * step grid. The starter kit already carries a hat on "HH" and a clap on "CP",
 * so no library sound is loaded (#496: the drum machine is the one-shot
 * player, and drum one-shots live on its pads).
 */
async function addDrumTrack(
  page: Page,
  part: { name: string; row: number; pad: string; steps: readonly number[] },
): Promise<void> {
  await page.getByRole("button", { name: "Add drum machine track" }).click();
  await nameTrack(page, part.name);

  const editor = await openClip(page, part.row);
  for (const step of part.steps) {
    await editor.getByRole("button", { name: `${part.pad}, step ${step}, off` }).click();
    await expect(
      editor.getByRole("button", { name: `${part.pad}, step ${step}, on` }),
    ).toBeVisible();
  }
  await backToArrangement(page);
}

/**
 * Add a named sampler track, drag a library sound onto its instrument, and
 * write its notes in the piano roll. A sampler is a tonal instrument (#496):
 * its clip opens in the piano roll, and a note plays the sample at its pitch.
 *
 * The library drop is what #225 exists to deliver; the piano roll's rows and
 * ruler are the ones CF-017 uses.
 */
async function addSamplerTrack(
  page: Page,
  part: { name: string; row: number; sound: string; steps: readonly number[] },
): Promise<void> {
  await page.getByRole("button", { name: "Add sampler track" }).click();
  await nameTrack(page, part.name);

  // From the library (#817): the sampler's sample slot aims the Library view
  // at it, Shift+Enter inserts and comes back, and `1` returns to the song.
  await pressView(page, "Instrument");
  const instrument = page.getByRole("region", { name: `${part.name} instrument` });
  await instrument.getByRole("button", { name: "Sample", exact: true }).click();
  await expectView(page, "Library");
  await library(page).getByRole("searchbox", { name: "Search sounds" }).fill(part.sound);
  await library(page)
    .getByRole("button", { name: new RegExp(`^Audition .*${part.sound}`) })
    .first()
    .click();
  await page.keyboard.press("Shift+Enter");
  await expectView(page, "Instrument");

  // The sampler names what it is holding, so the insert is visible rather
  // than inferred from a later sound.
  await expect(instrument).toContainText(part.sound);
  await pressView(page, "Arrangement");

  const editor = await openClip(page, part.row);
  await expect(editor.getByRole("region", { name: /^Piano roll\b/ })).toBeVisible();
  const row = editor
    .getByRole("group", { name: "Pitches" })
    .getByRole("button", { name: new RegExp(`^${AS_RECORDED}(\\W*Off)?$`) });
  await row.scrollIntoViewIfNeeded();
  const rowBox = await row.boundingBox();
  if (!rowBox) throw new Error("expected a visible pitch row to measure");
  for (const step of part.steps) {
    const column = editor
      .getByRole("group", { name: "Ruler" })
      .getByRole("button", { name: `Step ${step}`, exact: true });
    const columnBox = await column.boundingBox();
    if (!columnBox) throw new Error("expected a visible ruler step to measure");
    await page.mouse.click(
      columnBox.x + columnBox.width / 2,
      rowBox.y + rowBox.height / 2,
    );
    await expect(
      editor
        .getByRole("listbox", { name: "Notes" })
        .getByRole("option", { name: new RegExp(`^${AS_RECORDED}, step ${step},`) }),
    ).toBeVisible();
  }
  await backToArrangement(page);
}

/** The arrangement's DOM mirror of what is selected (`ArrangementView.tsx`). */
const selectedPlacements = (page: Page): Locator =>
  page.getByTestId("placement-selection").locator("li");

test.describe("CF-002", () => {
  // `test.fixme` for #61 (the outline), since #496 for the starter drum
  // machine (step 1) and the sampler's piano roll (steps 4-5), and since #817
  // for the sequence view. The PR that
  // closes the last of them removes this marker.
  test.fixme("a producer turns a loop into a song outline", async ({ page }) => {
    const step = walkthrough(page, {
      id: "CF-002",
      title: "A producer turns a loop into a song outline",
    });

    // 1. Create a new project. It opens on the arrangement with the starter
    //    kick, a drum machine named "BD", four on the floor.
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "New Project" }).click();
    await expect(page).toHaveURL(/\/projects\/prj_/);
    await page.getByTestId("arrangement-view-ready").waitFor();
    const kick = await openClip(page, 0);
    for (const kickStep of WITH_THE_KICK) {
      await expect(
        kick.getByRole("button", { name: `BD, step ${kickStep}, on` }),
      ).toBeVisible();
    }
    await step("The new project opens on the starter kick");
    await backToArrangement(page);

    // 2. Add a drum-machine track named "Hats", and put the "HH" pad on
    //    every offbeat.
    await addDrumTrack(page, {
      name: "Hats",
      row: 1,
      pad: "HH",
      steps: OFFBEATS,
    });
    await step("Add a hat track, on every offbeat");

    // 3. Add a drum-machine track named "Claps", with the "CP" pad on beats
    //    2 and 4.
    await addDrumTrack(page, {
      name: "Claps",
      row: 2,
      pad: "CP",
      steps: BACKBEAT,
    });
    await step("Add a clap track, on beats 2 and 4");

    // 4. Add a sampler track named "Chords", load a chord stab onto it from
    //    the library, and write a C4 in the piano roll on steps 1, 4, 7, 10,
    //    13 and 16.
    await addSamplerTrack(page, {
      name: "Chords",
      row: 3,
      sound: "chord",
      steps: RAVE_STAB,
    });
    await step("Add a chord stab");

    // 5. Add a sampler track named "Bass", load a bass note onto it from the
    //    library, and write a C4 in the piano roll following the kick, on
    //    steps 1, 5, 9 and 13.
    await addSamplerTrack(page, {
      name: "Bass",
      row: 4,
      sound: "bass",
      steps: WITH_THE_KICK,
    });
    await step("Add a bass, following the kick");

    // 6. Play the loop — five parts, one bar, tight.
    //
    // As in CF-001, this asserts the transport is running, not that a sound
    // reached a speaker: a headless browser records no audio.
    await page.getByRole("button", { name: "Start playback" }).click();
    await expect(page.getByRole("button", { name: "Stop playback" })).toBeVisible();
    await step("Play the loop — five parts, one bar");
    await page.getByRole("button", { name: "Stop playback" }).click();

    // 7. Select the loop's bar range in the arrangement.
    await page.getByRole("button", { name: "Select Hats" }).click();
    await expect(page.getByTestId("arrangement-selection-live")).toContainText(
      "Selected clip on Hats, bar 1",
    );
    await step("Select the loop's bar range in the arrangement");

    // 8. Apply the structure template. The arrangement fills out: named,
    //    coloured sections along the ruler, each carrying its own copy of
    //    all five tracks.
    //
    // The template's full section list is ARR-003's to choose (#61); what
    // the flow pins is that applying it produces several named sections,
    // one of them the "Intro" step 9 works on, and that the loop was copied
    // into them rather than moved out of bar 1.
    await page.getByRole("button", { name: "Create song outline" }).click();
    const sections = page.getByRole("list", { name: "Sections" });
    await expect(sections.getByRole("listitem")).not.toHaveCount(0);
    await expect(sections.getByRole("listitem").first()).toContainText("Intro");
    await step("Apply the structure template — the arrangement fills out");

    // 9. Select the hats and the claps in the "Intro" and delete them
    //    together, so the song opens on the chord stab and the bass.
    //
    // One selection and one delete, so this is one undoable transaction —
    // which is what makes step 11's two undos land back on the loop.
    await page.getByRole("button", { name: "Select Hats in Intro" }).click();
    await page
      .getByRole("button", { name: "Select Claps in Intro" })
      .click({ modifiers: ["Shift"] });
    await expect(selectedPlacements(page)).toHaveCount(2);
    await page.keyboard.press("Delete");
    await expect(selectedPlacements(page)).toHaveCount(0);
    await step("Delete the hats and claps from the Intro");

    // 10. Play from the top — the drums arrive at the section boundary.
    await page.getByRole("button", { name: "Start playback" }).click();
    await expect(page.getByRole("button", { name: "Stop playback" })).toBeVisible();
    await step("Play from the top — the song opens on chords and bass");
    await page.getByRole("button", { name: "Stop playback" }).click();

    // 11. Undo twice: the drums come back, and then the outline collapses to
    //     the loop.
    await page.getByRole("button", { name: /^Undo/ }).click();
    await page.getByRole("button", { name: /^Undo/ }).click();
    await expect(sections.getByRole("listitem")).toHaveCount(0);
    await step("Undo twice — back to the loop it started from");
  });
});
