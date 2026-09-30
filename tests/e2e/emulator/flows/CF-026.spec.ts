import { expect, type Locator, type Page, test } from "@playwright/test";
import { walkthrough } from "../../support/walkthrough";
import {
  audition,
  expectSelected,
  goToInstrumentView,
  insertButton,
  library,
  listedNames,
  newProjectOnInstrumentView,
  openPadSlot,
  railButton,
  reloadOnInstrumentView,
  sampleSlot,
  soundList,
} from "../support/library";

/**
 * `CF-026`: a producer keeps a sound as a favourite and finds it in another
 * project.
 *
 * Read the flow in `docs/core-flows.md`. The numbered comments are its steps,
 * in its words. This is the acceptance contract for the favourites slice of
 * #449 (LIB-010, the library redesign), and it is frozen once it lands: a
 * later PR that changes an assertion here has to say so in its body and
 * justify it.
 *
 * It is `test.fixme` for two reasons. None of the redesigned library exists
 * yet (#449), and favourites need somewhere to live: per-user favourites in
 * Firestore are #691 (LIB-011), a persistence contract change that lands
 * before #449's favourites slice. Until #691 is in, this flow cannot be
 * walked. The PR that delivers #449's favourites slice removes this marker.
 *
 * **Locators.** Every library locator is assumed from #449 and the reference
 * design, and listed in `../support/library.ts`. This spec relies on two in
 * particular:
 *
 *  - the heart is a toggle button named "Favourite <name>", pressed when the
 *    sound is a favourite ("its heart fills");
 *  - the rail's "Favourites" button shows how many there are, so "Favourites
 *    counts one" is its text reading "Favourites" then 1.
 *
 * The way back to the dashboard is the editor header's "Projects" link, which
 * exists today (`src/editor/EditorHeader.tsx`).
 *
 * **Fixture library.** Any kick will do, so the delivered library the emulator
 * suite serves already meets this flow's preconditions.
 *
 * Out of scope, per the flow: favourites on another device or browser, a
 * guest's favourites after registering (both #691's, in the rules and
 * repository suites), and unfavouriting.
 *
 * Runs against the Firestore/Auth emulator because step 6 is a real reload.
 */

const heart = (page: Page, name: string): Locator =>
  library(page).getByRole("button", { name: `Favourite ${name}`, exact: true });

test.describe("CF-026", () => {
  // `test.fixme` until #691 and #449's favourites slice land: the PR that
  // delivers that slice removes this marker in the same diff that makes the
  // flow pass.
  test.fixme(
    "a producer keeps a sound as a favourite and finds it in another project",
    async ({ page }) => {
      const step = walkthrough(page, {
        id: "CF-026",
        title: "A producer keeps a sound as a favourite and finds it in another project",
      });

      // 1. Create a new project, go to the instrument view and open the "BD"
      //    pad's sample slot.
      const firstProject = await newProjectOnInstrumentView(page);
      const starterKick = ((await sampleSlot(page, "BD").textContent()) ?? "").trim();
      await openPadSlot(page, "BD");
      await step('Open the "BD" pad\'s sample slot');

      // 2. Mark a kick as a favourite. Its heart fills, and Favourites counts
      //    one.
      const kick = (await listedNames(soundList(page))).find(
        (name) => name !== starterKick,
      );
      if (!kick) throw new Error("the library lists no kick but the starter's");
      await expect(heart(page, kick)).toHaveAttribute("aria-pressed", "false");
      await heart(page, kick).click();
      await expect(heart(page, kick)).toHaveAttribute("aria-pressed", "true");
      await expect(railButton(page, "Favourites")).toHaveText(/^\s*Favourites\D*1\b/);
      await step(
        "Mark a kick as a favourite: its heart fills, and Favourites counts one",
      );

      // 3. Close the library without inserting anything.
      await library(page).getByRole("button", { name: "Close library" }).click();
      await expect(library(page)).toHaveCount(0);
      await expect(sampleSlot(page, "BD")).toHaveText(starterKick);
      await step("Close the library without inserting anything");

      // 4. Go back to the dashboard and create a second project. Open its "BD"
      //    pad's sample slot and choose Favourites. The kick you marked is
      //    listed.
      await page.getByRole("link", { name: "Projects" }).click();
      await expect(page).toHaveURL(/\/dashboard$/);
      await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
      await page.getByRole("button", { name: "New Project" }).click();
      await expect(page).toHaveURL(/\/projects\/prj_[^/]+$/);
      const secondProject = page.url();
      expect(secondProject).not.toBe(firstProject);
      await page.getByTestId("arrangement-view-ready").waitFor();
      await goToInstrumentView(page);
      await openPadSlot(page, "BD");
      await railButton(page, "Favourites").click();
      await expect.poll(() => listedNames(soundList(page))).toEqual([kick]);
      await step("In a second project, choose Favourites: the kick you marked is listed");

      // 5. Insert it. The slot names that kick.
      await audition(soundList(page), kick).click();
      await expectSelected(page, kick);
      await insertButton(page, kick).click();
      await expect(library(page)).toHaveCount(0);
      await expect(sampleSlot(page, "BD")).toHaveText(kick);
      await step("Insert it: the slot names that kick");

      // 6. Reload the page. Open the slot again and choose Favourites. The
      //    kick is still there, still marked.
      await reloadOnInstrumentView(page, secondProject);
      await expect(sampleSlot(page, "BD")).toHaveText(kick);
      await sampleSlot(page, "BD").click();
      await expect(library(page)).toBeVisible();
      await railButton(page, "Favourites").click();
      await expect.poll(() => listedNames(soundList(page))).toEqual([kick]);
      await expect(heart(page, kick)).toHaveAttribute("aria-pressed", "true");
      await step("Reload, open the slot and choose Favourites: the kick is still marked");
    },
  );
});
