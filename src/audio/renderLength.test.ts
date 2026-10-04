import { describe, expect, it } from "vitest";
import type { PlacementId } from "../domain/ids";
import { TICKS_PER_BAR, type Ticks } from "../domain/time";
import type { AudioPlacementProjection } from "../projection/audioProjection";
import {
  SILENCE_THRESHOLD,
  songEndSeconds,
  songEndTicks,
  TRUNCATION_FADE_SECONDS,
  trimRenderedTail,
} from "./renderLength";

function placement(startTicks: number, durationTicks: number): AudioPlacementProjection {
  return {
    id: `pl_${startTicks}_${durationTicks}` as PlacementId,
    startTicks: startTicks as Ticks,
    durationTicks: durationTicks as Ticks,
  } as AudioPlacementProjection;
}

describe("song end", () => {
  it("is the end of whichever placement ends last, not the last to start", () => {
    const placements = [
      placement(0, 4 * TICKS_PER_BAR),
      placement(2 * TICKS_PER_BAR, TICKS_PER_BAR),
    ];
    expect(songEndTicks({ placements })).toBe(4 * TICKS_PER_BAR);
    // Four 4/4 bars at 120 BPM are 8 s, and at 60 BPM 16 s.
    expect(songEndSeconds({ placements, tempo: 120 })).toBe(8);
    expect(songEndSeconds({ placements, tempo: 60 })).toBe(16);
  });

  it("is zero for a song with nothing placed", () => {
    expect(songEndTicks({ placements: [] })).toBe(0);
  });
});

describe("trimRenderedTail", () => {
  const rate = 1_000;

  it("keeps the audible tail and drops the silence after it", () => {
    const left = new Float32Array(100);
    const right = new Float32Array(100);
    left[10] = 0.5;
    right[42] = 0.001; // the quieter channel still decides the end
    right[60] = SILENCE_THRESHOLD / 2; // below the threshold: silence
    const trimmed = trimRenderedTail([left, right], rate, 20);
    expect(trimmed.frames).toBe(43);
    expect(trimmed.truncated).toBe(false);
    expect(trimmed.channels.map((c) => c.length)).toEqual([43, 43]);
    expect(trimmed.channels[1][42]).toBeCloseTo(0.001, 9);
  });

  it("never ends before the song, even when the song ends in silence", () => {
    const silent = new Float32Array(100);
    const trimmed = trimRenderedTail([silent, silent], rate, 80);
    expect(trimmed.frames).toBe(80);
    expect(trimmed.truncated).toBe(false);
  });

  it("does not touch a level anywhere it keeps (nothing is normalized)", () => {
    // The silence after the sound runs longer than the settling window.
    const data = Float32Array.from({ length: 100 }, (_, i) => (i < 40 ? 0.25 : 0));
    const trimmed = trimRenderedTail([data], rate, 10);
    expect(Array.from(trimmed.channels[0])).toEqual(Array.from(data.slice(0, 40)));
    // A copy: the caller's buffer is not a view of the result.
    trimmed.channels[0][0] = 9;
    expect(data[0]).toBe(0.25);
  });

  it("does not count a constant offset after the song as a tail (#962)", () => {
    // A shaper can turn silence into a small DC level: -78 dBFS here, over the
    // silence threshold on every sample, but a flat line, not sound.
    const offset = -0.00013;
    const data = new Float32Array(400).fill(offset);
    for (let i = 0; i < 100; i++) data[i] = offset + 0.5 * Math.sin(i / 3);
    data[150] = offset + 0.01; // a real tail sample, riding on the offset
    const trimmed = trimRenderedTail([data, data], rate, 100);
    expect(trimmed.frames).toBe(151);
    expect(trimmed.truncated).toBe(false);
  });

  it("fades a tail still sounding at the end of the budget instead of cutting it", () => {
    // A tone, not a flat line: a constant level is an offset, not a tail.
    const data = Float32Array.from({ length: 200 }, (_, i) => (i % 2 ? -0.5 : 0.5));
    const trimmed = trimRenderedTail([data], rate, 100);
    const fadeFrames = Math.round(TRUNCATION_FADE_SECONDS * rate);
    expect(trimmed.truncated).toBe(true);
    expect(trimmed.frames).toBe(200);
    expect(trimmed.channels[0][199]).toBe(-0);
    expect(Math.abs(trimmed.channels[0][200 - fadeFrames - 1])).toBe(0.5);
    // The song itself is never faded.
    expect(Math.abs(trimmed.channels[0][99])).toBe(0.5);
  });
});
