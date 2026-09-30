import { Zip, ZipPassThrough } from "fflate";
import { type WavBitDepth, wavHeader } from "../wav";
import type { StemKind } from "./stemPlan";

/**
 * Packages rendered stems as one ZIP (EXP-003).
 *
 * Every WAV in it is padded with digital silence to the longest render, so all
 * of them share one length as well as one sample rate, format and bar-1
 * origin: dropped into another DAW at bar 1 they line up sample for sample.
 * Padding appends zeros after the last sample and never touches a sample
 * already there (`DEC-004`).
 *
 * The archive is stored, not deflated. PCM audio barely compresses, and
 * storing keeps packaging a copy plus a CRC, so it stays cheap next to the
 * render however long the song. It is built as a list of chunks rather than
 * one buffer, so the caller can hand them to a `Blob` without a second copy.
 */

export interface EncodedStem {
  readonly kind: StemKind;
  readonly path: string;
  readonly name: string;
  readonly sourceId?: string;
  /** Interleaved integer PCM, as `encodePcm` writes it. */
  readonly pcm: Uint8Array;
  /** Frames in `pcm`, before padding. */
  readonly frames: number;
}

export interface StemArchiveFormat {
  readonly sampleRate: number;
  readonly bitDepth: WavBitDepth;
  readonly channels: number;
  readonly tempo: number;
  readonly timeSignature: Readonly<{ numerator: number; denominator: number }>;
}

export interface StemArchive {
  /** The ZIP's bytes, in order. */
  readonly parts: Uint8Array[];
  readonly byteLength: number;
  /** Every WAV's length after padding. */
  readonly frames: number;
}

export const MANIFEST_PATH = "manifest.json";

/** A ZIP without the ZIP64 extension, which is what every unzip tool reads,
 * holds at most 4 GiB. Past it the archive would be corrupt, not just large. */
export const MAX_ZIP_BYTES = 0xffff_ffff;

/** Padding is written from one shared block of zeros, never mutated, so a
 * long tail of silence costs no allocation per chunk. */
const ZEROS = new Uint8Array(1 << 20);

/** Every entry carries this timestamp, so the same stems make the same bytes. */
const ENTRY_TIME = new Date(1980, 0, 1);

/** A track a selection left out of the export, named in the manifest. */
export interface LeftOutTrack {
  readonly id: string;
  readonly name: string;
}

/** The manifest: what another tool needs to line the stems up, and nothing
 * about the person or where the audio came from. */
export function stemManifest(
  stems: readonly EncodedStem[],
  format: StemArchiveFormat,
  frames: number,
  leftOut: readonly LeftOutTrack[] = [],
): Record<string, unknown> {
  return {
    format: "groove-stems",
    version: 1,
    sampleRate: format.sampleRate,
    bitDepth: format.bitDepth,
    channels: format.channels,
    encoding: "pcm-integer",
    frames,
    durationSeconds: frames / format.sampleRate,
    origin: "bar 1 at frame 0",
    gain: "project gain preserved; no normalization, no dither",
    masterProcessing: "reference mix only",
    automation: "not rendered yet; each stem carries its static fader value",
    tempo: format.tempo,
    timeSignature: format.timeSignature,
    files: stems.map((stem) => ({
      path: stem.path,
      kind: stem.kind,
      name: stem.name,
      ...(stem.sourceId ? { id: stem.sourceId } : {}),
    })),
    excludedTracks: leftOut.map(({ id, name }) => ({ id, name })),
  };
}

/** The archive's size before building it: headers and the central directory
 * are small next to the audio, but counted, so the limit is exact. */
export function stemArchiveBytes(
  paths: readonly string[],
  wavBytes: number,
  manifestBytes: number,
): number {
  const encoder = new TextEncoder();
  let total = 22; // end of central directory
  const names = [...paths, MANIFEST_PATH].map((path) => encoder.encode(path).length);
  for (const name of names) total += 30 + 46 + 2 * name + 16;
  return total + paths.length * wavBytes + manifestBytes;
}

/** Builds the archive. Throws a `RangeError` if it would exceed {@link MAX_ZIP_BYTES}. */
export function buildStemArchive(
  stems: readonly EncodedStem[],
  format: StemArchiveFormat,
  leftOut: readonly LeftOutTrack[] = [],
): StemArchive {
  const frames = Math.max(0, ...stems.map((stem) => stem.frames));
  const blockAlign = format.channels * (format.bitDepth / 8);
  const manifest = new TextEncoder().encode(
    `${JSON.stringify(stemManifest(stems, format, frames, leftOut), null, 2)}\n`,
  );
  const wavBytes = 44 + frames * blockAlign;
  const expected = stemArchiveBytes(
    stems.map((stem) => stem.path),
    wavBytes,
    manifest.byteLength,
  );
  if (expected > MAX_ZIP_BYTES) {
    throw new RangeError("The stems are too large for one ZIP file");
  }

  const parts: Uint8Array[] = [];
  let byteLength = 0;
  let failure: Error | null = null;
  const zip = new Zip((error, chunk) => {
    if (error) failure = error;
    else if (chunk.byteLength > 0) {
      parts.push(chunk);
      byteLength += chunk.byteLength;
    }
  });
  const entry = (path: string) => {
    const file = new ZipPassThrough(path);
    file.mtime = ENTRY_TIME;
    zip.add(file);
    return file;
  };

  for (const stem of stems) {
    const file = entry(stem.path);
    file.push(wavHeader(format.channels, format.sampleRate, format.bitDepth, frames));
    file.push(stem.pcm);
    let padding = (frames - stem.frames) * blockAlign;
    while (padding > 0) {
      const size = Math.min(padding, ZEROS.byteLength);
      file.push(ZEROS.subarray(0, size));
      padding -= size;
    }
    file.push(new Uint8Array(0), true);
  }
  entry(MANIFEST_PATH).push(manifest, true);
  zip.end();
  if (failure) throw failure;
  return { parts, byteLength, frames };
}
