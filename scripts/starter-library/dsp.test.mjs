import { describe, expect, it } from "vitest";
import {
  createRng,
  highpass,
  lowpass,
  normalizePeak,
  peak,
  pinkNoise,
  removeDcOffset,
  rms,
  SAMPLE_RATE,
  seedFromString,
  trimTail,
  whiteNoise,
} from "./dsp.mjs";
import { chordFrequencies, noteToFrequency, noteToMidi } from "./music.mjs";
import {
  analyze,
  BIT_DEPTH,
  encodeWav,
  sha256,
  storageKeyFor,
  waveformPeaks,
} from "./wav.mjs";

describe("determinism", () => {
  // Every asset ID maps to a fixed seed, and the whole pipeline's
  // reproducibility — stable SHA-256s, idempotent uploads, no-op rebuilds —
  // rests on this.
  it("produces identical sequences from identical seeds", () => {
    const a = Array.from({ length: 64 }, createRng(1234));
    const b = Array.from({ length: 64 }, createRng(1234));
    expect(a).toEqual(b);
    expect(Array.from({ length: 64 }, createRng(1235))).not.toEqual(a);
  });

  it("derives a stable seed from a string", () => {
    expect(seedFromString("sg-one-shot-drums-kick-0001")).toBe(
      seedFromString("sg-one-shot-drums-kick-0001"),
    );
    expect(seedFromString("a")).not.toBe(seedFromString("b"));
  });
});

describe("filters", () => {
  const noise = () => whiteNoise(SAMPLE_RATE, createRng(7));

  it("a lowpass attenuates content above its cutoff", () => {
    const filtered = lowpass(noise(), 500);
    expect(rms(highpass(filtered, 5000))).toBeLessThan(
      rms(highpass(noise(), 5000)) * 0.1,
    );
  });

  it("a highpass attenuates content below its cutoff", () => {
    const filtered = highpass(noise(), 5000);
    expect(rms(lowpass(filtered, 500))).toBeLessThan(rms(lowpass(noise(), 500)) * 0.1);
  });

  it("pink noise carries more low-frequency energy than white", () => {
    const pink = pinkNoise(SAMPLE_RATE, createRng(9));
    const white = whiteNoise(SAMPLE_RATE, createRng(9));
    const ratio = (buffer) => rms(lowpass(buffer, 300)) / rms(buffer);
    expect(ratio(pink)).toBeGreaterThan(ratio(white));
  });
});

describe("conditioning", () => {
  it("removes a DC offset", () => {
    const offset = new Float32Array(SAMPLE_RATE).fill(0.5);
    const mean = (b) => b.reduce((sum, v) => sum + v, 0) / b.length;
    expect(Math.abs(mean(removeDcOffset(offset)))).toBeLessThan(0.01);
  });

  it("normalizes to an exact peak target without flattening dynamics", () => {
    const buffer = new Float32Array([0.1, -0.2, 0.05]);
    const normalized = normalizePeak(buffer, -6);
    expect(20 * Math.log10(peak(normalized))).toBeCloseTo(-6, 4);
    // Relative levels are preserved — this is headroom management, not
    // loudness normalization (docs/sample-library.md section 10).
    expect(normalized[0] / normalized[1]).toBeCloseTo(buffer[0] / buffer[1], 6);
  });

  it("leaves a silent buffer alone rather than dividing by zero", () => {
    const silent = new Float32Array(16);
    expect(Array.from(normalizePeak(silent, -1))).toEqual(Array.from(silent));
  });

  it("trims trailing silence but keeps a minimum length", () => {
    const buffer = new Float32Array(SAMPLE_RATE);
    buffer.set([1, 0.5, 0.25], 0);
    const trimmed = trimTail(buffer);
    expect(trimmed.length).toBeLessThan(buffer.length);
    expect(trimmed.length).toBeGreaterThanOrEqual(Math.round(0.02 * SAMPLE_RATE));
  });
});

describe("wav encoding", () => {
  it("writes a 48 kHz 24-bit mono PCM header", () => {
    const wav = encodeWav(new Float32Array(10));
    expect(wav.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(wav.subarray(8, 12).toString("ascii")).toBe("WAVE");
    expect(wav.readUInt16LE(20)).toBe(1); // PCM
    expect(wav.readUInt16LE(22)).toBe(1); // mono
    expect(wav.readUInt32LE(24)).toBe(SAMPLE_RATE);
    expect(wav.readUInt16LE(34)).toBe(BIT_DEPTH);
    expect(wav.readUInt32LE(40)).toBe(10 * 3);
    expect(wav.length).toBe(44 + 30);
  });

  it("round-trips sample values through 24-bit quantization", () => {
    const samples = new Float32Array([0, 0.5, -0.5, 0.999, -0.999]);
    const wav = encodeWav(samples);
    const maximum = 2 ** 23 - 1;
    for (let i = 0; i < samples.length; i++) {
      expect(wav.readIntLE(44 + i * 3, 3) / maximum).toBeCloseTo(samples[i], 5);
    }
  });

  // Full-scale negative input must not wrap to positive full scale.
  it("clamps out-of-range input safely at both extremes", () => {
    const wav = encodeWav(new Float32Array([2, -2]));
    expect(wav.readIntLE(44, 3)).toBe(2 ** 23 - 1);
    expect(wav.readIntLE(47, 3)).toBe(-(2 ** 23 - 1));
  });

  it("always emits the declared number of waveform buckets", () => {
    for (const length of [7, 100, 4801, 480000]) {
      expect(waveformPeaks(new Float32Array(length), 64)).toHaveLength(128);
    }
  });

  it("derives the storage key from the content hash", () => {
    const hash = sha256(Buffer.from("hello"));
    expect(storageKeyFor(hash)).toBe(
      `sha256/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}.wav`,
    );
  });

  it("reports audio facts the manifest depends on", () => {
    const samples = new Float32Array(SAMPLE_RATE / 2).fill(0.5);
    const audio = analyze(samples);
    expect(audio).toMatchObject({
      sampleRate: 48000,
      bitDepth: 24,
      channels: 1,
    });
    expect(audio.durationSeconds).toBeCloseTo(0.5, 4);
    expect(audio.peakDbfs).toBeCloseTo(-6.02, 1);
  });
});

describe("music helpers", () => {
  it("maps scientific pitch notation to concert pitch", () => {
    expect(noteToMidi("A4")).toBe(69);
    expect(noteToFrequency("A4")).toBeCloseTo(440, 6);
    expect(noteToFrequency("A3")).toBeCloseTo(220, 6);
    expect(noteToFrequency("C1")).toBeCloseTo(32.703, 3);
    expect(noteToFrequency("A#1")).toBeCloseTo(noteToFrequency("Bb1"), 6);
  });

  it("rejects an unparseable note rather than guessing", () => {
    expect(() => noteToFrequency("H4")).toThrow(/unrecognized note/);
  });

  it("builds chord voicings from the root", () => {
    const [root, third, fifth] = chordFrequencies("C3", "minor");
    expect(third / root).toBeCloseTo(2 ** (3 / 12), 6);
    expect(fifth / root).toBeCloseTo(2 ** (7 / 12), 6);
    expect(chordFrequencies("C3", "fifth")).toHaveLength(2);
  });
});
