import { beforeAll, describe, expect, it } from "vitest";
import { installWebAudioGlobals, rms } from "./testAudioContext";

installWebAudioGlobals();

let Tone: typeof import("tone");
let OrderedGrainPlayer: typeof import("./orderedGrainPlayer").OrderedGrainPlayer;

beforeAll(async () => {
  Tone = await import("tone");
  ({ OrderedGrainPlayer } = await import("./orderedGrainPlayer"));
});

/** One second of a 220 Hz tone at the context's rate. */
function toneBuffer(): import("tone").ToneAudioBuffer {
  const rate = Tone.getContext().sampleRate;
  return Tone.ToneAudioBuffer.fromArray(
    Float32Array.from(
      { length: rate },
      (_, i) => 0.5 * Math.sin((2 * Math.PI * 220 * i) / rate),
    ),
  );
}

describe("OrderedGrainPlayer", () => {
  it("still finds the grain clock and active grains it takes over from Tone", () => {
    // It reads two private `Tone.GrainPlayer` fields; a Tone upgrade that
    // renames them throws here rather than silently playing nothing.
    const player = new OrderedGrainPlayer(toneBuffer());
    expect(player).toBeInstanceOf(Tone.GrainPlayer);
    player.dispose();
  });

  it("plays a stretched buffer through its grains, without gaps between them", async () => {
    const rendered = await Tone.Offline(({ destination }) => {
      const player = new OrderedGrainPlayer(toneBuffer()).connect(destination);
      player.grainSize = 0.1;
      player.overlap = 0.05;
      player.playbackRate = 0.8;
      player.start(0, 0, 0.6);
    }, 0.6);
    const samples = Float32Array.from(rendered.getChannelData(0));
    const rate = rendered.sampleRate;
    // Every 50 ms window across several grain boundaries carries the tone.
    for (let start = 0.05; start < 0.5; start += 0.05) {
      const window = samples.subarray(
        Math.round(start * rate),
        Math.round((start + 0.05) * rate),
      );
      expect(rms(window), `${start.toFixed(2)} s`).toBeGreaterThan(0.1);
    }
  });

  it("disposes its grain bus with itself, more than once safely", () => {
    const player = new OrderedGrainPlayer(toneBuffer());
    player.dispose();
    expect(() => player.dispose()).not.toThrow();
  });
});
