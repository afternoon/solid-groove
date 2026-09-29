import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { pcm24, WAV_HEADER_BYTES } from "../../audio/wavEncoder";
import {
  buildStemArchive,
  type EncodedStem,
  MAX_ZIP_BYTES,
  type StemArchiveFormat,
  stemArchiveBytes,
} from "./stemArchive";

const FORMAT: StemArchiveFormat = {
  sampleRate: 48_000,
  bitDepth: 24,
  channels: 2,
};

function stem(path: string, samples: number[]) {
  const channel = Float32Array.from(samples);
  return {
    path,
    pcm: pcm24([channel, channel]),
    frames: samples.length,
  } satisfies EncodedStem;
}

function unzip(parts: readonly Uint8Array[]) {
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let at = 0;
  for (const part of parts) {
    bytes.set(part, at);
    at += part.byteLength;
  }
  return { bytes, entries: unzipSync(bytes) };
}

const dataSize = (wav: Uint8Array) =>
  new DataView(wav.buffer, wav.byteOffset).getUint32(40, true);

describe("buildStemArchive", () => {
  const stems = [
    stem("01 Kick.wav", [0.5, 0.25]),
    stem("02 Pad.wav", [0.1, 0.2, 0.3, 0.4, 0.5]),
    stem("Returns/01 Verb.wav", []),
    stem("Reference mix.wav", [0.9, 0.8, 0.7]),
  ];
  const archive = buildStemArchive(stems, FORMAT);
  const { bytes, entries } = unzip(archive.parts);

  it("holds every stem, in order, and nothing else", () => {
    expect(Object.keys(entries)).toEqual(stems.map((s) => s.path));
    expect(archive.byteLength).toBe(bytes.byteLength);
  });

  it("pads every WAV with trailing silence to the longest render", () => {
    expect(archive.frames).toBe(5);
    for (const { path, pcm } of stems) {
      const wav = entries[path];
      expect(dataSize(wav), path).toBe(5 * 6);
      expect(wav.byteLength, path).toBe(WAV_HEADER_BYTES + 5 * 6);
      // The rendered samples are untouched; only zeros follow them.
      expect(wav.subarray(WAV_HEADER_BYTES, WAV_HEADER_BYTES + pcm.byteLength)).toEqual(
        pcm,
      );
      expect(wav.subarray(WAV_HEADER_BYTES + pcm.byteLength).every((b) => b === 0)).toBe(
        true,
      );
    }
  });

  it("is byte-for-byte deterministic", () => {
    expect(unzip(buildStemArchive(stems, FORMAT).parts).bytes).toEqual(bytes);
  });

  it("predicts its own size exactly", () => {
    const wav = WAV_HEADER_BYTES + 5 * 6;
    expect(
      stemArchiveBytes(
        stems.map((s) => s.path),
        wav,
      ),
    ).toBe(bytes.byteLength);
  });

  it("pads a long tail in more than one chunk", () => {
    const long = { ...stem("01 Long.wav", []), frames: 0 };
    const frames = 300_000; // 1.8 MB of padding at 24-bit stereo
    const tall = { ...stem("02 Tall.wav", []), pcm: new Uint8Array(frames * 6), frames };
    const { entries: out } = unzip(buildStemArchive([long, tall], FORMAT).parts);
    expect(dataSize(out["01 Long.wav"])).toBe(frames * 6);
    expect(out["01 Long.wav"].byteLength).toBe(WAV_HEADER_BYTES + frames * 6);
  });

  it("refuses an archive a plain ZIP cannot hold, before building anything", () => {
    const huge = { ...stem("01 Huge.wav", []), frames: Math.ceil(MAX_ZIP_BYTES / 6) };
    expect(() => buildStemArchive([huge], FORMAT)).toThrow(RangeError);
  });
});
