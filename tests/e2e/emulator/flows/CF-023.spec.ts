import { walkthrough } from "../../support/walkthrough";
import {
  audition,
  backToInstrument,
  categoryChip,
  deliveredLibrary,
  drumOneShots,
  emptyUndo,
  expectSelected,
  familyTab,
  insertButton,
  insertedBackToInstrument,
  library,
  libraryHeader,
  listedNames,
  newProjectOnInstrumentView,
  openPadSlot,
  precondition,
  railButton,
  readout,
  reloadOnInstrumentView,
  resultCount,
  sampleSlot,
  slotSound,
  soundList,
} from "../support/library";
import { expect, test } from "../support/test";
import { expectView } from "../support/views";

/**
 * `CF-023`: a producer finds a kick by ear and puts it on a pad.
 *
 * Read the flow in `docs/core-flows.md`. The numbered comments are its steps,
 * in its words. This is the acceptance contract for #449 (LIB-010, the library
 * redesign), and it is frozen once it lands: a later PR that changes an
 * assertion here has to say so in its body and justify it.
 *
 * **Revised for #817.** The library is the Library view on `4`, filling the
 * page, not a dialog over the editor. Insert keeps it open, showing the
 * inserted kick as the sound in the slot, and `3` goes back to the instrument
 * without inserting. Parked at `test.fixme` until #817's stack lands: the PR
 * that closes #817 removes the marker.
 *
 * **Locators.** Every library locator is assumed from #449 and the reference
 * design, and listed in `../support/library.ts`. Two more are this spec's own:
 *
 *  - "fills the page" is read as the view's box covering at least 0.7 of the
 *    viewport's width and height, as CF-008 read the old sequence modal;
 *  - "names the slot it will fill" is read as the pad's name, "BD", in the
 *    header. No kick in the library is called BD, so only the slot can put it
 *    there.
 *
 * **Fixture library.** The emulator suite serves the delivered library
 * `bun run library:build` writes, and the spec reads it back through
 * `deliveredLibrary()` rather than naming sounds. "Already showing kicks" is
 * read as the library's whole set of kick one-shots, unscoped ("All sounds"),
 * on Drums › Kick. Its kicks carry genre tags, so the precondition is met.
 *
 * Out of scope, per the flow: that auditions are audible, loops, similar
 * sounds (CF-025), packs (CF-024), shuffle and the category arrows.
 *
 * Runs against the Firestore/Auth emulator because step 8 is a real reload.
 */

/** The genre step 3 chooses, as the manifest spells it and as the menu labels it. */
const GENRE = { slug: "house", label: "House" } as const;

test.describe("CF-023", () => {
  // `test.fixme` until #817's stack lands: the PR that closes #817 removes this
  // marker in the same diff that makes the flow pass.
  test("a producer finds a kick by ear and puts it on a pad", async ({ page }) => {
    const step = walkthrough(page, {
      id: "CF-023",
      title: "A producer finds a kick by ear and puts it on a pad",
    });

    // 1. Create a new project. It opens on the arrangement, with the starter
    //    kick on a drum machine's "BD" pad.
    const projectUrl = await newProjectOnInstrumentView(page);
    const starterKick = await slotSound(page, "BD");
    expect(starterKick).not.toBe("");

    const sounds = await deliveredLibrary(page);
    const kicks = drumOneShots(sounds, "kick");
    const genreKicks = kicks.filter((kick) => kick.genres.includes(GENRE.slug));
    precondition(
      genreKicks.length > 1 && genreKicks.length < kicks.length,
      "CF-023",
      `kicks tagged "${GENRE.slug}", and kicks that are not`,
    );

    // 2. Go to the instrument view. The "BD" pad's sample slot shows the
    //    library's icon and its key, 4. Press the slot. The editor goes to the
    //    Library view, which fills the page. Its header names the slot it will
    //    fill as a path ending at the "BD" pad, shows the sound the pad has
    //    now, and it is already showing kicks.
    await openPadSlot(page, "BD");
    const viewport = page.viewportSize();
    const box = await library(page).boundingBox();
    if (!viewport || !box) throw new Error("the library has no box on screen");
    expect(box.width).toBeGreaterThanOrEqual(viewport.width * 0.7);
    expect(box.height).toBeGreaterThanOrEqual(viewport.height * 0.7);

    await expect(readout(page, "In the slot")).toContainText(starterKick);
    await expect(railButton(page, "All sounds")).toHaveAttribute("aria-current", /.+/);
    await expect(familyTab(page, "Drums")).toHaveAttribute("aria-selected", "true");
    await expect(categoryChip(page, "Kick")).toHaveAttribute("aria-pressed", "true");
    await expect
      .poll(async () => (await listedNames(soundList(page))).sort())
      .toEqual(kicks.map((kick) => kick.name).sort());
    await step("Press the BD pad's sample slot: the library opens on kicks");

    // 3. Choose a genre from the genre menu. The list narrows to kicks in that
    //    genre, and says how many there are.
    await library(page)
      .getByRole("button", { name: /^Any genre\b/ })
      .click();
    await library(page)
      .getByRole("checkbox", { name: new RegExp(`^${GENRE.label}\\b`) })
      .check();
    await expect
      .poll(async () => (await listedNames(soundList(page))).sort())
      .toEqual(genreKicks.map((kick) => kick.name).sort());
    expect(await resultCount(page)).toBe(genreKicks.length);
    await step("Choose a genre: the list narrows to its kicks, and counts them");

    // 4. Click a kick. It is selected, and the library says it is the one you
    //    are hearing.
    const names = await listedNames(soundList(page));
    const firstIndex = names.findIndex((name) => name !== starterKick);
    precondition(
      firstIndex >= 0 && firstIndex < names.length - 1,
      "CF-023",
      "two genre kicks after one that is not the starter kick",
    );
    const first = names[firstIndex];
    const next = names[firstIndex + 1];
    await audition(soundList(page), first).click();
    await expectSelected(page, first);
    await step("Click a kick: it is selected, and it is the one you are hearing");

    // 5. Press the down arrow. The next kick is selected and is the one you
    //    are hearing now.
    await page.keyboard.press("ArrowDown");
    await expectSelected(page, next);
    await step("Press the down arrow: the next kick is the one you are hearing");

    // 6. Press 3. The editor goes back to the instrument view, and the pad's
    //    sample slot still names the sound it had before. Nothing in the
    //    project changed while you listened.
    await backToInstrument(page);
    await expect.poll(() => slotSound(page, "BD")).toBe(starterKick);
    // Auditioning is an audio-only override: no command, so no history.
    await expect(emptyUndo(page)).toBeDisabled();
    await step("Press 3: the slot still names the sound it had before");

    // 7. Press the slot again, select a different kick, and press Insert. The
    //    editor goes back to the instrument view, and the slot names the kick
    //    you chose.
    await sampleSlot(page, "BD").click();
    await expectView(page, "Library");
    await expect(libraryHeader(page)).toContainText("BD");
    const chosen = (await listedNames(soundList(page))).find(
      (name) => name !== starterKick,
    );
    if (!chosen) throw new Error("the library lists no kick but the starter's");
    await audition(soundList(page), chosen).click();
    await expectSelected(page, chosen);
    await insertButton(page, chosen).click();
    await insertedBackToInstrument(page);
    await expect.poll(() => slotSound(page, "BD")).toBe(chosen);
    await step(
      "Select a different kick and press Insert: back on the instrument, the slot names it",
    );

    // 8. Reload the page. The "BD" pad still holds the kick you inserted.
    await reloadOnInstrumentView(page, projectUrl);
    await expect.poll(() => slotSound(page, "BD")).toBe(chosen);
    await step("Reload: the BD pad still holds the kick you inserted");
  });
});
