import { expect, type Locator, type Page, test } from "@playwright/test";
import { walkthrough } from "../../support/walkthrough";
import {
  downloadedBytes,
  expectStereo24BitPcm,
  localDateInPage,
  parseWav,
  unzipEntries,
  type WavFacts,
} from "../support/exportedAudio";
import { buildExportSong, reloadAndExpectSongUnchanged } from "../support/exportSong";

/**
 * `CF-022`: a producer exports aligned stems for another DAW.
 *
 * Read the flow in `docs/core-flows.md`. The numbered comments are its steps,
 * in its words; steps 1 to 7 build the song and are shared word for word with
 * CF-021, so they live in `../support/exportSong.ts`. This is the acceptance
 * contract for #66 (stem export), and it is frozen once it lands: a later PR
 * that changes an assertion here has to say so in its body and justify it.
 *
 * It is `test.fixme` because there is no export at all yet. The PR that closes
 * #66 removes this marker. The export surface it drives is the one CF-021
 * names (an "Export" button, a dialog named "Export", the "Stems (ZIP)" radio),
 * plus the bit depth as **radio buttons "16-bit" and "24-bit"**, which appear
 * once Stems is chosen, with 24-bit checked.
 *
 * Runs against the Firestore/Auth emulator because step 10 is a real reload.
 */

const exportDialog = (page: Page): Locator =>
  page.getByRole("dialog", { name: "Export" });

test.describe("CF-022", () => {
  // biome-ignore format: unparked by removing only test.fixme, so the frozen body keeps its lines
  test(
    "a producer exports aligned stems for another DAW",
    async ({ page, browserName }) => {
      test.setTimeout(180_000);

      const step = walkthrough(page, {
        id: "CF-022",
        title: "A producer exports aligned stems for another DAW",
      });

      // Playback is asserted in Chromium only (see CF-021). The export itself is
      // an offline render and is asserted in every gating browser.
      const canAssertPlayback = browserName === "chromium";
      test.info().annotations.push({
        type: canAssertPlayback ? "playback-asserted" : "playback-skipped",
        description: canAssertPlayback
          ? `playback asserted in ${browserName}`
          : `playback not asserted in ${browserName}: AudioContext.resume() is refused here — see HARD-001`,
      });

      // 1-7. Build the five-track song, add its devices, play it and stop.
      const song = await buildExportSong(page, step, canAssertPlayback);

      // 8. Press Export in the editor header and choose Stems (ZIP). A bit-depth
      //    choice appears, 16-bit or 24-bit, with 24-bit chosen.
      await page.getByRole("button", { name: "Export", exact: true }).click();
      const dialog = exportDialog(page);
      await expect(dialog).toBeVisible();
      await dialog.getByRole("radio", { name: "Stems (ZIP)", exact: true }).check();
      await expect(
        dialog.getByRole("radio", { name: "Stems (ZIP)", exact: true }),
      ).toBeChecked();
      await expect(
        dialog.getByRole("radio", { name: "24-bit", exact: true }),
      ).toBeChecked();
      await expect(
        dialog.getByRole("radio", { name: "16-bit", exact: true }),
      ).not.toBeChecked();
      await step("Choose Stems (ZIP): 24-bit is chosen");

      // 9. Press Export and let it finish. The browser downloads one file named
      //    `<project name> <YYYY-MM-DD> stems.zip`.
      const date = await localDateInPage(page);
      const expectedName = `${song.projectName} ${date} stems.zip`;
      const downloads: string[] = [];
      page.on("download", (download) => downloads.push(download.suggestedFilename()));
      const downloading = page.waitForEvent("download");
      await dialog.getByRole("button", { name: "Export", exact: true }).click();
      const download = await downloading;
      expect(download.suggestedFilename()).toBe(expectedName);
      await expect(dialog.getByText(/\b(done|complete|finished)\b/i)).toBeVisible();
      expect(downloads).toEqual([expectedName]);
      await step("Press Export: the stems download as one ZIP");

      // Outcome: the ZIP holds five WAVs, one per track, named with its position
      // and track name so they sort in track order, each with sound in it, plus
      // `Reference mix.wav` and `manifest.json`. Every WAV is stereo, 24-bit
      // PCM, at the same sample rate, and exactly the same length.
      //
      // `Returns/` is out of scope (no UI adds a return yet), so the listing is
      // exact: anything else in the archive is a finding.
      const entries = unzipEntries(await downloadedBytes(download));
      const stems = [
        "01 BD.wav",
        "02 Drums.wav",
        "03 Bass.wav",
        `04 ${song.loopTrack}.wav`,
        "05 Piano.wav",
      ];
      expect([...entries.keys()].sort()).toEqual(
        [...stems, "Reference mix.wav", "manifest.json"].sort(),
      );
      // Sorting the stems by name puts them in track order.
      expect([...stems].sort()).toEqual(stems);

      const wavs = new Map<string, WavFacts>();
      for (const name of [...stems, "Reference mix.wav"]) {
        const bytes = entries.get(name);
        if (!bytes) throw new Error(`${name} is missing from the ZIP`);
        const wav = parseWav(bytes);
        expectStereo24BitPcm(wav, name);
        wavs.set(name, wav);
      }
      for (const name of stems) {
        expect(wavs.get(name)?.hasSound, `${name} has sound in it`).toBe(true);
      }
      const reference = wavs.get("Reference mix.wav") as WavFacts;
      for (const [name, wav] of wavs) {
        expect(wav.sampleRate, `${name}: the same sample rate`).toBe(
          reference.sampleRate,
        );
        expect(wav.dataBytes, `${name}: exactly the same length`).toBe(
          reference.dataBytes,
        );
      }
      // The manifest's fields are out of scope; that it is a JSON document is not.
      const manifest = entries.get("manifest.json") as Uint8Array;
      expect(() => JSON.parse(new TextDecoder().decode(manifest))).not.toThrow();

      // 10. Close the dialog and reload the page.
      await dialog
        .getByRole("button", { name: /^Close\b/ })
        .first()
        .click();
      await expect(dialog).toHaveCount(0);

      // Outcome, continued: after the reload the project is unchanged, devices
      // included.
      await reloadAndExpectSongUnchanged(page, song);
      await step("Reload: the project is unchanged");
    },
  );
});
