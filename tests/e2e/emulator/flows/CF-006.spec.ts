import { expect, type Locator, type Page, test } from "@playwright/test";
import { walkthrough } from "../../support/walkthrough";

/**
 * `CF-006` — a producer brings their own sounds into a pack.
 *
 * Read the flow in `docs/core-flows.md`; the numbered comments below are its
 * steps, in its words. This is the acceptance contract for `LIB-09` (#282) and
 * is frozen once it lands: a later PR that changes an assertion here has to say
 * so in its body and justify it.
 *
 * `test.fixme` because personal packs do not exist at all yet — #282 is the PR
 * that removes this marker. What is missing today:
 *
 *  - **User packs.** Every pack in `src/library` is factory content fetched
 *    from the delivered manifests (`libraryClient.ts`); there is no "Add pack",
 *    no `kind: "user"` pack, and nothing that writes one.
 *  - **Importing by drop.** `assetDrag.ts` carries a *library* sound out of the
 *    browser; nothing accepts operating-system files coming the other way, and
 *    nothing uploads audio to Cloud Storage under the owning user.
 *  - **The storage emulator.** This suite is started by
 *    `firebase emulators:exec --only firestore,auth` (`package.json`), so the
 *    uploads step 5 makes have nothing to talk to. #282 adds `storage` to that
 *    list — `firebase.json` already configures the emulator on port 9199 —
 *    along with the `storage.rules` the import writes under.
 *
 * Runs against the emulator rather than the mock backend for two reasons at
 * once: step 1 signs in for real, and step 7 is a real `page.reload()`.
 *
 * Two things about how this flow is driven, neither of which is an assertion
 * about our product:
 *
 *  - **Signing in drives the Auth emulator's own account-chooser popup**, which
 *    is Firebase's UI, not ours. The selectors in {@link signIn} describe *it*.
 *    Adjusting them to match the emulator is not a change to this flow's
 *    assertions.
 *  - **The files are synthesised and dropped through a `DataTransfer`.** No
 *    browser automation can drag a file off a real desktop, so
 *    {@link dropAudioFiles} builds real, decodable WAV files in the page and
 *    dispatches the drag sequence with them. That is the same `drop` event the
 *    operating system would deliver.
 */

/** The pack the producer makes. Typed by hand in step 4, so it is short. */
const PACK_NAME = "Field Recordings";

/** The three files dropped in step 5, named as they would be on a desktop. */
const FILE_NAMES = ["room-tone.wav", "tape-kick.wav", "door-slam.wav"] as const;

/** The library panel (`LibraryBrowser`'s `<section aria-label="Library">`). */
const library = (page: Page): Locator => page.getByRole("region", { name: "Library" });

/** The tree node for the producer's own pack, with everything inside it. */
const personalPack = (page: Page): Locator =>
  library(page)
    .getByRole("listitem")
    .filter({ has: page.getByRole("button", { name: new RegExp(PACK_NAME) }) })
    .first();

/** The sounds in a pack node, by the audition control every row carries. */
const sounds = (within: Locator): Locator =>
  within.getByRole("button", { name: /^Audition / });

/** The sound whose name came from `fileName`, by that audition control. */
const soundFrom = (within: Locator, fileName: string): Locator => {
  const stem = fileName.replace(/\.[^.]+$/, "");
  return within.getByRole("button", {
    name: new RegExp(`^Audition .*${stem.replace(/-/g, "[ -]?")}`, "i"),
  });
};

/**
 * Signs in with Google through the Auth emulator's account-chooser popup.
 *
 * A fresh account per run and per browser: two gating browsers share one
 * emulator, and the flow's precondition is an account whose personal library is
 * empty — an account reused across runs would arrive with the last run's pack
 * already in it.
 */
async function signIn(page: Page, browserName: string): Promise<void> {
  const popupOpened = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Log in" }).click();
  const popup = await popupOpened;
  await popup.getByRole("button", { name: /add new account/i }).click();
  await popup
    .getByRole("textbox", { name: /email/i })
    .fill(`cf-006-${browserName}-${Date.now()}@example.test`);
  await popup.getByRole("textbox", { name: /display name/i }).fill("Flow Producer");
  await popup.getByRole("button", { name: /sign in with google/i }).click();
  await popup.waitForEvent("close");
}

/**
 * Drops files on a target the way the operating system would.
 *
 * The WAV is real audio rather than empty bytes on purpose: the import detects
 * duration (and where it can, sample rate) from the file, and a zero-length
 * blob would exercise the rejection path instead of the one this flow walks.
 */
async function dropAudioFiles(
  page: Page,
  target: Locator,
  fileNames: readonly string[],
): Promise<void> {
  const dataTransfer = await page.evaluateHandle((names: readonly string[]) => {
    const sampleRate = 44_100;
    const frames = sampleRate / 10;
    const bytes = new ArrayBuffer(44 + frames * 2);
    const view = new DataView(bytes);
    const ascii = (offset: number, text: string) => {
      for (let index = 0; index < text.length; index += 1) {
        view.setUint8(offset + index, text.charCodeAt(index));
      }
    };
    ascii(0, "RIFF");
    view.setUint32(4, 36 + frames * 2, true);
    ascii(8, "WAVE");
    ascii(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    ascii(36, "data");
    view.setUint32(40, frames * 2, true);
    for (let frame = 0; frame < frames; frame += 1) {
      const value = Math.sin((frame / sampleRate) * 440 * 2 * Math.PI) * 8_000;
      view.setInt16(44 + frame * 2, Math.round(value), true);
    }

    const transfer = new DataTransfer();
    for (const name of names) {
      transfer.items.add(new File([bytes], name, { type: "audio/wav" }));
    }
    return transfer;
  }, fileNames);

  await target.dispatchEvent("dragenter", { dataTransfer });
  await target.dispatchEvent("dragover", { dataTransfer });
  await target.dispatchEvent("drop", { dataTransfer });
}

test.describe("CF-006", () => {
  // `test.fixme` until #282 (LIB-09) lands: that PR removes this marker in the
  // same diff that makes the flow pass.
  test.fixme(
    "a producer brings their own sounds into a pack",
    async ({ page, browserName }) => {
      // Three uploads and a sign-in round trip: more than the default per-test
      // timeout allows for, even against a local emulator.
      test.setTimeout(120_000);

      const step = walkthrough(page, {
        id: "CF-006",
        title: "A producer brings their own sounds into a pack",
      });

      // 1. Open the landing page and sign in.
      await page.goto("/");
      await expect(
        page.getByRole("heading", { level: 1, name: /Bring a loop/ }),
      ).toBeVisible();
      await step("Open the landing page");

      await signIn(page, browserName);
      await expect(page).toHaveURL(/\/dashboard$/);
      await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
      await step("Sign in");

      // 2. Open a project, so the library browser is on screen.
      await page.getByRole("button", { name: "New Project" }).click();
      await expect(page).toHaveURL(/\/projects\/prj_/);
      const projectUrl = page.url();
      await expect(library(page)).toBeVisible();
      await step("Open a project — the library browser is on screen");

      // 3. Choose "Add pack". A new pack appears in the browser with its name
      //    in an input, waiting to be typed.
      await library(page).getByRole("button", { name: "Add pack" }).click();
      const nameInput = library(page).getByRole("textbox", { name: "Pack name" });
      await expect(nameInput).toBeFocused();
      await step("Choose Add pack — the new pack's name is waiting to be typed");

      // 4. Type a name for the pack and press Return. The pack is now listed,
      //    and empty.
      await nameInput.fill(PACK_NAME);
      await nameInput.press("Enter");
      await expect(nameInput).toBeHidden();
      await expect(personalPack(page)).toBeVisible();
      // Opening the pack is what shows what is in it; a pack the producer just
      // made has nothing.
      await personalPack(page)
        .getByRole("button", { name: new RegExp(PACK_NAME) })
        .click();
      await expect(sounds(personalPack(page))).toHaveCount(0);
      await step("Name the pack — it is listed, and empty");

      // 5. Drag three audio files from the desktop onto that pack. Each shows
      //    its own progress, and each lands as a sound in the pack when it
      //    finishes.
      //
      // "Each shows its own progress" is asserted as one row per dropped file,
      // each of which becomes an auditionable sound of its own. A test cannot
      // reliably catch a progress bar mid-flight against a local emulator — it
      // may already have finished — but it can prove the import is per file
      // rather than one opaque batch, which is what the step is about. The
      // progress indicator itself is asserted at the component layer.
      await dropAudioFiles(page, personalPack(page), FILE_NAMES);
      for (const fileName of FILE_NAMES) {
        await expect(soundFrom(personalPack(page), fileName)).toBeVisible({
          timeout: 30_000,
        });
      }
      await expect(sounds(personalPack(page))).toHaveCount(FILE_NAMES.length);
      await step("Drop three files on the pack — each lands as a sound");

      // 6. Audition one of them from the browser, and find it by searching the
      //    library the same way you would find a factory sound.
      //
      // Auditioning is asserted in Chromium only: in Firefox here a fresh
      // `AudioContext` constructs but `resume()` never settles, so no preview
      // can start. The same known, tracked gap CF-001 and
      // `tests/e2e/emulator/slice.spec.ts` carry — see docs/testing.md,
      // "Playback is asserted in Chromium only", and issue #43. The search
      // half of this step runs in both gating browsers.
      const canAssertAudition = browserName === "chromium";
      test.info().annotations.push({
        type: canAssertAudition ? "playback-asserted" : "playback-skipped",
        description: canAssertAudition
          ? `audition asserted in ${browserName}`
          : `audition not asserted in ${browserName}: AudioContext.resume() is refused here — see HARD-001`,
      });
      if (canAssertAudition) {
        const audition = soundFrom(personalPack(page), FILE_NAMES[0]);
        await audition.click();
        await expect(audition).toHaveAttribute("aria-pressed", "true");
        await step("Audition one of the imported sounds");
      }

      // The same search box a producer finds a factory sound with.
      const stem = FILE_NAMES[1].replace(/\.[^.]+$/, "").split("-")[0];
      await library(page).getByRole("searchbox", { name: "Search sounds" }).fill(stem);
      await expect(soundFrom(library(page), FILE_NAMES[1])).toBeVisible();
      await step("Find it by searching the library");

      // 7. Reload the page. The pack and all three sounds are still there.
      await page.reload();
      await expect(page).toHaveURL(projectUrl);
      await expect(personalPack(page)).toBeVisible();
      await personalPack(page)
        .getByRole("button", { name: new RegExp(PACK_NAME) })
        .click();
      await expect(sounds(personalPack(page))).toHaveCount(FILE_NAMES.length);
      await step("Reload — the pack and all three sounds are still there");
    },
  );
});
