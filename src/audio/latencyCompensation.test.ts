import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createDevice } from "../domain/devices";
import type { Project } from "../domain/entities";
import type { DeviceId } from "../domain/ids";
import { TICKS_PER_QUARTER } from "../domain/time";
import { buildAudioProjection } from "../projection/audioProjection";
import { bestLag, createAlignmentProject, noiseBurst } from "../testing/latencyProbe";
import { installWebAudioGlobals } from "./testAudioContext";

/**
 * Plugin delay compensation (#883): the plan every path is delayed by, and
 * the graph applying it live without rebuilding anything.
 */

// Must run before Tone is imported — see AudioRuntime.test.ts for why.
installWebAudioGlobals();

let compensation: typeof import("./latencyCompensation");
let devices: typeof import("./devices");
let master: typeof import("./MasterAudioGraph");
let delayModule: typeof import("./compensationDelay");
let AudioRuntimeModule: typeof import("./AudioRuntime");
let ProjectAudioGraphModule: typeof import("./ProjectAudioGraph");
let Tone: typeof import("tone");
let registryModule: typeof import("./resourceRegistry");

beforeAll(async () => {
  compensation = await import("./latencyCompensation");
  devices = await import("./devices");
  master = await import("./MasterAudioGraph");
  delayModule = await import("./compensationDelay");
  AudioRuntimeModule = await import("./AudioRuntime");
  ProjectAudioGraphModule = await import("./ProjectAudioGraph");
  Tone = await import("tone");
  registryModule = await import("./resourceRegistry");
});

afterEach(async () => {
  await AudioRuntimeModule.getAudioRuntime().close();
  AudioRuntimeModule.__resetAudioRuntimeForTests();
});

const RATE = 48_000;

const lookahead = () => devices.deviceLatencyFrames("compressor", RATE);
const limiter = () => master.masterLimiterLatencyFrames(RATE);

function plan(project: Project) {
  return compensation.planLatencyCompensation(buildAudioProjection(project), RATE);
}

function trackIds(project: Project) {
  const [kick, bass] = project.song.tracks;
  return { kick: kick.id, bass: bass.id, verb: project.song.returns[0].id };
}

describe("planLatencyCompensation", () => {
  it("delays nothing but the limiter when no chain looks ahead", () => {
    const project = createAlignmentProject("none");
    const { kick, bass, verb } = trackIds(project);
    const result = plan(project);
    expect(result.tracks.get(kick)).toBe(0);
    expect(result.tracks.get(bass)).toBe(0);
    expect(result.returns.get(verb)).toBe(0);
    expect(result.trackOutputFrames).toBe(0);
    expect(result.mixFrames).toBe(0);
    expect(result.masterFrames).toBe(limiter());
    expect(result.totalFrames).toBe(limiter());
  });

  it("holds every other track back by a track Compressor's lookahead", () => {
    const project = createAlignmentProject("kick");
    const { kick, bass, verb } = trackIds(project);
    const result = plan(project);
    expect(result.tracks.get(kick)).toBe(0);
    expect(result.tracks.get(bass)).toBe(lookahead());
    expect(result.returns.get(verb)).toBe(0);
    expect(result.trackOutputFrames).toBe(0);
    expect(result.mixFrames).toBe(lookahead());
    expect(result.totalFrames).toBe(lookahead() + limiter());
  });

  it("holds every track's direct output back by a return Compressor's lookahead", () => {
    const project = createAlignmentProject("return");
    const { kick, bass, verb } = trackIds(project);
    const result = plan(project);
    expect(result.tracks.get(kick)).toBe(0);
    expect(result.tracks.get(bass)).toBe(0);
    expect(result.returns.get(verb)).toBe(0);
    expect(result.trackOutputFrames).toBe(lookahead());
    expect(result.mixFrames).toBe(lookahead());
  });

  it("adds the master's Compressors to the latency the whole mix shares", () => {
    expect(plan(createAlignmentProject("master")).masterFrames).toBe(
      lookahead() + limiter(),
    );
    const twice = plan(createAlignmentProject("master-twice"));
    expect(twice.mixFrames).toBe(0);
    expect(twice.masterFrames).toBe(2 * lookahead() + limiter());
    expect(twice.totalFrames).toBe(2 * lookahead() + limiter());
  });

  it("sums a chain, counts a bypassed Compressor, and aligns two stages at once", () => {
    const project = createAlignmentProject("none");
    const { kick, bass, verb } = trackIds(project);
    const comp = (id: string, bypassed = false) => ({
      ...createDevice(id as DeviceId, "compressor", 0),
      bypassed,
    });
    const edited: Project = {
      ...project,
      song: {
        ...project.song,
        tracks: project.song.tracks.map((track) =>
          track.id === kick
            ? {
                ...track,
                devices: [
                  comp("dev_a"),
                  createDevice("dev_f" as DeviceId, "filter", 1),
                  comp("dev_b", true),
                ],
              }
            : track,
        ),
        returns: project.song.returns.map((bus) => ({
          ...bus,
          devices: [comp("dev_r")],
        })),
      },
    };
    const result = plan(edited);
    expect(result.tracks.get(kick)).toBe(0);
    expect(result.tracks.get(bass)).toBe(2 * lookahead());
    expect(result.returns.get(verb)).toBe(0);
    expect(result.trackOutputFrames).toBe(lookahead());
    // Kick's direct path: 2 lookaheads + the output delay. Bass's send into
    // Verb: 0 + 2 (align) + 1 (Verb). Every path lands on the same frame.
    expect(result.mixFrames).toBe(3 * lookahead());
  });
});

describe("CompensationDelay", () => {
  it("sets its first value outright and ramps every change after", () => {
    const delay = new delayModule.CompensationDelay();
    const rate = delay.node.context.sampleRate;
    const set = vi.spyOn(delay.node.delayTime, "setValueAtTime");
    const ramp = vi.spyOn(delay.node.delayTime, "linearRampTo");
    try {
      delay.set(0);
      expect(set).toHaveBeenCalledWith(0, 0);
      expect(ramp).not.toHaveBeenCalled();
      delay.set(288);
      expect(ramp).toHaveBeenCalledWith(
        288 / rate,
        delayModule.COMPENSATION_RAMP_SECONDS,
      );
      delay.set(288);
      expect(ramp).toHaveBeenCalledTimes(1);
      expect(delay.compensationFrames).toBe(288);
    } finally {
      delay.dispose();
    }
  });
});

function fakeTransport(): import("./ProjectAudioGraph").AudioTransport {
  let nextId = 1;
  return { bpm: { value: 120 }, schedule: () => nextId++, clear: () => {} };
}

describe("ProjectAudioGraph latency compensation, live", () => {
  it("re-aligns the other paths when a Compressor is added, rebuilding none of them", async () => {
    const runtime = new AudioRuntimeModule.AudioRuntime();
    const graph = new ProjectAudioGraphModule.ProjectAudioGraph(runtime, "p", {
      transport: fakeTransport(),
    });
    try {
      const rate = runtime.getSampleRate();
      const frames = devices.deviceLatencyFrames("compressor", rate);
      const before = createAlignmentProject("none");
      const { kick, bass, verb } = trackIds(before);
      const first = buildAudioProjection(before);
      graph.reconcile(first);
      const bassGraph = graph.trackGraphs.get(bass);
      const verbGraph = graph.returnGraphs.get(verb);
      expect(bassGraph?.latencyCompensation).toEqual({ alignFrames: 0, outputFrames: 0 });

      // The same song with a Compressor on Kick, as an edit would produce it.
      const after = createAlignmentProject("kick");
      const second = buildAudioProjection(after, first);
      expect(second.tracks[1]).toBe(first.tracks[1]);
      graph.reconcile(second);

      expect(graph.trackGraphs.get(bass)).toBe(bassGraph);
      expect(graph.returnGraphs.get(verb)).toBe(verbGraph);
      expect(graph.trackGraphs.get(kick)?.latencyCompensation.alignFrames).toBe(0);
      expect(bassGraph?.latencyCompensation).toEqual({
        alignFrames: frames,
        outputFrames: 0,
      });
      expect(graph.latencyCompensation?.mixFrames).toBe(frames);
      // The metronome's input is held back by the same frames as the mix.
      expect(graph.masterGraph.latencyCompensationFrames).toBe(frames);
      expect(graph.latencyCompensation?.totalFrames).toBe(
        frames + master.masterLimiterLatencyFrames(rate),
      );

      // And back again when it is removed.
      graph.reconcile(buildAudioProjection(before, second));
      expect(bassGraph?.latencyCompensation.alignFrames).toBe(0);
      expect(graph.latencyCompensation?.mixFrames).toBe(0);
      expect(graph.masterGraph.latencyCompensationFrames).toBe(0);
    } finally {
      await graph.dispose();
      await runtime.close();
    }
  });

  it("holds the returns and every direct output to a return Compressor", async () => {
    const runtime = new AudioRuntimeModule.AudioRuntime();
    const graph = new ProjectAudioGraphModule.ProjectAudioGraph(runtime, "p", {
      transport: fakeTransport(),
    });
    try {
      const frames = devices.deviceLatencyFrames("compressor", runtime.getSampleRate());
      const project = createAlignmentProject("return");
      const { kick, bass, verb } = trackIds(project);
      graph.reconcile(buildAudioProjection(project));
      for (const id of [kick, bass]) {
        expect(graph.trackGraphs.get(id)?.latencyCompensation).toEqual({
          alignFrames: 0,
          outputFrames: frames,
        });
      }
      expect(graph.returnGraphs.get(verb)?.latencyCompensationFrames).toBe(0);
      expect(graph.masterGraph.latencyCompensationFrames).toBe(frames);
    } finally {
      await graph.dispose();
      await runtime.close();
    }
  });
});

/** When the rendered events below start, in seconds: clear of time 0. */
const START_SECONDS = 0.05;
const RENDER_RATE = 22_050;

/**
 * Renders the alignment song's graph offline and returns its left channel:
 * with `source: "notes"` the arrangement's notes play from
 * {@link START_SECONDS}, and with `"metronome"` none do and the same noise
 * burst the sampler plays enters `masterInput` at that time instead, as the
 * metronome's click does live.
 */
async function renderGraph(
  project: Project,
  source: "notes" | "metronome",
): Promise<Float32Array> {
  const burst = noiseBurst(Math.round(RENDER_RATE * 0.05));
  const projection = buildAudioProjection(project);
  const tempo = projection.tempo;
  const rendered = await Tone.Offline(
    async (context) => {
      const registry = new registryModule.ResourceRegistry();
      const owner = "metronome-alignment";
      const scope: import("./AudioRuntime").AudioProjectScope = {
        ownerId: owner,
        register: (type, dispose) => registry.register(owner, type, dispose),
        release: (handle) => registry.disposeOne(handle),
        dispose: async () => {
          await registry.disposeOwner(owner);
        },
      };
      const scheduled: Array<{ callback: (time: number) => void; time: string }> = [];
      const graph = new ProjectAudioGraphModule.ProjectAudioGraph(
        {
          getDestination: () => context.destination,
          getSampleRate: () => RENDER_RATE,
          resume: async () => {},
          openProjectScope: () => scope,
        },
        owner,
        {
          transport: {
            bpm: { value: tempo },
            schedule: (callback, time) => scheduled.push({ callback, time }),
            clear: () => {},
          },
          bufferLoader: { load: async () => Tone.ToneAudioBuffer.fromArray(burst) },
          now: () => context.immediate(),
        },
      );
      graph.reconcile(projection);
      // Let the buffer cache install the decoded burst.
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (source === "notes") {
        // Only the first beat: Kick's downbeat, well before Bass's off-beat.
        for (const { callback, time } of scheduled) {
          const ticks = Number.parseInt(time, 10);
          if (ticks >= TICKS_PER_QUARTER / 2) continue;
          callback(START_SECONDS + (ticks / TICKS_PER_QUARTER) * (60 / tempo));
        }
      } else {
        const player = new Tone.Player(Tone.ToneAudioBuffer.fromArray(burst));
        player.connect(graph.masterInput);
        player.start(START_SECONDS);
      }
    },
    0.2,
    2,
    RENDER_RATE,
  );
  return rendered.getChannelData(0).slice();
}

describe("the metronome's input, rendered", () => {
  it("lands on the beat the tracks do when a track Compressor delays the mix", async () => {
    const frames = devices.deviceLatencyFrames("compressor", RENDER_RATE);
    expect(frames).toBeGreaterThan(0);
    const none = createAlignmentProject("none");
    const kick = createAlignmentProject("kick");
    const maxLag = 4 * frames;

    // Kick's Compressor makes it, and so the whole mix, `frames` late.
    const notesLag = bestLag(
      await renderGraph(none, "notes"),
      await renderGraph(kick, "notes"),
      maxLag,
    );
    expect(notesLag).toBe(frames);

    // The metronome's input is held back by the same frames, so a click on
    // the downbeat still sounds with Kick's downbeat.
    const metronomeLag = bestLag(
      await renderGraph(none, "metronome"),
      await renderGraph(kick, "metronome"),
      maxLag,
    );
    expect(metronomeLag).toBe(notesLag);
  });
});
