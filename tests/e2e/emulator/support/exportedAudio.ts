import { readFileSync } from "node:fs";
import { type Download, expect, type Page } from "@playwright/test";
import { unzipSync } from "fflate";

/**
 * Reading what an export downloaded, for the export core flows (CF-021 stereo
 * WAV, CF-022 stems).
 *
 * A flow's outcome here is a *file*, and the only honest way to assert a file
 * is to open it. A download event with the right name proves nothing about
 * whether a DAW could read what arrived, so these helpers parse the bytes
 * themselves: the RIFF/WAVE header, the `fmt ` chunk, and the samples in the
 * `data` chunk. They parse only what the flows assert (layout, format, length
 * and "not silent") and deliberately nothing about the sound itself, which the
 * reference renders of #64 own.
 */

/** What a flow asserts about one WAV. */
export interface WavFacts {
  /** `fmt ` audio format tag: 1 is integer PCM. */
  readonly formatTag: number;
  readonly channels: number;
  readonly sampleRate: number;
  readonly bitsPerSample: number;
  /** Byte length of the `data` chunk. */
  readonly dataBytes: number;
  /** Sample frames in the `data` chunk (one sample per channel). */
  readonly frames: number;
  /** `frames / sampleRate`. */
  readonly durationSeconds: number;
  /** Whether any sample in the `data` chunk is not exactly zero. */
  readonly hasSound: boolean;
}

const ascii = (bytes: Uint8Array, at: number, length: number): string =>
  String.fromCharCode(...bytes.subarray(at, at + length));

/**
 * Parses a RIFF/WAVE file's header and scans its samples.
 *
 * Walks the chunk list rather than assuming the canonical 44-byte header, so a
 * writer that adds a `LIST` or `bext` chunk is still read correctly: a flow
 * should not fail on a legal file.
 */
export function parseWav(bytes: Uint8Array): WavFacts {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(ascii(bytes, 0, 4), "a WAV starts with a RIFF header").toBe("RIFF");
  expect(ascii(bytes, 8, 4), "a RIFF file of form WAVE").toBe("WAVE");

  let fmt: {
    formatTag: number;
    channels: number;
    sampleRate: number;
    bits: number;
  } | null = null;
  let data: { offset: number; length: number } | null = null;
  let at = 12;
  while (at + 8 <= bytes.byteLength) {
    const id = ascii(bytes, at, 4);
    const size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (id === "fmt ") {
      fmt = {
        formatTag: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bits: view.getUint16(body + 14, true),
      };
    } else if (id === "data") {
      data = { offset: body, length: Math.min(size, bytes.byteLength - body) };
    }
    // Chunks are word-aligned: an odd-sized chunk carries one pad byte.
    at = body + size + (size % 2);
  }
  if (!fmt) throw new Error("the WAV has no fmt chunk");
  if (!data) throw new Error("the WAV has no data chunk");

  const bytesPerSample = fmt.bits / 8;
  const frameBytes = bytesPerSample * fmt.channels;
  const frames = frameBytes > 0 ? Math.floor(data.length / frameBytes) : 0;

  // "Not silent" means a sample that is not exactly zero. Any integer PCM
  // width is zero only when every byte of it is, so this needs no decoding.
  let hasSound = false;
  for (let index = data.offset; index < data.offset + data.length; index += 1) {
    if (bytes[index] !== 0) {
      hasSound = true;
      break;
    }
  }

  return {
    formatTag: fmt.formatTag,
    channels: fmt.channels,
    sampleRate: fmt.sampleRate,
    bitsPerSample: fmt.bits,
    dataBytes: data.length,
    frames,
    durationSeconds: fmt.sampleRate > 0 ? frames / fmt.sampleRate : 0,
    hasSound,
  };
}

/**
 * Asserts the format both export flows promise for every WAV they produce:
 * stereo, 24-bit integer PCM, at a real sample rate.
 */
export function expectStereo24BitPcm(wav: WavFacts, label: string): void {
  expect(wav.formatTag, `${label}: PCM (format tag 1)`).toBe(1);
  expect(wav.channels, `${label}: stereo`).toBe(2);
  expect(wav.bitsPerSample, `${label}: 24-bit`).toBe(24);
  expect(wav.sampleRate, `${label}: a sample rate`).toBeGreaterThan(0);
  expect(wav.frames, `${label}: some frames`).toBeGreaterThan(0);
}

/** The bytes of a finished download. */
export async function downloadedBytes(download: Download): Promise<Uint8Array> {
  const path = await download.path();
  return new Uint8Array(readFileSync(path));
}

/** Every entry in a ZIP, by path, with its bytes. Directories are left out. */
export function unzipEntries(bytes: Uint8Array): Map<string, Uint8Array> {
  const entries = new Map<string, Uint8Array>();
  for (const [path, content] of Object.entries(unzipSync(bytes))) {
    if (!path.endsWith("/")) entries.set(path, content);
  }
  return entries;
}

/**
 * Today's date as `YYYY-MM-DD` in the *browser's* local time zone, which is
 * the date a producer reads on their own clock and so the one the download is
 * named with. Read in the page rather than in the runner, whose zone may differ.
 */
export function localDateInPage(page: Page): Promise<string> {
  return page.evaluate(() => {
    const now = new Date();
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  });
}

/**
 * Starts recording whether a progress bar and a Cancel button are ever on
 * screen together, and returns a function that reads the answer.
 *
 * The render of a one-bar song can finish faster than a `toBeVisible` poll, so
 * polling for the progress bar would pass or fail on the machine's speed rather
 * than on the product. A `MutationObserver` installed before Export is pressed
 * sees every state the page passes through, however briefly. The roles it
 * looks for are the accessible ones: `progressbar` (or a native `<progress>`,
 * whose implicit role it is) and a button named "Cancel".
 */
export async function watchForProgressWithCancel(
  page: Page,
): Promise<() => Promise<boolean>> {
  await page.evaluate(() => {
    const flag = window as unknown as { __exportProgressSeen?: boolean };
    flag.__exportProgressSeen = false;
    const check = () => {
      const progress = document.querySelector('[role="progressbar"], progress');
      const cancel = [...document.querySelectorAll("button")].some(
        (button) =>
          (button.getAttribute("aria-label") ?? button.textContent ?? "").trim() ===
          "Cancel",
      );
      if (progress && cancel) flag.__exportProgressSeen = true;
    };
    new MutationObserver(check).observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
    });
    check();
  });
  return () =>
    page.evaluate(
      () =>
        (window as unknown as { __exportProgressSeen?: boolean }).__exportProgressSeen ===
        true,
    );
}
