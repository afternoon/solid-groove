import { describe, expect, it, vi } from "vitest";
import { cachedPeaksOf, peaksOf } from "./waveformPeaks";

const buffer = (...channels: number[][]) => ({
  numberOfChannels: channels.length,
  getChannelData: (channel: number) => Float32Array.from(channels[channel]),
});

describe("peaksOf (#447)", () => {
  it("takes the loudest sample in each slice, scaled so the loudest slice is 1", () => {
    const peaks = peaksOf(buffer([0.1, -0.2, 0.4, -0.1, 0.05, 0.1, 0, -0.8]), 4);
    expect(Array.from(peaks)).toEqual(
      [0.25, 0.5, 0.125, 1].map((v) => expect.closeTo(v, 5)),
    );
  });

  it("reads every channel, so a sound panned hard to one side still draws", () => {
    const peaks = peaksOf(buffer([0, 0, 0, 0], [0.5, 0, 0, 0.25]), 2);
    expect(Array.from(peaks)).toEqual([1, 0.5]);
  });

  it("returns zeros for silence and nothing for no buckets", () => {
    expect(Array.from(peaksOf(buffer([0, 0, 0]), 3))).toEqual([0, 0, 0]);
    expect(peaksOf(buffer([1]), 0)).toHaveLength(0);
  });
});

describe("cachedPeaksOf (#447)", () => {
  it("scans a buffer once per bucket count, however many wells draw it", () => {
    const decoded = buffer([0.5, -0.25, 0.1, 0]);
    const read = vi.spyOn(decoded, "getChannelData");
    const first = cachedPeaksOf(decoded, 2);
    expect(cachedPeaksOf(decoded, 2)).toBe(first);
    expect(read).toHaveBeenCalledTimes(1);

    // Another width is another scan, cached in its turn.
    expect(cachedPeaksOf(decoded, 4)).not.toBe(first);
    expect(cachedPeaksOf(decoded, 4)).toBe(cachedPeaksOf(decoded, 4));
    expect(read).toHaveBeenCalledTimes(2);
  });
});
