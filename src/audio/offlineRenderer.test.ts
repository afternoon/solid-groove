import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Project } from "../domain/entities";
import {
  createPianoRollFixtureProject,
  createSliceFixtureProject,
} from "../domain/fixtures";
import { stringifyProject } from "../domain/serialize";
import { buildAudioProjection } from "../projection/audioProjection";
import type { Scheduler } from "../shared/scheduler";
import { installWebAudioGlobals, rms } from "./testAudioContext";

// Must run before Tone is imported — see AudioRuntime.test.ts for why.
installWebAudioGlobals();

let Tone: typeof import("tone");
let renderer: typeof import("./offlineRenderer");
let registryModule: typeof import("./resourceRegistry");
let runtimeModule: typeof import("./AudioRuntime");

beforeAll(async () => {
  Tone = await import("tone");
  renderer = await import("./offlineRenderer");
  registryModule = await import("./resourceRegistry");
  runtimeModule = await import("./AudioRuntime");
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await runtimeModule.getAudioRuntime().close();
  runtimeModule.__resetAudioRuntimeForTests();
});

const RATE = 22_050;

/** A loader handing every asset the same short decaying tone. */
function toneLoader() {
  return {
    async load() {
      const data = Float32Array.from(
        { length: 2_205 },
        (_, i) => Math.sin(i / 4) * (1 - i / 2_205),
      );
      return Tone.ToneAudioBuffer.fromArray(data);
    },
  };
}

function nativeContexts(created: OfflineAudioContext[] = []) {
  const construct = (target: typeof OfflineAudioContext, args: unknown[]) =>
    created[created.push(Reflect.construct(target, args)) - 1];
  vi.stubGlobal("OfflineAudioContext", new Proxy(OfflineAudioContext, { construct }));
  return created;
}

async function render(
  project: Project,
  extra: Partial<import("./offlineRenderer").OfflineRenderOptions> = {},
) {
  const registry = new registryModule.ResourceRegistry();
  const outcome = renderer.renderProjectOffline(buildAudioProjection(project), {
    sampleRate: RATE,
    maxTailSeconds: 1,
    bufferLoader: toneLoader(),
    registry,
    ...extra,
  });
  return { outcome, registry };
}

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error as import("./offlineRenderer").OfflineRenderError;
  }
  throw new Error("expected the render to reject");
}

describe("renderProjectOffline", () => {
  it("renders a synth song to stereo audio and releases everything it built", async () => {
    const live = Tone.getContext();
    const progress: number[] = [];
    const { outcome, registry } = await render(createPianoRollFixtureProject(), {
      onProgress: (fraction) => {
        progress.push(fraction);
        // Between the synchronous spans, the live context is the global one.
        expect(Tone.getContext()).toBe(live);
      },
    });
    const result = await outcome;

    expect(result.channels).toHaveLength(2);
    expect(result.sampleRate).toBe(RATE);
    // Two bars at 120 BPM.
    expect(result.songEndSeconds).toBe(4);
    expect(result.frames).toBeGreaterThanOrEqual(4 * RATE);
    expect(rms(result.channels[0])).toBeGreaterThan(0.001);
    expect(progress.at(-1)).toBe(1);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
    expect(registry.isEmpty()).toBe(true);
    expect(Tone.getContext()).toBe(live);
  });

  it("builds sampler voices in the render, not in the live context", async () => {
    const { outcome, registry } = await render(createSliceFixtureProject());
    const result = await outcome;
    // The four-on-the-floor kick only sounds if every voice built inside a
    // scheduled callback landed in the offline graph.
    const beat = RATE / 2; // one beat at 120 BPM
    for (let i = 0; i < 4; i++) {
      const window = result.channels[0].subarray(i * beat, i * beat + 2_000);
      expect(rms(window), `beat ${i + 1}`).toBeGreaterThan(0.01);
    }
    expect(registry.isEmpty()).toBe(true);
  });

  it("renders nothing for a song with nothing placed", async () => {
    const project = createPianoRollFixtureProject();
    const empty = { ...project, song: { ...project.song, placements: [] } };
    const result = await (await render(empty)).outcome;
    expect(result.frames).toBe(0);
    expect(result.channels.map((c) => c.length)).toEqual([0, 0]);
  });

  it("neither mutates the project nor its projection", async () => {
    const project = createSliceFixtureProject();
    const before = stringifyProject(project);
    const projection = deepFreeze(buildAudioProjection(project));
    await renderer.renderProjectOffline(projection, {
      sampleRate: RATE,
      maxTailSeconds: 1,
      bufferLoader: toneLoader(),
    });
    expect(stringifyProject(project)).toBe(before);
  });

  it("leaves a live project graph and the live transport as they were", async () => {
    const runtime = runtimeModule.getAudioRuntime();
    const graphModule = await import("./ProjectAudioGraph");
    const live = new graphModule.ProjectAudioGraph(runtime, "live-project", {
      transport: { bpm: { value: 97 }, schedule: () => 1, clear: () => {} },
      bufferLoader: toneLoader(),
    });
    live.reconcile(buildAudioProjection(createSliceFixtureProject({ tempo: 97 })));
    const liveCounts = runtime.registry.counts();
    const liveBpm = Tone.getTransport().bpm.value;

    await (await render(createPianoRollFixtureProject({ tempo: 150 }))).outcome;

    expect(runtime.registry.counts()).toEqual(liveCounts);
    expect(Tone.getTransport().bpm.value).toBe(liveBpm);
    expect(live.diagnostics().tracks).toBe(1);
    await live.dispose();
  });
});

describe("renderProjectOffline cancellation and failure", () => {
  it("rejects a render cancelled before it starts without building anything", async () => {
    const controller = new AbortController();
    controller.abort();
    const { outcome, registry } = await render(createPianoRollFixtureProject(), {
      signal: controller.signal,
    });
    const error = await rejection(outcome);
    expect(error).toBeInstanceOf(renderer.OfflineRenderError);
    expect(error.code).toBe("aborted");
    expect(error.cancelled).toBe(true);
    expect(registry.snapshot()).toEqual([]);
  });

  it("stops mid-render when cancelled, and releases every offline resource", async () => {
    const live = Tone.getContext();
    const contexts = nativeContexts();
    const controller = new AbortController();
    const yields: unknown[] = [];
    const scheduler: Scheduler = {
      schedule(callback, delayMs) {
        yields.push(Tone.getContext());
        const handle = setTimeout(callback, delayMs);
        return () => clearTimeout(handle);
      },
    };
    const { outcome, registry } = await render(createPianoRollFixtureProject(), {
      // A long tail budget so the clock yields several times.
      maxTailSeconds: 20,
      scheduler,
      signal: controller.signal,
      onProgress: (fraction) => {
        if (fraction > 0.2) controller.abort();
      },
    });
    const error = await rejection(outcome);
    expect(error.code).toBe("aborted");
    expect(registry.isEmpty()).toBe(true);
    expect(contexts.map((context) => context.state)).toEqual(["closed"]);
    expect(yields.length).toBeGreaterThan(0);
    for (const context of yields) expect(context).toBe(live);
    expect(Tone.getContext()).toBe(live);
  });

  it("fails as an internal error mid-render, and still finishes the render", async () => {
    const contexts = nativeContexts();
    const { outcome } = await render(createPianoRollFixtureProject(), {
      maxTailSeconds: 20,
      onProgress: (fraction) => {
        if (fraction > 0.5) throw new Error("bug");
      },
    });
    expect((await rejection(outcome)).code).toBe("internal");
    expect(contexts.map((context) => context.state)).toEqual(["closed"]);
  });

  it("fails with a decode error when an asset will not load, and releases everything", async () => {
    const { outcome, registry } = await render(createSliceFixtureProject(), {
      bufferLoader: {
        load: async () => {
          throw new Error("not audio");
        },
      },
    });
    const error = await rejection(outcome);
    expect(error.code).toBe("decode_failed");
    expect(error.cancelled).toBe(false);
    // Only the asset's id may reach an error report, never its name or URL.
    expect(error.message).not.toMatch(/909|samples\//);
    expect(registry.isEmpty()).toBe(true);
  });

  it("fails as an internal error when the graph cannot be built, and restores the live context", async () => {
    const live = Tone.getContext();
    const { outcome, registry } = await render(createPianoRollFixtureProject(), {
      createInstrument: () => {
        throw new Error("bug");
      },
    });
    const error = await rejection(outcome);
    expect(error.code).toBe("internal");
    expect(registry.isEmpty()).toBe(true);
    expect(Tone.getContext()).toBe(live);
  });
});

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
    if (value instanceof Map) for (const child of value.values()) deepFreeze(child);
  }
  return value;
}
