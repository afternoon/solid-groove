import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Project } from "../domain/entities";
import {
  createPianoRollFixtureProject,
  createSliceFixtureProject,
} from "../domain/fixtures";
import { buildAudioProjection } from "../projection/audioProjection";
import { installWebAudioGlobals } from "./testAudioContext";

// Must run before Tone is imported — see AudioRuntime.test.ts for why.
installWebAudioGlobals();

let Tone: typeof import("tone");
let sessions: typeof import("./offlineSession");
let registryModule: typeof import("./resourceRegistry");

beforeAll(async () => {
  Tone = await import("tone");
  sessions = await import("./offlineSession");
  registryModule = await import("./resourceRegistry");
});

const opened: import("./offlineSession").OfflineSession[] = [];
afterEach(async () => {
  for (const session of opened.splice(0)) await session.release();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function open(
  project: Project,
  extra: Partial<import("./offlineSession").OfflineSessionOptions> = {},
) {
  const registry = new registryModule.ResourceRegistry();
  const session = sessions.openOfflineSession(buildAudioProjection(project), {
    sampleRate: 22_050,
    durationSeconds: 1,
    registry,
    bufferLoader: {
      load: async () => Tone.ToneAudioBuffer.fromArray(new Float32Array(64).fill(0.5)),
    },
    ...extra,
  });
  opened.push(session);
  return { session, registry };
}

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error as import("./offlineSession").OfflineRenderError;
  }
  throw new Error("expected a rejection");
}

describe("openOfflineSession", () => {
  it("builds the project graph on its own context and transport, never the live ones", () => {
    const live = Tone.getContext();
    const liveBpm = Tone.getTransport().bpm.value;
    const { session, registry } = open(createPianoRollFixtureProject({ tempo: 137 }));
    session.build();
    expect(Tone.getContext()).toBe(live);
    expect(session.context).not.toBe(live);
    expect(session.context.transport.bpm.value).toBeCloseTo(137, 6);
    expect(Tone.getTransport().bpm.value).toBe(liveBpm);
    expect(registry.countForOwner(sessions.OFFLINE_OWNER)).toBeGreaterThan(0);
  });

  it("releases every resource it registered, once, however often it is asked", async () => {
    const { session, registry } = open(createSliceFixtureProject());
    session.build();
    await session.prepare();
    await session.release();
    await session.release();
    expect(registry.isEmpty()).toBe(true);
  });

  it("prepares only once every asset has decoded", async () => {
    const decode = deferred<import("tone").ToneAudioBuffer>();
    const { session } = open(createSliceFixtureProject(), {
      bufferLoader: { load: () => decode.promise },
    });
    session.build();
    let prepared = false;
    const preparing = session.prepare().then(() => {
      prepared = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(prepared).toBe(false);
    decode.resolve(Tone.ToneAudioBuffer.fromArray(new Float32Array(64)));
    await preparing;
    expect(prepared).toBe(true);
  });

  it("stops waiting on a hung asset as soon as the render is cancelled", async () => {
    const controller = new AbortController();
    const { session } = open(createSliceFixtureProject(), {
      signal: controller.signal,
      bufferLoader: { load: () => new Promise(() => {}) },
    });
    session.build();
    const preparing = session.prepare();
    controller.abort();
    const error = await rejection(preparing);
    expect(error.code).toBe("aborted");
    expect(error.cancelled).toBe(true);
  });

  it("reports an asset that will not decode, and one with nowhere to load from", async () => {
    const failing = {
      load: async () => {
        throw new Error("not audio");
      },
    };
    const broken = open(createSliceFixtureProject(), { bufferLoader: failing }).session;
    broken.build();
    expect((await rejection(broken.prepare())).code).toBe("decode_failed");

    const project = createSliceFixtureProject();
    const unhosted = {
      ...project,
      song: {
        ...project.song,
        assets: project.song.assets.map((asset) => ({ ...asset, url: null })),
      },
    };
    const missing = open(unhosted, { bufferLoader: failing }).session;
    missing.build();
    const error = await rejection(missing.prepare());
    expect(error.code).toBe("asset_missing");
    expect(error.cancelled).toBe(false);
  });

  it("reports an environment that cannot render offline as not supported", () => {
    let error: unknown;
    try {
      open(createPianoRollFixtureProject(), { sampleRate: 0 });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(sessions.OfflineRenderError);
    expect((error as import("./offlineSession").OfflineRenderError).code).toBe(
      "not_supported",
    );
  });
});
