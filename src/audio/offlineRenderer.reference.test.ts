import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Project } from "../domain/entities";
import { createSliceFixtureProject } from "../domain/fixtures";
import {
  TICKS_PER_BAR,
  TICKS_PER_QUARTER,
  type Ticks,
  ticksToSeconds,
} from "../domain/time";
import { buildAudioProjection } from "../projection/audioProjection";
import { installWebAudioGlobals } from "./testAudioContext";

/**
 * Deterministic reference renders for the offline renderer (EXP-001): small
 * songs whose right answer is known in advance, rendered and measured.
 *
 * "Deterministic" means the same song renders to the same samples every time.
 * The one exception is the reverb, whose impulse `Tone.Reverb` builds from
 * unseeded noise: its tail is asserted by where it ends, never sample by
 * sample.
 */

// Must run before Tone is imported — see AudioRuntime.test.ts for why.
installWebAudioGlobals();

let Tone: typeof import("tone");
let renderer: typeof import("./offlineRenderer");
let runtimeModule: typeof import("./AudioRuntime");
let masterLatency: typeof import("./masterLatency");

beforeAll(async () => {
  Tone = await import("tone");
  renderer = await import("./offlineRenderer");
  runtimeModule = await import("./AudioRuntime");
  masterLatency = await import("./masterLatency");
});

afterEach(async () => {
  await runtimeModule.getAudioRuntime().close();
  runtimeModule.__resetAudioRuntimeForTests();
});

const RATE = 22_050;

/** 50 ms of DC: its onset is a step, so it can be timed to the frame. */
const stepLoader = {
  load: async () => Tone.ToneAudioBuffer.fromArray(new Float32Array(1_102).fill(0.5)),
};

interface Note {
  tick: number;
  pitch?: number;
  ticks?: number;
}

/** The slice fixture's sampler track playing `notes` in one clip. */
function samplerSong(notes: Note[], options: { bars?: number; tempo?: number } = {}) {
  return withNotes(
    createSliceFixtureProject({ tempo: options.tempo }),
    notes,
    options.bars,
  );
}

function withNotes(project: Project, notes: Note[], bars = 1): Project {
  const length = (bars * TICKS_PER_BAR) as Ticks;
  const [clip] = project.clips;
  if (clip.content.kind !== "notes") throw new Error("expected a note clip");
  const template = clip.content.events[0];
  const events = notes.map((note, i) => ({
    ...template,
    id: `evt_${i}` as typeof template.id,
    trigger: { kind: "pitch" as const, pitch: note.pitch ?? 60 },
    startTicks: note.tick as Ticks,
    durationTicks: (note.ticks ?? 48) as Ticks,
    velocity: 1,
  }));
  return {
    ...project,
    clips: [{ ...clip, lengthTicks: length, content: { kind: "notes", events } }],
    song: {
      ...project.song,
      placements: project.song.placements.map((p) => ({ ...p, durationTicks: length })),
    },
  };
}

async function render(project: Project, maxTailSeconds = 1) {
  return renderer.renderProjectOffline(buildAudioProjection(project), {
    sampleRate: RATE,
    maxTailSeconds,
    bufferLoader: stepLoader,
  });
}

/** The first frame at or after `from` whose level passes `threshold`. */
function onset(data: Float32Array, from = 0, threshold = 1e-3): number {
  for (let i = Math.max(0, from); i < data.length; i++) {
    if (Math.abs(data[i]) > threshold) return i;
  }
  return -1;
}

/**
 * A voice's amp envelope rises from zero, so its first frame is silent and it
 * is heard from the frame after its start: an onset is "exact" within one.
 */
const LEAD_IN = 1;

/** A note's start, in frames, at `tempo`. */
function frameOf(tick: number, tempo = 120): number {
  return Math.round(ticksToSeconds(tick, tempo) * RATE);
}

describe("offline reference renders: timing and alignment", () => {
  const notes = [
    0,
    TICKS_PER_QUARTER,
    2 * TICKS_PER_QUARTER + 48,
    3 * TICKS_PER_QUARTER + 96,
  ];

  it.each([120, 90])("starts every note on its exact frame at %d BPM", async (tempo) => {
    const result = await render(
      samplerSong(
        notes.map((tick) => ({ tick })),
        { tempo },
      ),
    );
    const data = result.channels[0];
    for (const tick of notes) {
      const expected = frameOf(tick, tempo);
      const measured = onset(data, expected - 64);
      expect(measured - expected, `tick ${tick}`).toBeGreaterThanOrEqual(0);
      expect(measured - expected, `tick ${tick}`).toBeLessThanOrEqual(LEAD_IN);
    }
  });

  it("starts the file at bar 1, even when the first clip starts later", async () => {
    const project = samplerSong([{ tick: 0 }]);
    const later = {
      ...project,
      song: {
        ...project.song,
        placements: project.song.placements.map((p) => ({
          ...p,
          startTicks: TICKS_PER_BAR as Ticks,
        })),
      },
    };
    const result = await render(later);
    expect(result.songEndSeconds).toBe(4);
    expect(onset(result.channels[0]) - frameOf(TICKS_PER_BAR)).toBeLessThanOrEqual(
      LEAD_IN,
    );
    expect(onset(result.channels[0])).toBeGreaterThanOrEqual(frameOf(TICKS_PER_BAR));
    // Both channels carry the same centred signal, aligned to the frame.
    expect(onset(result.channels[1])).toBe(onset(result.channels[0]));
  });

  it("drops the master limiter's pre-delay, and only that, from the front", async () => {
    const latency = await masterLatency.masterLatencyFrames(RATE);
    expect(Number.isInteger(latency)).toBe(true);
    expect(latency).toBeGreaterThanOrEqual(0);
    // Measured once per rate, not once per render.
    expect(masterLatency.masterLatencyFrames(RATE)).toBe(
      masterLatency.masterLatencyFrames(RATE),
    );
    const result = await render(samplerSong([{ tick: 0 }]));
    expect(onset(result.channels[0])).toBeLessThanOrEqual(LEAD_IN);
  });
});
