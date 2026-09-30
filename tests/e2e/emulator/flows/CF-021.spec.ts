import { expect, type Locator, type Page, test } from "@playwright/test";
import { walkthrough } from "../../support/walkthrough";
import {
  downloadedBytes,
  expectStereo24BitPcm,
  localDateInPage,
  parseWav,
  watchForProgressWithCancel,
} from "../support/exportedAudio";
import {
  buildExportSong,
  reloadAndExpectSongUnchanged,
  songSeconds,
} from "../support/exportSong";

/**
 * `CF-021`: a producer exports their song as a stereo WAV.
 *
 * Read the flow in `docs/core-flows.md`. The numbered comments are its steps,
 * in its words; steps 1 to 7 build the song and are shared word for word with
 * CF-022, so they live in `../support/exportSong.ts`. This is the acceptance
 * contract for #64 (the offline renderer) and #65 (stereo WAV export), and it
 * is frozen once it lands: a later PR that changes an assertion here has to
 * say so in its body and justify it.
 *
 * It is `test.fixme` because there is no export at all yet: no Export control
 * in the editor header, no dialog, no offline render and no WAV writer. The PR
 * that closes #65 removes this marker.
 *
 * What the export surface has to expose for a person, and this spec, to follow
 * the journey (CF-022 relies on the same names):
 *
 *  - an **"Export" button** in the editor header, opening a **dialog named
 *    "Export"**;
 *  - the format as **radio buttons "Stereo WAV" and "Stems (ZIP)"**, with
 *    Stereo WAV checked when the dialog opens;
 *  - an **"Export" button** inside the dialog that starts the render;
 *  - while it renders, a **progress bar** (role `progressbar`) beside a
 *    **"Cancel" button**;
 *  - when it is done, the dialog **says so** in words, and closes from its own
 *    close control.
 *
 * Runs against the Firestore/Auth emulator because step 10 is a real reload.
 */

/**
 * The most the file may run past the end of the last clip: the release tail.
 *
 * The flow promises "no more than the release tail" and deliberately leaves the
 * exact tail length to #64's reference renders. This bound is generous on
 * purpose. What it has to catch is an export that pads with minutes of
 * silence or renders the arrangement twice, not a tail a few hundred
 * milliseconds longer than some estimate. The longest thing ringing in this
 * song is the Piano's reverb at its default 2.5 s decay, behind a sample with
 * its own release, so 15 s is several times anything the song can legitimately
 * sound for.
 */
const MAX_RELEASE_TAIL_SECONDS = 15;

const exportDialog = (page: Page): Locator =>
  page.getByRole("dialog", { name: "Export" });

test.describe("CF-021", () => {
  test("a producer exports their song as a stereo WAV", async ({ page, browserName }) => {
    test.setTimeout(180_000);

    const step = walkthrough(page, {
      id: "CF-021",
      title: "A producer exports their song as a stereo WAV",
    });

    // Playback is asserted in Chromium only, the known, tracked gap CF-001 and
    // CF-007 carry (docs/testing.md, "Playback is asserted in Chromium only",
    // #43). The export is an offline render and needs no running context, so
    // it is asserted in every gating browser.
    const canAssertPlayback = browserName === "chromium";
    test.info().annotations.push({
      type: canAssertPlayback ? "playback-asserted" : "playback-skipped",
      description: canAssertPlayback
        ? `playback asserted in ${browserName}`
        : `playback not asserted in ${browserName}: AudioContext.resume() is refused here — see HARD-001`,
    });

    // 1-7. Build the five-track song, add its devices, play it and stop.
    const song = await buildExportSong(page, step, canAssertPlayback);

    // 8. Press Export in the editor header. A dialog opens with two choices,
    //    Stereo WAV and Stems (ZIP). Stereo WAV is chosen.
    await page.getByRole("button", { name: "Export", exact: true }).click();
    const dialog = exportDialog(page);
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("radio", { name: "Stereo WAV", exact: true }),
    ).toBeChecked();
    await expect(
      dialog.getByRole("radio", { name: "Stems (ZIP)", exact: true }),
    ).not.toBeChecked();
    await step("Press Export: Stereo WAV is chosen");

    // 9. Press Export. A progress bar with a Cancel button shows while it
    //    renders. When it finishes, the browser downloads one file named
    //    `<project name> <YYYY-MM-DD>.wav`, and the dialog says the export is
    //    done.
    const sawProgress = await watchForProgressWithCancel(page);
    const date = await localDateInPage(page);
    const downloads: string[] = [];
    page.on("download", (download) => downloads.push(download.suggestedFilename()));
    const downloading = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "Export", exact: true }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe(`${song.projectName} ${date}.wav`);
    await expect(dialog.getByText(/\b(done|complete|finished)\b/i)).toBeVisible();
    expect(await sawProgress()).toBe(true);
    // One file: nothing else arrived while the dialog finished.
    expect(downloads).toEqual([`${song.projectName} ${date}.wav`]);
    await step("Press Export: the WAV downloads and the dialog says it is done");

    // Outcome: the file is a valid stereo WAV (two channels, 24-bit PCM, the
    // project's sample rate), and it is not silent. It runs from bar 1 to the
    // end of the last clip at the song tempo, plus no more than the release
    // tail.
    //
    // "The project's sample rate" is not shown anywhere in the UI, so the
    // spec holds the file to a real rate rather than a guessed number; that
    // the rate is the project's is #65's unit layer. Likewise "nothing was
    // normalized" (DEC-004) is a level comparison against a reference render,
    // which is #64's, and is not asserted here.
    const wav = parseWav(await downloadedBytes(download));
    expectStereo24BitPcm(wav, download.suggestedFilename());
    expect(wav.hasSound, "the mix is not silent").toBe(true);
    const length = songSeconds(song);
    const oneFrame = 1 / wav.sampleRate;
    expect(wav.durationSeconds).toBeGreaterThanOrEqual(length - oneFrame);
    expect(wav.durationSeconds).toBeLessThanOrEqual(length + MAX_RELEASE_TAIL_SECONDS);

    // 10. Close the dialog and reload the page.
    await dialog
      .getByRole("button", { name: /^Close\b/ })
      .first()
      .click();
    await expect(dialog).toHaveCount(0);

    // Outcome, continued: after the reload the project is unchanged — five
    // tracks, same clips and notes, the reverb on Piano and the saturator and
    // compressor on the master — so exporting did not edit it.
    await reloadAndExpectSongUnchanged(page, song);
    await step("Reload: the project is unchanged");
  });
});
