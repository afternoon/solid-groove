import { expect, type Locator, type Page, test } from "@playwright/test";
import { walkthrough } from "../../support/walkthrough";
import {
  audition,
  categoryChip,
  deliveredLibrary,
  drumOneShots,
  expectSelected,
  insertButton,
  insertedBackToInstrument,
  library,
  listedNames,
  literal,
  newProjectOnInstrumentView,
  openPadSlot,
  precondition,
  reloadOnInstrumentView,
  similarList,
  slotSound,
  soundList,
} from "../support/library";

/**
 * `CF-025`: a producer follows similar sounds to a better kick.
 *
 * Read the flow in `docs/core-flows.md`. The numbered comments are its steps,
 * in its words. This is the acceptance contract for #449 (LIB-010, the library
 * redesign), and it is frozen once it lands: a later PR that changes an
 * assertion here has to say so in its body and justify it.
 *
 * **Revised for #817.** The library is the Library view on `4`, filling the
 * page, not a dialog over the editor. Insert keeps it open, showing the
 * inserted match as the sound in the slot, and `3` goes back to the
 * instrument. Parked at `test.fixme` until #817's stack lands: the PR that
 * closes #817 removes the marker.
 *
 * **Locators.** Every library locator is assumed from #449 and the reference
 * design, and listed in `../support/library.ts`. This spec adds its own for
 * the similar view:
 *
 *  - the kick you started from is named on a "Play <name>" button (the
 *    reference card), above a list named "Similar sounds";
 *  - each match's row shows its closeness as "<n>%";
 *  - the "Match on" chips are toggle buttons in a group named "Match on",
 *    named "Category", "Character", "Genre" and "Length", with Genre on when
 *    the view opens (step 3 turns it off);
 *  - the trail is a navigation named "Similar sounds trail", one button per
 *    kick visited;
 *  - the way back is a button whose name starts "Back" (the reference design
 *    labels it with the list you came from, e.g. "Back to Kicks").
 *
 * **Fixture library.** The emulator suite serves the delivered library
 * `bun run library:build` writes, read back by `deliveredLibrary()`. Its
 * kicks' tags overlap, so the precondition is met; the check below guards it.
 *
 * Out of scope, per the flow: how closeness is computed, whether matches
 * sound alike, and matches drawn from other packs (the similarity model's
 * unit tests cover that).
 *
 * Runs against the Firestore/Auth emulator because step 8 is a real reload.
 */

const reference = (page: Page, name: string): Locator =>
  library(page).getByRole("button", { name: new RegExp(`^Play ${literal(name)}$`) });
const trail = (page: Page): Locator =>
  library(page).getByRole("navigation", { name: "Similar sounds trail" });
const matchOn = (page: Page, name: string): Locator =>
  library(page)
    .getByRole("group", { name: "Match on" })
    .getByRole("button", { name, exact: true });
const soundsLike = (list: Locator, name: string): Locator =>
  list.getByRole("button", { name: `Sounds like ${name}`, exact: true });

/** The matches on screen, top to bottom, each with the closeness it shows. */
async function matches(page: Page): Promise<string[]> {
  const rows = similarList(page).getByRole("listitem");
  const names = await listedNames(similarList(page));
  const texts = await rows.allTextContents();
  return names.map((name, i) => `${name} ${texts[i]?.match(/\d{1,3}%/)?.[0] ?? "?"}`);
}

test.describe("CF-025", () => {
  // `test.fixme` until #817's stack lands: the PR that closes #817 removes this
  // marker in the same diff that makes the flow pass.
  test("a producer follows similar sounds to a better kick", async ({ page }) => {
    const step = walkthrough(page, {
      id: "CF-025",
      title: "A producer follows similar sounds to a better kick",
    });

    // 1. Create a new project, go to the instrument view and press the "BD"
    //    pad's sample slot. The Library view shows kicks.
    const projectUrl = await newProjectOnInstrumentView(page);
    const kicks = drumOneShots(await deliveredLibrary(page), "kick");
    precondition(
      kicks.length >= 3 &&
        kicks.some((a, i) =>
          kicks.slice(i + 1).some((b) => a.genres.some((g) => b.genres.includes(g))),
        ),
      "CF-025",
      "several kicks whose tags overlap",
    );

    await openPadSlot(page, "BD");
    await expect(categoryChip(page, "Kick")).toHaveAttribute("aria-pressed", "true");
    const startingList = await listedNames(soundList(page));
    expect(startingList.length).toBeGreaterThan(2);
    await step('Press the "BD" pad\'s sample slot: the library shows kicks');

    // 2. Press the similar-sounds button on a kick. The list gives way to that
    //    kick's closest matches. Each shows how close it is, and the kick you
    //    started from is named above them.
    const first = startingList[0];
    await soundsLike(soundList(page), first).click();
    await expect(soundList(page)).toHaveCount(0);
    await expect(reference(page, first)).toBeVisible();
    const firstMatches = await listedNames(similarList(page));
    expect(firstMatches.length).toBeGreaterThan(1);
    expect(firstMatches).not.toContain(first);
    for (const row of await similarList(page).getByRole("listitem").all()) {
      await expect(row).toContainText(/\b\d{1,3}%/);
    }
    await step("Press similar sounds on a kick: its closest matches");

    // 3. Turn off matching on genre. The matches update.
    const withGenre = await matches(page);
    await expect(matchOn(page, "Genre")).toHaveAttribute("aria-pressed", "true");
    await matchOn(page, "Genre").click();
    await expect(matchOn(page, "Genre")).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => matches(page)).not.toEqual(withGenre);
    const withoutGenre = await matches(page);
    await step("Turn off matching on genre: the matches update");

    // 4. Press the similar-sounds button on one of the matches. Its own
    //    matches replace the list, and a trail shows both kicks, in the order
    //    you visited them.
    const second = (await listedNames(similarList(page)))[0];
    await soundsLike(similarList(page), second).click();
    await expect(reference(page, second)).toBeVisible();
    await expect.poll(() => matches(page)).not.toEqual(withoutGenre);
    expect(await listedNames(similarList(page))).not.toContain(second);
    await expect(trail(page).getByRole("button")).toHaveText([first, second]);
    await step("Press similar sounds on a match: a trail shows both kicks, in order");

    // 5. Choose the first kick in the trail. Its matches come back.
    await trail(page).getByRole("button", { name: first, exact: true }).click();
    await expect(reference(page, first)).toBeVisible();
    await expect.poll(() => matches(page)).toEqual(withoutGenre);
    await step("Choose the first kick in the trail: its matches come back");

    // 6. Go back. The list of kicks you started from returns.
    await library(page)
      .getByRole("button", { name: /^Back\b/ })
      .click();
    await expect(similarList(page)).toHaveCount(0);
    await expect.poll(() => listedNames(soundList(page))).toEqual(startingList);
    await step("Go back: the list of kicks you started from returns");

    // 7. Open similar sounds again from any kick, select one of its matches
    //    and press Insert. The editor goes back to the instrument view, and
    //    the slot names that match.
    const again = startingList[1];
    await soundsLike(soundList(page), again).click();
    await expect(reference(page, again)).toBeVisible();
    const chosen = (await listedNames(similarList(page)))[0];
    await audition(similarList(page), chosen).click();
    await expectSelected(page, chosen);
    await insertButton(page, chosen).click();
    await insertedBackToInstrument(page);
    await expect.poll(() => slotSound(page, "BD")).toBe(chosen);
    await step(
      "Select a match and press Insert: back on the instrument, the slot names it",
    );

    // 8. Reload the page. The pad still holds it.
    await reloadOnInstrumentView(page, projectUrl);
    await expect.poll(() => slotSound(page, "BD")).toBe(chosen);
    await step("Reload: the pad still holds it");
  });
});
