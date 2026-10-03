import { describe, expect, it } from "vitest";
import { WAVEFORM_PEAK_COUNT } from "../library/manifest";
import {
  type AudioDecoder,
  analyseSound,
  bpmFromFileName,
  type DecodedAudio,
  guessShelfPlace,
  soundNameFromFile,
  UndecodableAudioError,
  waveformPeaks,
  wavFormat,
} from "./soundAnalysis";

/** A real PCM WAV header (and body) at the given rate and channel count. */
function wav(sampleRate: number, channels: number, frames = 16): ArrayBuffer {
  const bytes = new ArrayBuffer(44 + frames * 2 * channels);
  const view = new DataView(bytes);
  const ascii = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  };
  ascii(0, "RIFF");
  view.setUint32(4, bytes.byteLength - 8, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  ascii(36, "data");
  view.setUint32(40, frames * 2 * channels, true);
  return bytes;
}

function decoded(duration: number, data: number[], channels = 1): DecodedAudio {
  const samples = Float32Array.from(data);
  return { duration, numberOfChannels: channels, getChannelData: () => samples };
}

const file = (name: string, bytes: ArrayBuffer) => ({
  name,
  arrayBuffer: async () => bytes,
});

describe("reading a dropped file", () => {
  it("names a sound after its file", () => {
    expect(soundNameFromFile("tape-kick.wav")).toBe("tape kick");
    expect(soundNameFromFile("Room__Tone 02.aiff")).toBe("Room Tone 02");
    expect(soundNameFromFile(".wav")).toBe("Untitled sound");
  });

  it("reads a tempo the filename states", () => {
    expect(bpmFromFileName("break 174bpm.wav")).toBe(174);
    expect(bpmFromFileName("loop_128_BPM.wav")).toBe(128);
    expect(bpmFromFileName("kick 909.wav")).toBeNull();
    expect(bpmFromFileName("weird 999bpm.wav")).toBeNull();
  });

  it("reads a WAV header's sample rate and channels", () => {
    expect(wavFormat(wav(48_000, 2))).toEqual({ sampleRate: 48_000, channelCount: 2 });
    expect(wavFormat(new TextEncoder().encode("ID3 not a wav").buffer)).toBeNull();
  });

  it("draws a waveform normalised to its loudest bin", () => {
    const peaks = waveformPeaks(decoded(1, [0, 0.5, -1, 0.25]));
    expect(peaks).toHaveLength(WAVEFORM_PEAK_COUNT);
    expect(Math.max(...(peaks ?? []))).toBe(255);
    expect(waveformPeaks(decoded(1, [0, 0, 0]))).toBeNull();
  });

  it("places a sound on the shelf from its name, then its length", () => {
    expect(guessShelfPlace("tape kick", "one-shot", 0.1)).toEqual({
      family: "drums",
      role: "kick",
    });
    expect(guessShelfPlace("room tone", "one-shot", 0.1)).toEqual({
      family: "texture",
      role: "ambience",
    });
    expect(guessShelfPlace("door slam", "one-shot", 0.1)).toEqual({
      family: "drums",
      role: "percussion",
    });
    expect(guessShelfPlace("door slam", "one-shot", 4)).toEqual({
      family: "texture",
      role: "organic",
    });
    expect(guessShelfPlace("anything", "loop", 4).role).toBe("full-loop");
  });
});

describe("analyseSound", () => {
  const decode: AudioDecoder = async () => decoded(0.1, [0.1, -0.8, 0.4]);

  it("records everything the library shows about a sound", async () => {
    const analysis = await analyseSound(file("tape-kick.wav", wav(44_100, 1)), decode);
    expect(analysis).toMatchObject({
      name: "tape kick",
      type: "one-shot",
      family: "drums",
      role: "kick",
      durationSeconds: 0.1,
      sampleRate: 44_100,
      channelCount: 1,
      bpm: null,
    });
    expect(analysis.peaks).toHaveLength(WAVEFORM_PEAK_COUNT);
  });

  it("makes a file that states a tempo a loop", async () => {
    const analysis = await analyseSound(
      file("break-174bpm.wav", wav(44_100, 2)),
      async () => decoded(2.76, [0.5]),
    );
    expect(analysis).toMatchObject({ type: "loop", bpm: 174, role: "full-loop" });
  });

  it("leaves the sample rate unknown when the file has no WAV header", async () => {
    const analysis = await analyseSound(
      file("hit.mp3", new Uint8Array(16).buffer),
      async () => decoded(0.5, [0.5], 6),
    );
    expect(analysis.sampleRate).toBeNull();
    // A multichannel file plays as stereo.
    expect(analysis.channelCount).toBe(2);
  });

  it("refuses a file that does not decode, or decodes to nothing", async () => {
    const failing: AudioDecoder = async () => {
      throw new Error("EncodingError");
    };
    await expect(
      analyseSound(file("x.wav", wav(44_100, 1)), failing),
    ).rejects.toBeInstanceOf(UndecodableAudioError);
    await expect(
      analyseSound(file("x.wav", wav(44_100, 1)), async () => decoded(0, [])),
    ).rejects.toBeInstanceOf(UndecodableAudioError);
  });
});
