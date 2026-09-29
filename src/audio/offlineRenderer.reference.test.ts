import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createDevice, type DeviceTypeId } from "../domain/devices";
import type { Device, Project, Track } from "../domain/entities";
import { createFactoryContext, createReturnBus, createSend } from "../domain/factories";
import {
  createPianoRollFixtureProject,
  createSliceFixtureProject,
} from "../domain/fixtures";
import { createSeededIdFactory, type DeviceId } from "../domain/ids";
import {
  TICKS_PER_BAR,
  TICKS_PER_QUARTER,
  type Ticks,
  ticksToSeconds,
} from "../domain/time";
import { buildAudioProjection } from "../projection/audioProjection";
import { installWebAudioGlobals, rms } from "./testAudioContext";

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
  velocity?: number;
}

/** The slice fixture's sampler track playing `notes` in one clip. */
function samplerSong(notes: Note[], options: { bars?: number; tempo?: number } = {}) {
  return withNotes(
    createSliceFixtureProject({ tempo: options.tempo }),
    notes,
    options.bars,
  );
}

/** The piano-roll fixture's synth track playing `notes` in one clip. */
function synthSong(notes: Note[], bars = 1): Project {
  return withNotes(createPianoRollFixtureProject(), notes, bars);
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
    velocity: note.velocity ?? 1,
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

const ids = createSeededIdFactory("offline-reference");

function device(type: DeviceTypeId, values: Record<string, number> = {}): Device {
  const base = createDevice(ids("device") as DeviceId, type, 0);
  return { ...base, parameters: { ...base.parameters, ...values } };
}

function editTrack(project: Project, edit: (track: Track) => Track): Project {
  return { ...project, song: { ...project.song, tracks: project.song.tracks.map(edit) } };
}

/** The last frame whose level passes `threshold`. */
function lastSound(data: Float32Array, threshold = 1e-3): number {
  for (let i = data.length - 1; i >= 0; i--) if (Math.abs(data[i]) > threshold) return i;
  return -1;
}

/** The synth song the parity renders share: a track strip, inserts, a send to
 * a return with a tempo-synced delay, and a master chain, all off default. */
function paritySong(): Project {
  const bus = {
    ...createReturnBus(createFactoryContext({ ids }), { name: "FX", order: 0 }),
  };
  bus.devices = [device("delay", { feedback: 0.5, wet: 1 })];
  const project = editTrack(
    withNotes(createPianoRollFixtureProject({ tempo: 90 }), [
      { tick: 0, pitch: 57, ticks: 96, velocity: 0.8 },
    ]),
    (track) => ({
      ...track,
      instrument: { kind: "synth", parameters: { filterCutoff: 1_200, ampRelease: 0.3 } },
      devices: [device("filter", { cutoff: 2_500 }), device("saturator", { drive: 0.6 })],
      sendConfig: [createSend(bus.id, 0.5)],
      mixer: { ...track.mixer, volume: -6, pan: 0.4 },
    }),
  );
  return {
    ...project,
    song: {
      ...project.song,
      returns: [bus],
      master: { volume: -3, devices: [device("compressor")] },
    },
  };
}

describe("offline reference renders: duration and tails", () => {
  it("ends exactly at the end of the last clip when nothing rings past it", async () => {
    const result = await render(samplerSong([{ tick: 0 }]));
    expect(result.frames).toBe(2 * RATE);
    expect(result.tailTruncated).toBe(false);
  });

  it("keeps a synth note's release, and no more, past the end of the song", async () => {
    const release = 0.5;
    const project = editTrack(
      synthSong([{ tick: TICKS_PER_BAR - 48, ticks: 48 }]),
      (track) => ({
        ...track,
        instrument: { kind: "synth", parameters: { ampRelease: release } },
      }),
    );
    const result = await render(project, 3);
    const end = 2 * RATE;
    expect(rms(result.channels[0].subarray(end, end + 0.05 * RATE))).toBeGreaterThan(
      1e-3,
    );
    expect(result.frames).toBeGreaterThan(end + 0.1 * RATE);
    expect(result.frames).toBeLessThan(end + (release + 0.1) * RATE);
  });

  it("keeps a reverb's tail, longer for a longer decay, within the decay it was set to", async () => {
    async function tailSeconds(decay: number): Promise<number> {
      const project = editTrack(samplerSong([{ tick: TICKS_PER_BAR - 96 }]), (track) => ({
        ...track,
        devices: [device("reverb", { decay, size: 0, predelay: 0, wet: 1 })],
      }));
      const result = await render(project, 5);
      return lastSound(result.channels[0], 1e-4) / RATE - 2;
    }
    // Size 0 rings for half the stated decay (see devices/reverb.ts).
    const short = await tailSeconds(1);
    const long = await tailSeconds(3);
    expect(short).toBeGreaterThan(0.1);
    expect(short).toBeLessThan(0.5 + 0.1);
    expect(long).toBeGreaterThan(short + 0.3);
    expect(long).toBeLessThan(1.5 + 0.1);
  });

  it("fades a tail that outlasts the budget instead of cutting it", async () => {
    const project = editTrack(samplerSong([{ tick: TICKS_PER_BAR - 96 }]), (track) => ({
      ...track,
      devices: [device("delay", { sync: 0, time: 0.05, feedback: 0.97, wet: 1 })],
    }));
    const result = await render(project, 0.5);
    expect(result.tailTruncated).toBe(true);
    expect(Math.abs(result.frames - 2.5 * RATE)).toBeLessThanOrEqual(1);
    expect(result.channels[0][result.frames - 1]).toBe(0);
  });
});

describe("offline reference renders: parity with live playback", () => {
  it("renders a note exactly as the live graph plays it, every parameter included", async () => {
    const project = paritySong();
    const projection = buildAudioProjection(project);
    const trackId = project.song.tracks[0].id;
    const graphModule = await import("./ProjectAudioGraph");
    // Live: the graph live playback builds — on its default transport, the
    // global one, which is this render's while the callback runs — auditioning
    // the same note now. An audition is an immediate trigger, so it needs no
    // transport clock to sound.
    const live = await Tone.Offline(
      async ({ destination }) => {
        const runtime = new runtimeModule.AudioRuntime();
        const graph = new graphModule.ProjectAudioGraph(
          {
            getDestination: () => destination,
            getSampleRate: () => RATE,
            resume: async () => {},
            openProjectScope: (owner) => runtime.openProjectScope(owner),
          },
          "live",
          { now: () => 0 },
        );
        graph.reconcile(projection);
        graph.auditionTrack(trackId, { kind: "pitch", pitch: 57 }, 96, 0.8);
      },
      1.5,
      2,
      RATE,
    );
    const offline = await render(project, 2);
    const latency = await masterLatency.masterLatencyFrames(RATE);
    for (const channel of [0, 1]) {
      const heard = live.getChannelData(channel).subarray(latency);
      const rendered = offline.channels[channel];
      expect(rms(rendered.subarray(0, RATE))).toBeGreaterThan(1e-3);
      let worst = 0;
      const frames = Math.min(heard.length, rendered.length);
      for (let i = 0; i < frames; i++) {
        worst = Math.max(worst, Math.abs(heard[i] - rendered[i]));
      }
      expect(worst, `channel ${channel}`).toBeLessThan(1e-4);
    }
  });

  it("renders the same song to the same samples every time", async () => {
    const first = await render(paritySong(), 2);
    const second = await render(paritySong(), 2);
    expect(second.frames).toBe(first.frames);
    for (const channel of [0, 1]) {
      const a = first.channels[channel];
      const b = second.channels[channel];
      let differing = 0;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) differing++;
      expect(differing, `channel ${channel}`).toBe(0);
    }
  });
});
