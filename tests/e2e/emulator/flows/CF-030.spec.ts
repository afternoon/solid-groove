import { expect, type Locator, type Page, test } from "@playwright/test";
import { walkthrough } from "../../support/walkthrough";
import {
  audition,
  deliveredLibrary,
  drumMachine,
  drumOneShots,
  library,
  libraryHeader,
  listedNames,
  newProjectOnInstrumentView,
  precondition,
  readout,
  reloadOnInstrumentView,
  sampleSlot,
  selectPad,
  slotSound,
  soundList,
} from "../support/library";
import { dockTile, expectView, pressView } from "../support/views";

/**
 * `CF-030`: a producer tries several kicks on a pad without leaving the library.
 *
 * Read the flow in `docs/core-flows.md`. The numbered comments are its steps,
 * in its words. This is the acceptance contract for the Library target and the
 * insert keys of #817 (UI-002), and it is frozen once it lands: a later PR that
 * changes an assertion here has to say so in its body and justify it.
 *
 * It is `test.fixme` because none of it exists yet. The library is a modal
 * that closes on Insert, a slot opens it without remembering which slot was
 * touched, `Enter` is unbound, and the dock has no Library tile. The PR that
 * closes #817 removes this marker.
 *
 * **Locators.** The library's are `../support/library.ts`'s and the views'
 * are `../support/views.ts`'s, both assumed from #817 and listed there. Two
 * readings are this spec's own:
 *
 *  - "marked as the library's target" is the slot's `aria-current="true"`.
 *    What it looks like (a white edge, a white `4`) is not asserted;
 *  - "inserting into the BD track's drum machine, on the BD pad" is the
 *    header's path, "BD › Drum machine › BD": track, instrument, slot.
 *
 * **Keys and focus.** `Enter` is pressed with an audition button focused,
 * because clicking a row is how a sound is selected. The library context has
 * to own `Enter` there rather than let the browser click the focused button
 * again; that is what this spec holds it to.
 *
 * Runs against the Firestore/Auth emulator because step 9 is a real reload.
 */

/** Whether a slot is the one the library is aimed at. */
const expectTarget = async (slot: Locator, isTarget: boolean): Promise<void> => {
  if (isTarget) await expect(slot).toHaveAttribute("aria-current", "true");
  else await expect(slot).not.toHaveAttribute("aria-current", "true");
};

/** Select a sound in the list by clicking its row's audition button. */
const select = async (page: Page, name: string): Promise<void> => {
  await audition(soundList(page), name).click();
  await expect(readout(page, "Hearing")).toContainText(name);
};

test.describe("CF-030", () => {
  // biome-ignore format: unparked by removing only test.fixme, so the frozen body keeps its lines
  test(
    "a producer tries several kicks on a pad without leaving the library",
    async ({ page }) => {
      const step = walkthrough(page, {
        id: "CF-030",
        title: "A producer tries several kicks on a pad without leaving the library",
      });

      // 1. Create a new project and press 3. The instrument view shows the
      //    starter drum machine. Add a pad: it is called "Pad 2", it is the
      //    selected pad, and its empty sample slot is marked as the library's
      //    target.
      const projectUrl = await newProjectOnInstrumentView(page);
      const starterKick = await slotSound(page, "BD");
      expect(starterKick).not.toBe("");

      const kicks = drumOneShots(await deliveredLibrary(page), "kick").filter(
        (kick) => kick.name !== starterKick,
      );
      precondition(kicks.length >= 3, "CF-030", "three kicks besides the starter's");

      await page.getByRole("button", { name: "Add pad to BD" }).click();
      await expect(sampleSlot(page, "Pad 2")).toBeVisible();
      await expectTarget(sampleSlot(page, "Pad 2"), true);
      await step("Add a pad: its empty slot is the library's target");

      // 2. Press the "BD" pad to select it. Now the "BD" pad's sample slot is
      //    the one marked as the target, and "Pad 2"'s is not.
      await selectPad(page, "BD");
      await expectTarget(sampleSlot(page, "BD"), true);
      await expect(sampleSlot(page, "BD")).toContainText("4");
      // Only the selected pad's slot is on screen (#447), so "Pad 2's is not"
      // is read as exactly one marked slot in the drum machine: BD's.
      await expect(drumMachine(page).locator("[aria-current='true']")).toHaveCount(1);
      await step("Select the BD pad: its slot becomes the target");

      // 3. Point at the dock's fourth tile. Its tip says it will open the
      //    Library on sounds for the "BD" track.
      await dockTile(page, "Library").hover();
      await expect(page.getByRole("tooltip")).toContainText("4");
      await expect(page.getByRole("tooltip")).toContainText("Library");
      await expect(page.getByRole("tooltip")).toContainText("sounds for BD");
      await step("Point at the fourth tile: Library, sounds for BD");

      // 4. Press 4. The Library view fills the page. Its header says it is
      //    inserting into the "BD" track's drum machine, on the "BD" pad, names
      //    the kick the pad holds now, and lists one-shots, not loops.
      await pressView(page, "Library");
      await expect(libraryHeader(page)).toContainText("BD › Drum machine › BD");
      await expect(readout(page, "In the slot")).toContainText(starterKick);
      const listed = await listedNames(soundList(page));
      const loops = (await deliveredLibrary(page))
        .filter((sound) => sound.type !== "one-shot")
        .map((sound) => sound.name);
      expect(listed.filter((name) => loops.includes(name))).toEqual([]);
      await step("Press 4: the library, aimed at the BD pad");

      // 5. Select a different kick and press Enter. The library stays open and
      //    shows that kick as the sound in the slot. Press the down arrow to
      //    select the next kick and press Enter again. The library is still
      //    open, and shows the second kick in the slot.
      const shown = listed.filter((name) => kicks.some((kick) => kick.name === name));
      precondition(
        shown.length >= 3,
        "CF-030",
        "three listed kicks besides the starter's",
      );
      const index = listed.indexOf(shown[0]);
      const first = listed[index];
      const second = listed[index + 1];
      precondition(
        second !== undefined && second !== starterKick,
        "CF-030",
        "a kick listed after the first that is not the starter's",
      );

      await select(page, first);
      await page.keyboard.press("Enter");
      await expectView(page, "Library");
      await expect(readout(page, "In the slot")).toContainText(first);
      await step("Enter: the kick goes in, and the library stays");

      await page.keyboard.press("ArrowDown");
      await expect(readout(page, "Hearing")).toContainText(second);
      await page.keyboard.press("Enter");
      await expectView(page, "Library");
      await expect(readout(page, "In the slot")).toContainText(second);
      await step("Down, Enter: the next kick goes in, still in the library");

      // 6. Undo once. The library shows the first kick in the slot again.
      await page.keyboard.press("ControlOrMeta+z");
      await expect(readout(page, "In the slot")).toContainText(first);
      await step("Undo once: the first kick is back in the slot");

      // 7. Select a third kick and press Shift+Enter. The editor goes back to
      //    the instrument view, with the "BD" pad selected, its slot naming the
      //    third kick and still marked as the target.
      const third = shown.find((name) => name !== first && name !== second);
      precondition(third, "CF-030", "a third kick besides the starter's");
      await select(page, third);
      await page.keyboard.press("Shift+Enter");
      await expectView(page, "Instrument");
      await expect(library(page)).toHaveCount(0);
      await expect(
        drumMachine(page).getByRole("button", { name: "Audition BD", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await expect.poll(() => slotSound(page, "BD")).toBe(third);
      await expectTarget(sampleSlot(page, "BD"), true);
      await step("Shift+Enter: back on the BD pad with the third kick");

      // 8. Press 1, then 4. The library is still aimed at the "BD" pad. Press 3
      //    to go back without inserting. The slot still names the third kick.
      await pressView(page, "Arrangement");
      await pressView(page, "Library");
      await expect(libraryHeader(page)).toContainText("BD › Drum machine › BD");
      await expect(readout(page, "In the slot")).toContainText(third);
      await step("Press 1, then 4: still aimed at the BD pad");

      await pressView(page, "Instrument");
      await expect.poll(() => slotSound(page, "BD")).toBe(third);

      // 9. Reload the page. The "BD" pad holds the third kick, and "Pad 2" is
      //    still empty.
      await reloadOnInstrumentView(page, projectUrl);
      await expect.poll(() => slotSound(page, "BD")).toBe(third);
      await selectPad(page, "Pad 2");
      await expect(sampleSlot(page, "Pad 2")).toContainText("No sample loaded");
      await step("Reload: BD keeps the third kick, Pad 2 is still empty");
    },
  );
});
