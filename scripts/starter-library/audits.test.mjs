// The section 10 audio audits: what each measurement reads, and a fixture that
// violates each library-wide rule.

import { describe, expect, it } from "vitest";
import {
  auditLoudness,
  LOUDNESS_OUTLIER_LU,
  MIN_LOUDNESS_BAND,
  validateLibraryAudio,
} from "./audits.mjs";
import { integratedLoudness, kWeight, SAMPLE_RATE } from "./dsp.mjs";
import { measureDelivered } from "./manifest.mjs";
import { decodeWav, encodeWav, PEAK_BINS } from "./wav.mjs";

function sine(frequency, seconds, amplitude = 1) {
  const out = new Float32Array(Math.round(seconds * SAMPLE_RATE));
  for (let i = 0; i < out.length; i++) {
    out[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / SAMPLE_RATE);
  }
  return out;
}

/** The smallest record the audits read: an id, a role band, an audio block. */
function audioAsset(id, { family = "drums", role = "kick", ...audio } = {}) {
  return { id, family, role, audio: { loudnessLufs: -15, ...audio } };
}

describe("integrated loudness (ITU-R BS.1770-4)", () => {
  it("reads a full-scale 997 Hz sine on one channel as -3.01 LUFS", () => {
    // BS.1770's own calibration point.
    expect(integratedLoudness(sine(997, 2))).toBeCloseTo(-3.01, 1);
  });

  it("follows the level, and sums channels with unit weights", () => {
    const quiet = sine(997, 2, 0.1);
    expect(integratedLoudness(quiet)).toBeCloseTo(-23.01, 1);
    // The same signal on both sides is twice the power: +3.01 LU.
    expect(integratedLoudness([quiet, quiet])).toBeCloseTo(-20.0, 1);
  });

  it("K-weights with the published 48 kHz coefficients", () => {
    // An impulse through the cascade, compared against the first output
    // samples of BS.1770's stage-1 and stage-2 filters run by hand.
    const impulse = new Float32Array(3);
    impulse[0] = 1;
    const out = kWeight(impulse);
    // Stage 1 b0 (1.53512485958697) times stage 2 b0 (1.0).
    expect(out[0]).toBeCloseTo(1.53512485958697, 8);
    // y1 = b1·b0' + b0·(b1' − a1'·b0'), expanded from the two published sets.
    const s1 = { b0: 1.53512485958697, b1: -2.69169618940638, a1: -1.69065929318241 };
    const s2a1 = -1.99004745483398;
    const stage1y1 = s1.b1 - s1.a1 * s1.b0;
    expect(out[1]).toBeCloseTo(stage1y1 - 2 * s1.b0 - s2a1 * s1.b0, 6);
  });

  it("gates out a long quiet stretch rather than averaging it in", () => {
    const tone = sine(997, 2, 0.1);
    const program = new Float32Array(tone.length * 5);
    program.set(tone, 0);
    // Eight seconds 40 dB down: inside the -70 LUFS absolute gate but well
    // under the relative gate 10 LU below the tone.
    program.set(sine(997, 8, 0.001), tone.length);
    expect(integratedLoudness(program)).toBeCloseTo(-23.01, 0);
  });

  it("measures a hit shorter than one 400 ms block as a block of its own length", () => {
    const hit = sine(997, 0.1, 0.1);
    expect(integratedLoudness(hit)).toBeCloseTo(-23.01, 1);
  });

  it("returns null for silence and for material under the absolute gate", () => {
    expect(integratedLoudness(new Float32Array(SAMPLE_RATE))).toBeNull();
    expect(integratedLoudness(sine(997, 1, 0.00001))).toBeNull();
    expect(integratedLoudness(new Float32Array(0))).toBeNull();
  });
});

describe("measuring a delivered master", () => {
  it("decodes the bytes the pipeline wrote", () => {
    const samples = sine(440, 0.05, 0.5);
    const { sampleRate, channels } = decodeWav(encodeWav(samples));
    expect(sampleRate).toBe(SAMPLE_RATE);
    expect(channels).toHaveLength(1);
    for (let i = 0; i < samples.length; i += 97) {
      expect(channels[0][i]).toBeCloseTo(samples[i], 5);
    }
  });

  it("finds the samples by walking the RIFF chunks, not at a fixed offset", () => {
    const samples = sine(440, 0.05, 0.5);
    const canonical = encodeWav([samples, samples]);
    // A LIST chunk (odd-sized, so padded) between `fmt ` and `data`, as a
    // tagging tool writes it.
    const list = Buffer.alloc(8 + 5 + 1);
    list.write("LIST", 0, "ascii");
    list.writeUInt32LE(5, 4);
    list.write("INFOx", 8, "ascii");
    const tagged = Buffer.concat([
      canonical.subarray(0, 36),
      list,
      canonical.subarray(36),
    ]);
    tagged.writeUInt32LE(tagged.length - 8, 4);
    const { channels } = decodeWav(tagged);
    expect(channels).toHaveLength(2);
    expect(channels[1]).toHaveLength(samples.length);
    for (let i = 0; i < samples.length; i += 97) {
      expect(channels[1][i]).toBeCloseTo(samples[i], 5);
    }
  });

  it("refuses a WAV it cannot read with a clear error", () => {
    const bytes = encodeWav(sine(440, 0.01));
    const sixteenBit = Buffer.from(bytes);
    sixteenBit.writeUInt16LE(16, 34);
    expect(() => decodeWav(sixteenBit)).toThrow(
      "decode: expected 24-bit WAV, found 16-bit",
    );
    const float = Buffer.from(bytes);
    float.writeUInt16LE(3, 20);
    expect(() => decodeWav(float)).toThrow("expected integer PCM, found format tag 3");
    expect(() => decodeWav(bytes.subarray(0, 60))).toThrow(
      "data chunk runs past the end",
    );
    expect(() => decodeWav(Buffer.from("not a wav at all"))).toThrow(
      "not a RIFF/WAVE file",
    );
  });

  it("records loudness and the overview without touching the audio", () => {
    const bytes = encodeWav(sine(997, 1, 0.1));
    const before = Buffer.from(bytes);
    const asset = measureDelivered({ id: "x", audio: { peakDbfs: -20 } }, bytes);
    expect(asset.audio.loudnessLufs).toBeCloseTo(-23, 0);
    expect(asset.audio.peakDbfs).toBe(-20);
    expect(asset.peaks).toHaveLength(PEAK_BINS);
    expect(bytes.equals(before)).toBe(true);
  });
});

describe("loudness outliers by role band", () => {
  const band = (count, loudness = -15) =>
    Array.from({ length: count }, (_unused, index) =>
      audioAsset(`kick-${index}`, { loudnessLufs: loudness + (index % 2) }),
    );

  it("accepts a band whose spread is ordinary dynamics", () => {
    const assets = [...band(6), audioAsset("quiet-kick", { loudnessLufs: -24 })];
    expect(auditLoudness(assets)).toMatchObject({ errors: [], warnings: [] });
  });

  it("reports an asset far quieter than the rest of its role band for review, without failing", () => {
    // Section 10 keeps useful dynamics: a sparse, long-decaying sound measures
    // far under a band of dense hits and is not a defect, so an outlier is a
    // warning for a person to audition, never an error.
    const assets = [...band(6), audioAsset("buried-kick", { loudnessLufs: -34 })];
    const { errors, warnings } = auditLoudness(assets);
    expect(errors).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^buried-kick: .* below the drums\/kick band median/);
  });

  it("reports an asset far louder than the rest of its role band", () => {
    const assets = [...band(6, -20), audioAsset("hot-kick", { loudnessLufs: -4 })];
    expect(auditLoudness(assets).warnings.join("\n")).toMatch(/hot-kick: .* above/);
  });

  it("judges each band on its own median", () => {
    // A -30 LUFS texture is unremarkable among quiet textures, however loud
    // the kicks are.
    const textures = Array.from({ length: 4 }, (_unused, index) =>
      audioAsset(`drone-${index}`, {
        family: "texture",
        role: "drone",
        loudnessLufs: -30 - index,
      }),
    );
    expect(auditLoudness([...band(6), ...textures]).warnings).toEqual([]);
  });

  it("compares a thin band with its family instead", () => {
    const thin = audioAsset("lone-tom", { role: "tom", loudnessLufs: -40 });
    expect(MIN_LOUDNESS_BAND).toBeGreaterThan(1);
    expect(auditLoudness([...band(6), thin]).warnings.join("\n")).toMatch(
      /lone-tom: .* the drums family median/,
    );
  });

  it("leaves an unmeasured asset to the per-asset validator", () => {
    const assets = [...band(6), audioAsset("unmeasured", { loudnessLufs: null })];
    expect(auditLoudness(assets)).toMatchObject({ errors: [], warnings: [] });
  });

  it("states its tolerance in the library summary", () => {
    const { errors, warnings, summary } = validateLibraryAudio([
      { assets: [...band(6), audioAsset("buried-kick", { loudnessLufs: -34 })] },
    ]);
    expect(errors).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(summary.join("\n")).toContain(`1 outside ±${LOUDNESS_OUTLIER_LU} LU`);
  });
});
