import { Zip, ZipPassThrough } from "fflate";
import { wav24ByteLength, wav24Header } from "../../audio/wavEncoder";

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
 *
 * It holds the WAVs and nothing else: every file's name says what it is.
 */

export interface EncodedStem {
  readonly path: string;
  /** Interleaved integer PCM, as `pcm24` writes it. */
  readonly pcm: Uint8Array;
  /** Frames in `pcm`, before padding. */
  readonly frames: number;
}

export interface StemArchiveFormat {
  readonly sampleRate: number;
  /** Stems are 24-bit, like the stereo export. */
  readonly bitDepth: 24;
  readonly channels: number;
}

export interface StemArchive {
  /** The ZIP's bytes, in order. */
  readonly parts: Uint8Array[];
  readonly byteLength: number;
  /** Every WAV's length after padding. */
  readonly frames: number;
}

/** A ZIP without the ZIP64 extension, which is what every unzip tool reads,
 * holds at most 4 GiB. Past it the archive would be corrupt, not just large. */
export const MAX_ZIP_BYTES = 0xffff_ffff;

/** Padding is written from one shared block of zeros, never mutated, so a
 * long tail of silence costs no allocation per chunk. */
const ZEROS = new Uint8Array(1 << 20);

/** Every entry carries this timestamp, so the same stems make the same bytes. */
const ENTRY_TIME = new Date(1980, 0, 1);

/** The archive's size before building it: headers and the central directory
 * are small next to the audio, but counted, so the limit is exact. */
export function stemArchiveBytes(paths: readonly string[], wavBytes: number): number {
  const encoder = new TextEncoder();
  let total = 22; // end of central directory
  for (const path of paths) total += 30 + 46 + 2 * encoder.encode(path).length + 16;
  return total + paths.length * wavBytes;
}

/** Builds the archive. Throws a `RangeError` if it would exceed {@link MAX_ZIP_BYTES}. */
export function buildStemArchive(
  stems: readonly EncodedStem[],
  format: StemArchiveFormat,
): StemArchive {
  const frames = Math.max(0, ...stems.map((stem) => stem.frames));
  const blockAlign = format.channels * (format.bitDepth / 8);
  const wavBytes = wav24ByteLength(format.channels, frames);
  const expected = stemArchiveBytes(
    stems.map((stem) => stem.path),
    wavBytes,
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
    file.push(wav24Header(format.channels, frames, format.sampleRate));
    file.push(stem.pcm);
    let padding = (frames - stem.frames) * blockAlign;
    while (padding > 0) {
      const size = Math.min(padding, ZEROS.byteLength);
      file.push(ZEROS.subarray(0, size));
      padding -= size;
    }
    file.push(new Uint8Array(0), true);
  }
  zip.end();
  if (failure) throw failure;
  return { parts, byteLength, frames };
}
