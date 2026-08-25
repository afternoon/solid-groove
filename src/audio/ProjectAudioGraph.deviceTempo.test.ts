import { beforeAll, describe, expect, it } from "vitest";
import { createDevice } from "../domain/devices";
import type { Project } from "../domain/entities";
import { createSliceFixtureProject } from "../domain/fixtures";
import type { DeviceId } from "../domain/ids";
import { buildAudioProjection } from "../projection/audioProjection";
import { installWebAudioGlobals } from "./testAudioContext";

// Must run before Tone is imported — see AudioRuntime.test.ts for why.
installWebAudioGlobals();

let AudioRuntimeModule: typeof import("./AudioRuntime");
let ProjectAudioGraphModule: typeof import("./ProjectAudioGraph");

beforeAll(async () => {
  AudioRuntimeModule = await import("./AudioRuntime");
  ProjectAudioGraphModule = await import("./ProjectAudioGraph");
});

function fakeTransport(): import("./ProjectAudioGraph").AudioTransport {
  let nextId = 1;
  return {
    bpm: { value: 120 },
    schedule: () => nextId++,
    clear: () => {},
  };
}

/**
 * The slice fixture with one tempo-synced delay on its first track, at `tempo`
 * BPM. The delay is fully defaulted: `sync: 1` and `division: 3` (a 1/8 note),
 * so its resolved time is one eighth of `240 / tempo` seconds — 0.25 s at 120
 * BPM, 0.5 s at 60.
 */
const DELAY_ID = "dev_delay" as DeviceId;

function projectWithDelay(tempo: number): Project {
  const base = createSliceFixtureProject();
  const delay = createDevice(DELAY_ID, "delay", 0);
  return {
    ...base,
    song: {
      ...base.song,
      tempo,
      tracks: base.song.tracks.map((track, index) =>
        index === 0 ? { ...track, devices: [delay] } : track,
      ),
    },
  };
}

/**
 * The delay time the first track's delay device has actually resolved to, in
 * seconds, read off the live Web Audio param.
 *
 * This walks the real graph rather than a double on purpose. Every tempo
 * assertion in `devices/delay.test.ts` calls the pure `delaySeconds(values,
 * tempo)` with an explicit tempo argument — correct in isolation, but it would
 * pass unchanged with the graph's tempo wiring entirely broken. What is under
 * test here is precisely that wiring: whether a tempo change reaches a device's
 * `apply()` at all, and which tempo it reads when it does.
 */
function resolvedDelaySeconds(
  graph: import("./ProjectAudioGraph").ProjectAudioGraph,
  trackId: import("../domain/ids").TrackId,
): number {
  const track = graph.trackGraphs.get(trackId);
  if (!track) throw new Error("no track graph");
  const node = track.deviceNode(DELAY_ID);
  if (!node) throw new Error("no delay device node in the chain");
  const resolved = node.resolvedDelaySeconds?.();
  if (resolved === undefined) {
    throw new Error("the delay node exposes no resolved time");
  }
  return resolved;
}

describe("ProjectAudioGraph device tempo wiring (FX-01)", () => {
  it("builds a synced delay against the project's own tempo, not the 120 BPM default", async () => {
    const runtime = new AudioRuntimeModule.AudioRuntime();
    const graph = new ProjectAudioGraphModule.ProjectAudioGraph(runtime, "p", {
      transport: fakeTransport(),
    });
    const project = projectWithDelay(60);

    graph.reconcile(buildAudioProjection(project));

    // A 1/8 note at 60 BPM is 0.5 s. Reading the default 120 would give 0.25 —
    // every synced delay in a non-120 project silently on the wrong grid.
    expect(resolvedDelaySeconds(graph, project.song.tracks[0].id)).toBeCloseTo(0.5, 4);

    await graph.dispose();
    await runtime.close();
  });

  it("moves a synced delay onto the new grid when only the tempo changed", async () => {
    const runtime = new AudioRuntimeModule.AudioRuntime();
    const graph = new ProjectAudioGraphModule.ProjectAudioGraph(runtime, "p", {
      transport: fakeTransport(),
    });
    const project = projectWithDelay(120);
    const trackId = project.song.tracks[0].id;

    const before = buildAudioProjection(project);
    graph.reconcile(before);
    expect(resolvedDelaySeconds(graph, trackId)).toBeCloseTo(0.25, 4);

    const slower: Project = {
      ...project,
      song: { ...project.song, tempo: 60 },
    };
    const after = buildAudioProjection(slower, before);

    // The defect this guards: a tempo-only edit changes no track, so the audio
    // projection reuses the track projection object *by reference* and every
    // per-entity short-circuit between here and the device chain would
    // otherwise swallow the change outright.
    expect(after.tracks[0]).toBe(before.tracks[0]);

    graph.reconcile(after);

    // A 1/8 note at 60 BPM, and read as the value `apply()` resolved rather
    // than the live param, which is only *ramping* toward it after an edit.
    expect(resolvedDelaySeconds(graph, trackId)).toBeCloseTo(0.5, 4);

    await graph.dispose();
    await runtime.close();
  });
});
