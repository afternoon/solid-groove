import { expect, test } from "@playwright/test";
import { walkthrough } from "../../support/walkthrough";
import {
  audition,
  categoryChip,
  deliveredLibrary,
  drumOneShots,
  emptyUndo,
  expectSelected,
  familyTab,
  insertButton,
  library,
  listedNames,
  newProjectOnInstrumentView,
  openPadSlot,
  precondition,
  railButton,
  readout,
  reloadOnInstrumentView,
  resultCount,
  sampleSlot,
  soundList,
} from "../support/library";

/**
 * `CF-023`: a producer finds a kick by ear and puts it on a pad.
 *
 * Read the flow in `docs/core-flows.md`. The numbered comments are its steps,
 * in its words. This is the acceptance contract for #449 (LIB-010, the library
 * redesign), and it is frozen once it lands: a later PR that changes an
 * assertion here has to say so in its body and justify it.
 *
 * It is `test.fixme` because none of the redesigned library exists yet. Today
 * the pad's slot opens the old tree browser, rows insert from a per-row
 * button, and nothing selects, auditions through the slot or reads out what
 * you are hearing. The PR that closes #449 removes this marker.
 *
 * **Locators.** Every library locator is assumed from #449 and the reference
 * design, and listed in `../support/library.ts`. Two more are this spec's own:
 *
 *  - "no larger than the pack browser used to be" is read as the dialog's box
 *    fitting inside the box the old pack browser filled: the `jumbo` dialog,
 *    the viewport less `min(100px, 12vw)` and `min(100px, 12vh)` a side
 *    (`src/components/Dialog.css`, `--dialog-jumbo-gap`);
 *  - "names the slot it will fill" is read as the pad's name, "BD", appearing
 *    in the dialog. No kick in the library is called BD, so only the slot
 *    header can put it there.
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
  // `test.fixme` until #449 lands: the PR that closes it removes this marker
  // in the same diff that makes the flow pass.
  test.fixme("a producer finds a kick by ear and puts it on a pad", async ({ page }) => {
    const step = walkthrough(page, {
      id: "CF-023",
      title: "A producer finds a kick by ear and puts it on a pad",
    });

    // 1. Create a new project. It opens on the arrangement, with the starter
    //    kick on a drum machine's "BD" pad.
    const projectUrl = await newProjectOnInstrumentView(page);
    const starterKick = ((await sampleSlot(page, "BD").textContent()) ?? "").trim();
    expect(starterKick).not.toBe("");

    const sounds = await deliveredLibrary(page);
    const kicks = drumOneShots(sounds, "kick");
    const genreKicks = kicks.filter((kick) => kick.genres.includes(GENRE.slug));
    precondition(
      genreKicks.length > 1 && genreKicks.length < kicks.length,
      "CF-023",
      `kicks tagged "${GENRE.slug}", and kicks that are not`,
    );

    // 2. Go to the instrument view and press the "BD" pad's sample slot. The
    //    library opens over the editor, no larger than the pack browser used
    //    to be. It names the slot it will fill, shows the sound the pad has
    //    now, and is already showing kicks.
    await openPadSlot(page, "BD");
    const viewport = page.viewportSize();
    const box = await library(page).boundingBox();
    if (!viewport || !box) throw new Error("the library has no box on screen");
    const gapX = Math.min(100, viewport.width * 0.12);
    const gapY = Math.min(100, viewport.height * 0.12);
    expect(box.width).toBeLessThanOrEqual(viewport.width - 2 * gapX + 1);
    expect(box.height).toBeLessThanOrEqual(viewport.height - 2 * gapY + 1);

    await expect(
      library(page)
        .getByText(/\bBD\b/)
        .first(),
    ).toBeVisible();
    await expect(readout(page, "Was")).toContainText(starterKick);
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

    // 6. Press Escape. The library closes, and the pad's sample slot still
    //    names the sound it had before. Nothing in the project changed while
    //    you listened.
    await page.keyboard.press("Escape");
    await expect(library(page)).toHaveCount(0);
    await expect(sampleSlot(page, "BD")).toHaveText(starterKick);
    // Auditioning is an audio-only override: no command, so no history.
    await expect(emptyUndo(page)).toBeDisabled();
    await step("Press Escape: the slot still names the sound it had before");

    // 7. Open the slot again, select a different kick, and press Insert. The
    //    library closes, and the slot names the kick you chose.
    await sampleSlot(page, "BD").click();
    await expect(library(page)).toBeVisible();
    const chosen = (await listedNames(soundList(page))).find(
      (name) => name !== starterKick,
    );
    if (!chosen) throw new Error("the library lists no kick but the starter's");
    await audition(soundList(page), chosen).click();
    await expectSelected(page, chosen);
    await insertButton(page, chosen).click();
    await expect(library(page)).toHaveCount(0);
    await expect(sampleSlot(page, "BD")).toHaveText(chosen);
    await step("Select a different kick and press Insert: the slot names it");

    // 8. Reload the page. The "BD" pad still holds the kick you inserted.
    await reloadOnInstrumentView(page, projectUrl);
    await expect(sampleSlot(page, "BD")).toHaveText(chosen);
    await step("Reload: the BD pad still holds the kick you inserted");
  });
});
