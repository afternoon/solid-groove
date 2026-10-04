import { createDevice } from "../domain/devices";
import type { Device, Project } from "../domain/entities";
import {
  createFactoryContext,
  createNoteClip,
  createNoteEvent,
  createPlacement,
  createReturnBus,
  createSamplerInstrument,
  createSend,
  createTrack,
} from "../domain/factories";
import { createSliceFixtureProject } from "../domain/fixtures";
import { createSeededIdFactory } from "../domain/ids";
import { TICKS_PER_QUARTER } from "../domain/time";

/**
 * Helpers for pinning latency and its compensation against a render (tests
 * only, #883): a deterministic noise burst to send through a path, the lag at
 * which two renders best line up, and the song the export alignment matrix
 * renders.
 */

/** `frames` of seeded white noise in [-amplitude, amplitude]: no two lags of
 * it look alike, so the cross-correlation has exactly one peak. */
export function noiseBurst(frames: number, amplitude = 0.25, seed = 883): Float32Array {
  const data = new Float32Array(frames);
  let state = seed >>> 0;
  for (let i = 0; i < frames; i++) {
    // A 32-bit LCG (Numerical Recipes): plenty for a test signal.
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    data[i] = (state / 0xffff_ffff - 0.5) * 2 * amplitude;
  }
  return data;
}

/**
 * The lag, in frames, at which `delayed` best matches `reference`: the peak
 * of their cross-correlation over `-maxLag..maxLag`, positive when `delayed`
 * is late. A path that only delays (or also changes level, or gently
 * compresses) peaks at exactly its latency. Only the first `window` frames of
 * `reference` are correlated, which is plenty for a song that starts sounding
 * at once and keeps the search cheap.
 */
export function bestLag(
  reference: Float32Array,
  delayed: Float32Array,
  maxLag: number,
  window = reference.length,
): number {
  let best = 0;
  let bestScore = Number.NEGATIVE_INFINITY;
  const frames = Math.min(window, reference.length);
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let score = 0;
    const start = Math.max(0, -lag);
    const end = Math.min(frames, delayed.length - lag);
    for (let i = start; i < end; i++) score += reference[i] * delayed[i + lag];
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }
  return best;
}

/**
 * Where the export alignment matrix puts Compressors, as the issue measured
 * them (#883): none, one or two on the master, one on the Kick track only,
 * and one on the return.
 */
export type AlignmentCase = "none" | "master" | "master-twice" | "kick" | "return";

export const ALIGNMENT_CASES: readonly AlignmentCase[] = [
  "none",
  "master",
  "master-twice",
  "kick",
  "return",
];

/**
 * The matrix's song: "Kick" on the beats and "Bass" on the off-beats, both
 * samplers, with Bass sending to a "Verb" return, and Compressors placed per
 * `where`. Every Compressor runs 1:1 at a 0 dB threshold, so it changes
 * nothing but time: each case should export the same files as `"none"`.
 */
export function createAlignmentProject(where: AlignmentCase): Project {
  const base = createSliceFixtureProject();
  const ids = createSeededIdFactory("latency-alignment");
  const context = createFactoryContext({ ids, now: 0 });
  const [kick] = base.song.tracks;
  const [asset] = base.song.assets;
  const verb = createReturnBus(context, { name: "Verb", order: 0 });
  const bass = createTrack(context, {
    name: "Bass",
    order: 1,
    instrument: createSamplerInstrument(asset.id),
    sendConfig: [createSend(verb.id, 0.5)],
  });
  const bassClip = createNoteClip(context, {
    trackId: bass.id,
    name: "Off-beats",
    lengthTicks: 4 * TICKS_PER_QUARTER,
    events: [0, 1, 2, 3].map((beat) =>
      createNoteEvent(context, {
        startTicks: beat * TICKS_PER_QUARTER + TICKS_PER_QUARTER / 2,
        durationTicks: TICKS_PER_QUARTER / 4,
        pitch: 43,
      }),
    ),
  });
  const bassPlacement = createPlacement(context, {
    clipId: bassClip.id,
    trackId: bass.id,
    startTicks: 0,
    durationTicks: 4 * TICKS_PER_QUARTER,
  });
  const compressor = (order: number): Device => {
    const device = createDevice(ids("device"), "compressor", order);
    return { ...device, parameters: { ...device.parameters, ratio: 1, threshold: 0 } };
  };
  const masterDevices =
    where === "master"
      ? [compressor(0)]
      : where === "master-twice"
        ? [compressor(0), compressor(1)]
        : [];
  return {
    ...base,
    song: {
      ...base.song,
      tracks: [
        { ...kick, name: "Kick", devices: where === "kick" ? [compressor(0)] : [] },
        bass,
      ],
      returns: [{ ...verb, devices: where === "return" ? [compressor(0)] : [] }],
      master: { ...base.song.master, devices: masterDevices },
      placements: [...base.song.placements, bassPlacement],
    },
    clips: [...base.clips, bassClip],
  };
}
