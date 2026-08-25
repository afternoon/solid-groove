import { describe, expect, it, vi } from "vitest";
import {
  AuditionController,
  AuditionError,
  auditionsInSync,
  type PreviewEngine,
  type PreviewStartOptions,
  type PreviewVoice,
} from "./audition";
import type { LibraryAsset } from "./manifest";

function asset(overrides: Partial<LibraryAsset> = {}): LibraryAsset {
  return {
    id: "sg-one-shot-drums-kick-0001",
    name: "Kick",
    type: "one-shot",
    family: "drums",
    role: "kick",
    genres: ["house"],
    characters: ["punchy"],
    packId: "pak_test",
    packSlug: "core-electronic-drums",
    packName: "Core Electronic Drums",
    packVersion: "1.0.0",
    url: "/samples/starter-library/audio/x.wav",
    storageKey: "x.wav",
    durationSeconds: 0.5,
    sampleRate: 48000,
    channelCount: 1,
    bpm: null,
    licence: "solid-groove-owned",
    ...overrides,
  };
}

/** A controllable fake engine: each start yields a stoppable voice we can spy on. */
function fakeEngine(): {
  engine: PreviewEngine;
  voices: {
    asset: LibraryAsset;
    options: PreviewStartOptions;
    stop: ReturnType<typeof vi.fn>;
  }[];
  disposed: () => boolean;
  failNext(reason: AuditionError): void;
  resolveDeferred(): void;
  deferNext(): void;
} {
  const voices: {
    asset: LibraryAsset;
    options: PreviewStartOptions;
    stop: ReturnType<typeof vi.fn>;
  }[] = [];
  let failure: AuditionError | null = null;
  let deferred: (() => void) | null = null;
  let deferNextStart = false;
  let isDisposed = false;

  const engine: PreviewEngine = {
    async start(a, options) {
      if (failure) {
        const error = failure;
        failure = null;
        throw error;
      }
      const stop = vi.fn();
      const voice: PreviewVoice = { stop };
      const record = { asset: a, options, stop };
      const make = (): PreviewVoice => {
        voices.push(record);
        return voice;
      };
      if (deferNextStart) {
        deferNextStart = false;
        return new Promise<PreviewVoice>((resolve) => {
          deferred = () => resolve(make());
        });
      }
      return make();
    },
    dispose() {
      isDisposed = true;
    },
  };

  return {
    engine,
    voices,
    disposed: () => isDisposed,
    failNext: (reason) => {
      failure = reason;
    },
    resolveDeferred: () => deferred?.(),
    deferNext: () => {
      deferNextStart = true;
    },
  };
}

describe("sync policy (LIB-01: in sync where appropriate)", () => {
  it("syncs a loop and fires a one-shot immediately", () => {
    expect(auditionsInSync(asset({ type: "loop" }))).toBe(true);
    expect(auditionsInSync(asset({ type: "one-shot" }))).toBe(false);
  });

  it("passes the sync flag to the engine per asset type", async () => {
    const fake = fakeEngine();
    const controller = new AuditionController(fake.engine);
    await controller.play(asset({ type: "loop" }));
    expect(fake.voices[0].options.sync).toBe(true);
    await controller.play(asset({ id: "b", type: "one-shot" }));
    expect(fake.voices[1].options.sync).toBe(false);
  });
});

describe("one preview at a time", () => {
  it("stops the current preview when a new one starts (selection change)", async () => {
    const fake = fakeEngine();
    const controller = new AuditionController(fake.engine);
    await controller.play(asset({ id: "a" }));
    await controller.play(asset({ id: "b" }));
    expect(fake.voices[0].stop).toHaveBeenCalledTimes(1);
    expect(controller.activeAssetId).toBe("b");
  });

  it("reports the active asset through onActiveChange", async () => {
    const onActiveChange = vi.fn();
    const fake = fakeEngine();
    const controller = new AuditionController(fake.engine, { onActiveChange });
    await controller.play(asset({ id: "a" }));
    expect(onActiveChange).toHaveBeenLastCalledWith("a");
    controller.stop();
    expect(onActiveChange).toHaveBeenLastCalledWith(null);
  });
});

describe("stop (close / navigation / teardown)", () => {
  it("stops the active preview", async () => {
    const fake = fakeEngine();
    const controller = new AuditionController(fake.engine);
    await controller.play(asset());
    controller.stop();
    expect(fake.voices[0].stop).toHaveBeenCalledTimes(1);
    expect(controller.activeAssetId).toBeNull();
  });

  it("is idempotent", async () => {
    const fake = fakeEngine();
    const controller = new AuditionController(fake.engine);
    await controller.play(asset());
    controller.stop();
    controller.stop();
    expect(fake.voices[0].stop).toHaveBeenCalledTimes(1);
  });

  it("disposes the engine on dispose and refuses further playback", async () => {
    const fake = fakeEngine();
    const controller = new AuditionController(fake.engine);
    await controller.play(asset());
    await controller.dispose();
    expect(fake.disposed()).toBe(true);
    await controller.play(asset({ id: "later" }));
    expect(controller.activeAssetId).toBeNull();
  });
});

describe("superseded loads", () => {
  it("discards a slow load the user has already moved past", async () => {
    const fake = fakeEngine();
    const controller = new AuditionController(fake.engine);
    fake.deferNext();
    const slow = controller.play(asset({ id: "slow" }));
    // The user stops before the slow decode resolves.
    controller.stop();
    fake.resolveDeferred();
    await slow;
    // The late voice was stopped rather than connected, and nothing is active.
    expect(controller.activeAssetId).toBeNull();
    expect(fake.voices[0].stop).toHaveBeenCalled();
  });
});

describe("failure", () => {
  it("surfaces a decode failure without throwing to the caller", async () => {
    const onError = vi.fn();
    const fake = fakeEngine();
    const controller = new AuditionController(fake.engine, { onError });
    fake.failNext(new AuditionError("decode_failed", "bad audio"));
    await expect(controller.play(asset())).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][1].reason).toBe("decode_failed");
    expect(controller.activeAssetId).toBeNull();
  });

  it("reports an asset with no url as missing without hitting the engine", async () => {
    const onError = vi.fn();
    const start = vi.fn();
    const engine: PreviewEngine = { start, dispose() {} };
    const controller = new AuditionController(engine, { onError });
    await controller.play(asset({ url: null }));
    expect(start).not.toHaveBeenCalled();
    expect(onError.mock.calls[0][1].reason).toBe("asset_missing");
  });
});
