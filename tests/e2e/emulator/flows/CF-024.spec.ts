import { expect, type Page, test } from "@playwright/test";
import { walkthrough } from "../../support/walkthrough";
import {
  audition,
  categoryChip,
  deliveredLibrary,
  drumOneShots,
  expectSelected,
  familyTab,
  insertButton,
  library,
  listedNames,
  literal,
  newProjectOnInstrumentView,
  openPadSlot,
  precondition,
  projectPacks,
  railButton,
  reloadOnInstrumentView,
  sampleSlot,
  selectPad,
  soundList,
} from "../support/library";

/**
 * `CF-024`: a producer browses packs and uses a sound from one they did not
 * have.
 *
 * Read the flow in `docs/core-flows.md`. The numbered comments are its steps,
 * in its words. This is the acceptance contract for #449 (LIB-010, the library
 * redesign), and it is frozen once it lands: a later PR that changes an
 * assertion here has to say so in its body and justify it.
 *
 * It is `test.fixme` because none of the redesigned library exists yet: there
 * is no "Browse packs" in the library, no cover grid or "Packs with" filter,
 * no pack banner, and no family tabs or category chips. The PR that closes
 * #449 removes this marker.
 *
 * **Blocker in step 1: there is no "CP" pad to open.** A new project's starter
 * drum machine has one pad, "BD" (`src/editor/starterProject.ts`). Only a drum
 * machine *added* to a project gets the four-pad kit with "CP"
 * (`STARTER_KIT` in `src/instrument/instrumentKinds.ts`). The flow does not
 * add a track or a pad, so as written it cannot be walked, and #449 does not
 * change the starter project. This spec follows the flow literally and will
 * fail at step 1 until the product owner settles it: either the flow adds a
 * drum machine (as CF-022 does) or opens the "BD" pad, or the starter project
 * gains the kit. It is reported on #449.
 *
 * **Locators.** Every library locator is assumed from #449 and the reference
 * design, and listed in `../support/library.ts`. This spec adds its own for
 * the packs view:
 *
 *  - each pack cover is a button whose name starts "Open <pack name>", and a
 *    cover for a pack the project uses carries the words "In project" (or
 *    "In this project") in its text;
 *  - the "Packs with" filter is a group named "Packs with" holding a toggle
 *    button per family, named for it ("Drums");
 *  - the pack banner is headed by the pack's name and says "Joins the project
 *    when you insert a sound" (or "In this project").
 *
 * **Fixture library: open point.** The emulator suite serves the delivered
 * library `bun run library:build` writes, read back by `deliveredLibrary()`.
 * In that build every clap is in Core Electronic Drums, the starter kick's own
 * pack, so the precondition "a pack with claps that the starter project does
 * not use" is not met. The only other pack with claps is `alpha-drum-machines`
 * (#681), acquired over the network and not part of that build. Changing what
 * the suite serves is pipeline work, left open rather than done here; the
 * precondition check below fails by name until it is settled.
 *
 * Out of scope, per the flow: "Hear it", pack search, category-row scrolling,
 * removing a pack, and third-party or personal packs.
 *
 * Runs against the Firestore/Auth emulator because step 8 is a real reload.
 */

const cover = (page: Page, pack: string) =>
  library(page).getByRole("button", { name: new RegExp(`^Open ${literal(pack)}\\b`) });
const anyCover = (page: Page) => library(page).getByRole("button", { name: /^Open / });
const IN_PROJECT = /\bin (this )?project\b/i;

test.describe("CF-024", () => {
  // `test.fixme` until #449 lands and step 1's "CP" pad is settled (see the
  // header): the PR that closes #449 removes this marker in the same diff that
  // makes the flow pass.
  test.fixme(
    "a producer browses packs and uses a sound from one they did not have",
    async ({ page }) => {
      const step = walkthrough(page, {
        id: "CF-024",
        title: "A producer browses packs and uses a sound from one they did not have",
      });

      // 1. Create a new project and go to the instrument view. Open the sample
      //    slot of the drum machine's "CP" pad.
      const projectUrl = await newProjectOnInstrumentView(page);
      const starterKick = ((await sampleSlot(page, "BD").textContent()) ?? "").trim();

      const sounds = await deliveredLibrary(page);
      const projectPack = sounds.find((sound) => sound.name === starterKick)?.pack;
      if (!projectPack) throw new Error(`"${starterKick}" is not in the served library`);
      const drumPacks = [
        ...new Set(sounds.filter((s) => s.family === "drums").map((s) => s.pack)),
      ];
      const newPack = [
        ...new Set(drumOneShots(sounds, "clap").map((clap) => clap.pack)),
      ].find((pack) => pack !== projectPack);
      precondition(
        newPack,
        "CF-024",
        "a pack with claps the starter project does not use",
      );
      const newPackClaps = drumOneShots(sounds, "clap")
        .filter((clap) => clap.pack === newPack)
        .map((clap) => clap.name);

      await openPadSlot(page, "CP");
      await step('Open the sample slot of the drum machine\'s "CP" pad');

      // 2. Choose Browse packs. The sound list gives way to pack covers, and
      //    the packs this project already uses are marked as in the project.
      await railButton(page, "Browse packs").click();
      await expect(soundList(page)).toHaveCount(0);
      await expect(cover(page, projectPack)).toBeVisible();
      await expect(cover(page, projectPack)).toContainText(IN_PROJECT);
      await expect(cover(page, newPack)).not.toContainText(IN_PROJECT);
      await step("Choose Browse packs: covers, with the project's packs marked");

      // 3. Narrow the packs to those with drums.
      await library(page)
        .getByRole("group", { name: "Packs with" })
        .getByRole("button", { name: "Drums", exact: true })
        .click();
      await expect(anyCover(page)).toHaveCount(drumPacks.length);
      for (const pack of drumPacks) await expect(cover(page, pack)).toBeVisible();
      await step("Narrow the packs to those with drums");

      // 4. Open a pack that is not in the project. Its sounds replace the
      //    covers, under a banner that names the pack and says it joins the
      //    project when you insert one of its sounds.
      await cover(page, newPack).click();
      await expect(anyCover(page)).toHaveCount(0);
      await expect(soundList(page)).toBeVisible();
      await expect(library(page).getByRole("heading", { name: newPack })).toBeVisible();
      await expect(
        library(page).getByText("Joins the project when you insert a sound"),
      ).toBeVisible();
      await step("Open a pack not in the project: it joins when you insert a sound");

      // 5. Choose the Drums family, then the Clap category. Only that pack's
      //    claps are listed.
      await familyTab(page, "Drums").click();
      await categoryChip(page, "Clap").click();
      await expect
        .poll(async () => (await listedNames(soundList(page))).sort())
        .toEqual([...newPackClaps].sort());
      await step("Choose Drums, then Clap: only that pack's claps are listed");

      // 6. Select a clap and press Insert. The library closes, and the "CP"
      //    pad's slot names that clap.
      const clap = newPackClaps[0];
      await audition(soundList(page), clap).click();
      await expectSelected(page, clap);
      await insertButton(page, clap).click();
      await expect(library(page)).toHaveCount(0);
      await expect(sampleSlot(page, "CP")).toHaveText(clap);
      await step('Select a clap and press Insert: the "CP" slot names it');

      // 7. Open the slot again. That pack is now listed with the project's own
      //    packs.
      await sampleSlot(page, "CP").click();
      await expect(library(page)).toBeVisible();
      await expect(projectPacks(page)).toContainText(newPack);
      await expect(projectPacks(page)).toContainText(projectPack);
      await step("Open the slot again: the pack is listed with the project's packs");

      // 8. Reload the page. The "CP" pad still holds the clap, and the pack is
      //    still listed with the project's packs.
      await reloadOnInstrumentView(page, projectUrl);
      await selectPad(page, "CP");
      await expect(sampleSlot(page, "CP")).toHaveText(clap);
      await sampleSlot(page, "CP").click();
      await expect(projectPacks(page)).toContainText(newPack);
      await step("Reload: the CP pad holds the clap, and the pack is still listed");
    },
  );
});
