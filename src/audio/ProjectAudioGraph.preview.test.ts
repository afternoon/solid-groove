import type * as Tone from "tone";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { packVersion } from "../domain/entities";
import { createSliceFixtureProject } from "../domain/fixtures";
import type { PackId } from "../domain/ids";
import { buildAudioProjection } from "../projection/audioProjection";
import { applyPreviewOverride, type PreviewSound } from "../projection/previewOverride";
import type { AssetBufferLoader } from "./AudioBufferCache";
import { installWebAudioGlobals } from "./testAudioContext";

installWebAudioGlobals();

let AudioRuntimeModule: typeof import("./AudioRuntime");
let ProjectAudioGraphModule: typeof import("./ProjectAudioGraph");

beforeAll(async () => {
  AudioRuntimeModule = await import("./AudioRuntime");
  ProjectAudioGraphModule = await import("./ProjectAudioGraph");
});

afterEach(async () => {
  try {
    await AudioRuntimeModule.getAudioRuntime().close();
  } catch {
    // already closed
  }
  AudioRuntimeModule.__resetAudioRuntimeForTests();
});

function sound(name: string): PreviewSound {
  return {
    packId: "pak_previewpreviewpreview" as PackId,
    packVersion: packVersion("1.0.0"),
    kind: "sample",
    storageRef: `library/audio/${name}.wav`,
    url: `/library/audio/${name}.wav`,
    durationSeconds: 0.5,
    sampleRate: 48_000,
    channelCount: 1,
  };
}

function manualLoader() {
  const pending: { storageRef: string; resolve: () => void }[] = [];
  const disposed: string[] = [];
  const loader: AssetBufferLoader<Tone.ToneAudioBuffer> = {
    load(asset) {
      return new Promise((resolve) => {
        pending.push({
          storageRef: asset.storageRef,
          resolve: () =>
            resolve({
              dispose: () => disposed.push(asset.storageRef),
            } as unknown as Tone.ToneAudioBuffer),
        });
      });
    },
  };
  const settle = async (storageRef: string) => {
    for (const load of pending) if (load.storageRef === storageRef) load.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };
  return { loader, disposed, settle };
}

function setup() {
  const runtime = new AudioRuntimeModule.AudioRuntime();
  const { loader, disposed, settle } = manualLoader();
  const graph = new ProjectAudioGraphModule.ProjectAudioGraph(runtime, "p", {
    bufferLoader: loader,
    transport: { bpm: { value: 120 }, schedule: () => 1, clear: () => {} },
  });
  const base = buildAudioProjection(createSliceFixtureProject());
  const slot = { trackId: base.tracks[0].id };
  const own = base.assets[0].storageRef;
  return { graph, base, slot, own, disposed, settle };
}

describe("hot-swap preview through the graph", () => {
  it("loads the previewed sound, and releases it when the override is cleared", async () => {
    const { graph, base, slot, own, disposed, settle } = setup();
    graph.reconcile(base);
    await settle(own);

    graph.reconcile(applyPreviewOverride(base, { slot, sound: sound("snare") }));
    await settle(sound("snare").storageRef);
    expect(graph.diagnostics().buffers.cachedAssets).toBe(1);
    expect(disposed).toEqual([own]);

    graph.reconcile(applyPreviewOverride(base, null));
    await settle(own);
    expect(disposed).toEqual([own, sound("snare").storageRef]);
    expect(graph.diagnostics().buffers.cachedAssets).toBe(1);

    await graph.dispose();
  });

  it("never lets a decode for a sound already stepped past land", async () => {
    const { graph, base, slot, own, disposed, settle } = setup();
    graph.reconcile(base);
    await settle(own);

    graph.reconcile(applyPreviewOverride(base, { slot, sound: sound("slow") }));
    graph.reconcile(applyPreviewOverride(base, { slot, sound: sound("fast") }));
    await settle(sound("fast").storageRef);
    // The slow decode finishes after the producer stepped on: it is discarded.
    await settle(sound("slow").storageRef);

    expect(disposed).toContain(sound("slow").storageRef);
    expect(disposed).not.toContain(sound("fast").storageRef);
    expect(graph.diagnostics().buffers.cachedAssets).toBe(1);

    await graph.dispose();
  });
});
