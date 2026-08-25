import { expect, type Locator, type Page, test } from "@playwright/test";
import { walkthrough } from "../support/walkthrough";

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
 *    (#223) and loading a library sound onto one by dragging (#225). Neither
 *    affordance exists, so the selectors this file uses for them are the shape
 *    those issues are expected to deliver, not names read off a built UI.
 *  - Steps 7-11 are `ARR-003`'s own surface: the loop-range selection, the
 *    structure template, and section markers on the ruler.
 *
 * Where an existing surface already has an accessible name — the dashboard, the
 * step grid, the transport, undo, the arrangement's DOM mirror of its selection
 * — this file uses the real one. Everything else is a requirement being placed
 * on the implementation, and is called out where it appears.
 */

// Grid steps are 1-indexed, matching the accessible names the step editor emits.

/** The "and" of each beat: the offbeat a closed hat sits on. */
const OFFBEATS = [3, 7, 11, 15];
/** Beats 2 and 4 — the backbeat, not beat 1, which would just double the kick. */
const BACKBEAT = [5, 13];
/** Every third 16th: the rave stab. */
const RAVE_STAB = [1, 4, 7, 10, 13, 16];
/** Four on the floor, with the starter kick. */
const WITH_THE_KICK = [1, 5, 9, 13];

/**
 * One track's step grid.
 *
 * Every step editor on screen is currently labelled "Step editor"
 * (`src/editor/StepEditor.tsx`), which is unambiguous only while a project has
 * one track. This flow puts five on screen, so each track's grid has to carry
 * its own name — for assistive technology first, and for this spec second.
 */
const stepGrid = (page: Page, track: string): Locator =>
  page.getByRole("region", { name: `${track} step editor` });

/** Turn on each step of a pattern, asserting each one took. */
async function program(grid: Locator, steps: readonly number[]): Promise<void> {
  for (const step of steps) {
    await grid.getByRole("button", { name: `Notes, step ${step}, off` }).click();
    await expect(
      grid.getByRole("button", { name: `Notes, step ${step}, on` }),
    ).toBeVisible();
  }
}

/**
 * Add a named sampler track, drag a library sound onto its instrument, and
 * program its pattern.
 *
 * The two affordances this leans on are the ones #223 and #225 exist to
 * deliver: choosing the instrument kind when creating a track, and dropping a
 * library asset onto a sampler. Today "Add track" always mints a synth, and the
 * library's insert path is never wired into the editor.
 */
async function addSamplerTrack(
  page: Page,
  part: { name: string; sound: string; steps: readonly number[] },
): Promise<void> {
  await page.getByRole("button", { name: "Add sampler track" }).click();
  await page.getByRole("textbox", { name: "Track name" }).fill(part.name);
  await page.getByRole("textbox", { name: "Track name" }).press("Enter");

  await page.getByRole("button", { name: "Library" }).click();
  await page.getByRole("searchbox", { name: "Search sounds" }).fill(part.sound);
  const asset = page.getByRole("listitem").filter({ hasText: part.sound });
  await asset
    .first()
    .dragTo(page.getByRole("region", { name: `${part.name} instrument` }));

  // The sampler names what it is holding, so the drop is visible rather than
  // inferred from a later sound. #225 replaces the swap list with this label.
  await expect(
    page.getByRole("region", { name: `${part.name} instrument` }),
  ).toContainText(part.sound);
  await page.getByRole("button", { name: "Library" }).click();

  await program(stepGrid(page, part.name), part.steps);
}

/** The arrangement's DOM mirror of what is selected (`ArrangementView.tsx`). */
const selectedPlacements = (page: Page): Locator =>
  page.getByTestId("placement-selection").locator("li");

test.describe("CF-002", () => {
  test.fixme("a producer turns a loop into a song outline", async ({ page }) => {
    const step = walkthrough(page, {
      id: "CF-002",
      title: "A producer turns a loop into a song outline",
    });

    // 1. Create a new project. It opens on the step editor with the starter
    //    kick, four on the floor.
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "New Project" }).click();
    await expect(page).toHaveURL(/\/projects\/prj_/);
    await expect(page.getByRole("button", { name: "Notes, step 1, on" })).toBeVisible();
    await step("The new project opens on the starter kick");

    // 2. Add a sampler track named "Hats", load a closed hat onto it from
    //    the library, and put the hat on every offbeat.
    await addSamplerTrack(page, {
      name: "Hats",
      sound: "closed hat",
      steps: OFFBEATS,
    });
    await step("Add a hat track, on every offbeat");

    // 3. Add a sampler track named "Claps", with a clap on beats 2 and 4.
    await addSamplerTrack(page, {
      name: "Claps",
      sound: "clap",
      steps: BACKBEAT,
    });
    await step("Add a clap track, on beats 2 and 4");

    // 4. Add a sampler track named "Chords", with a chord stab on steps 1,
    //    4, 7, 10, 13 and 16.
    await addSamplerTrack(page, {
      name: "Chords",
      sound: "chord",
      steps: RAVE_STAB,
    });
    await step("Add a chord stab");

    // 5. Add a sampler track named "Bass", following the kick.
    await addSamplerTrack(page, {
      name: "Bass",
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
      "bars 1 to 1",
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
