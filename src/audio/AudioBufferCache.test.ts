import { describe, expect, it, vi } from "vitest";
import type { AssetId } from "../domain/ids";
import type { AudioAssetProjection } from "../projection/audioProjection";
import {
  type AssetBufferLoader,
  AudioBufferCache,
  type CachedBuffer,
} from "./AudioBufferCache";

/**
 * `AudioBufferCache` never imports Tone (see the module comment); these tests
 * exercise its generation/refcount bookkeeping with a trivial fake buffer and
 * a manually-resolvable loader instead of any Web Audio globals.
 */

class FakeBuffer implements CachedBuffer {
  disposed = false;
  constructor(public readonly label: string) {}
  dispose(): void {
    this.disposed = true;
  }
}

interface PendingLoad {
  asset: AudioAssetProjection;
  resolve: (buffer: FakeBuffer) => void;
  reject: (error: unknown) => void;
}

/** A loader whose promises settle only when the test tells them to. */
function createManualLoader(): {
  loader: AssetBufferLoader<FakeBuffer>;
  pending: PendingLoad[];
} {
  const pending: PendingLoad[] = [];
  const loader: AssetBufferLoader<FakeBuffer> = {
    load(asset) {
      return new Promise((resolve, reject) => {
        pending.push({ asset, resolve, reject });
      });
    },
  };
  return { loader, pending };
}

function asset(
  id: string,
  fingerprint: string,
  overrides: Partial<AudioAssetProjection> = {},
): AudioAssetProjection {
  return {
    id: id as AssetId,
    packId: "pak_AudioBufferCacheTest1" as AudioAssetProjection["packId"],
    packVersion: "1.0.0" as AudioAssetProjection["packVersion"],
    kind: "sample",
    storageRef: `samples/${id}.wav`,
    url: `/samples/${id}.wav`,
    durationSeconds: 1,
    sampleRate: 44_100,
    channelCount: 1,
    fingerprint,
    ...overrides,
  };
}

describe("AudioBufferCache", () => {
  it("resolves the subscriber once the load settles", async () => {
    const { loader, pending } = createManualLoader();
    const cache = new AudioBufferCache(loader);
    const onBuffer = vi.fn();

    cache.subscribe(asset("ast_a", "f1"), onBuffer);
    expect(onBuffer).not.toHaveBeenCalled();

    const buffer = new FakeBuffer("a@f1");
    pending[0].resolve(buffer);
    await Promise.resolve();
    await Promise.resolve();

    expect(onBuffer).toHaveBeenCalledExactlyOnceWith(buffer);
  });

  it("shares one decode across multiple subscribers to the same asset id", async () => {
    const { loader, pending } = createManualLoader();
    const cache = new AudioBufferCache(loader);
    const first = vi.fn();
    const second = vi.fn();

    cache.subscribe(asset("ast_a", "f1"), first);
    cache.subscribe(asset("ast_a", "f1"), second);
    expect(pending).toHaveLength(1);

    const buffer = new FakeBuffer("a@f1");
    pending[0].resolve(buffer);
    await Promise.resolve();
    await Promise.resolve();

    expect(first).toHaveBeenCalledExactlyOnceWith(buffer);
    expect(second).toHaveBeenCalledExactlyOnceWith(buffer);
  });

  it("calls a new subscriber synchronously once a buffer is already decoded", async () => {
    const { loader, pending } = createManualLoader();
    const cache = new AudioBufferCache(loader);
    cache.subscribe(asset("ast_a", "f1"), () => {});
    const buffer = new FakeBuffer("a@f1");
    pending[0].resolve(buffer);
    await Promise.resolve();
    await Promise.resolve();

    const late = vi.fn();
    cache.subscribe(asset("ast_a", "f1"), late);
    expect(late).toHaveBeenCalledExactlyOnceWith(buffer);
  });

  it("re-decodes when an asset's fingerprint changes and notifies existing subscribers with the new buffer", async () => {
    const { loader, pending } = createManualLoader();
    const cache = new AudioBufferCache(loader);
    const onBuffer = vi.fn();

    cache.subscribe(asset("ast_a", "f1"), onBuffer);
    const first = new FakeBuffer("a@f1");
    pending[0].resolve(first);
    await Promise.resolve();
    await Promise.resolve();

    cache.refresh(asset("ast_a", "f2"));
    expect(pending).toHaveLength(2);
    expect(first.disposed).toBe(true);
    // Subscribers must be told the buffer is gone (null) before the
    // replacement decode settles, so nobody holds a disposed buffer.
    expect(onBuffer).toHaveBeenNthCalledWith(2, null);

    const second = new FakeBuffer("a@f2");
    pending[1].resolve(second);
    await Promise.resolve();
    await Promise.resolve();

    expect(onBuffer).toHaveBeenLastCalledWith(second);
  });

  it("notifies subscribers with null before disposing the superseded buffer, not after", async () => {
    const { loader, pending } = createManualLoader();
    const cache = new AudioBufferCache(loader);
    const disposedAtNotifyTime: boolean[] = [];

    const first = new FakeBuffer("a@f1");
    cache.subscribe(asset("ast_a", "f1"), (buffer) => {
      if (buffer === null) disposedAtNotifyTime.push(first.disposed);
    });
    pending[0].resolve(first);
    await Promise.resolve();
    await Promise.resolve();

    cache.refresh(asset("ast_a", "f2"));

    expect(disposedAtNotifyTime).toEqual([false]);
    expect(first.disposed).toBe(true);
  });

  it("never installs or reports a stale-generation load, however late it resolves", async () => {
    const { loader, pending } = createManualLoader();
    const cache = new AudioBufferCache(loader);
    const onBuffer = vi.fn();

    cache.subscribe(asset("ast_a", "f1"), onBuffer);
    // Replace before the first load settles — this is the "replace a
    // sample" race AUD-08 calls out.
    cache.refresh(asset("ast_a", "f2"));
    expect(pending).toHaveLength(2);

    const staleBuffer = new FakeBuffer("stale a@f1");
    const freshBuffer = new FakeBuffer("fresh a@f2");
    // Resolve the *newer* generation first, then the stale one, so a late
    // completion genuinely cannot reconnect or overwrite the newer result.
    pending[1].resolve(freshBuffer);
    await Promise.resolve();
    await Promise.resolve();
    pending[0].resolve(staleBuffer);
    await Promise.resolve();
    await Promise.resolve();

    expect(onBuffer).toHaveBeenCalledTimes(1);
    expect(onBuffer).toHaveBeenCalledWith(freshBuffer);
    expect(staleBuffer.disposed).toBe(true);
    expect(freshBuffer.disposed).toBe(false);
  });

  it("refresh() is a no-op for an unchanged fingerprint — no new load, no re-notification", async () => {
    const { loader, pending } = createManualLoader();
    const cache = new AudioBufferCache(loader);
    const onBuffer = vi.fn();
    cache.subscribe(asset("ast_a", "f1"), onBuffer);
    pending[0].resolve(new FakeBuffer("a@f1"));
    await Promise.resolve();
    await Promise.resolve();

    cache.refresh(asset("ast_a", "f1"));

    expect(pending).toHaveLength(1);
    expect(onBuffer).toHaveBeenCalledTimes(1);
  });

  it("refresh() is a no-op for an asset the cache has no subscriber for", () => {
    const { loader, pending } = createManualLoader();
    const cache = new AudioBufferCache(loader);
    cache.refresh(asset("ast_untracked", "f1"));
    expect(pending).toHaveLength(0);
  });

  it("disposes the buffer once every subscriber releases, and a later subscribe starts a fresh decode", async () => {
    const { loader, pending } = createManualLoader();
    const cache = new AudioBufferCache(loader);
    const first = vi.fn();
    const second = vi.fn();

    const subA = cache.subscribe(asset("ast_a", "f1"), first);
    const subB = cache.subscribe(asset("ast_a", "f1"), second);
    const buffer = new FakeBuffer("a@f1");
    pending[0].resolve(buffer);
    await Promise.resolve();
    await Promise.resolve();

    subA.release();
    expect(buffer.disposed).toBe(false); // subB still holds a reference

    subB.release();
    expect(buffer.disposed).toBe(true);
    expect(cache.diagnostics().cachedAssets).toBe(0);

    const third = vi.fn();
    cache.subscribe(asset("ast_a", "f1"), third);
    expect(pending).toHaveLength(2); // a fresh decode, not the disposed one
  });

  it("release() is idempotent", async () => {
    const { loader, pending } = createManualLoader();
    const cache = new AudioBufferCache(loader);
    const sub = cache.subscribe(asset("ast_a", "f1"), () => {});
    const buffer = new FakeBuffer("a@f1");
    pending[0].resolve(buffer);
    await Promise.resolve();
    await Promise.resolve();

    sub.release();
    sub.release();
    expect(buffer.disposed).toBe(true);
  });

  it("a load that settles after every subscriber already released is disposed and never installed", async () => {
    const { loader, pending } = createManualLoader();
    const cache = new AudioBufferCache(loader);
    const onBuffer = vi.fn();
    const sub = cache.subscribe(asset("ast_a", "f1"), onBuffer);

    sub.release();
    const buffer = new FakeBuffer("a@f1");
    pending[0].resolve(buffer);
    await Promise.resolve();
    await Promise.resolve();

    expect(onBuffer).not.toHaveBeenCalled();
    expect(buffer.disposed).toBe(true);
    expect(cache.diagnostics().cachedAssets).toBe(0);
  });

  it("reports a failed decode as a null buffer and logs the error", async () => {
    const { loader, pending } = createManualLoader();
    const cache = new AudioBufferCache(loader);
    const onBuffer = vi.fn();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    cache.subscribe(asset("ast_a", "f1"), onBuffer);
    pending[0].reject(new Error("decode failed"));
    await Promise.resolve();
    await Promise.resolve();

    expect(onBuffer).toHaveBeenCalledExactlyOnceWith(null);
    expect(consoleError).toHaveBeenCalledOnce();
    consoleError.mockRestore();
  });

  it("reports a failed decode to onLoadFailure once, with the asset and error", async () => {
    const { loader, pending } = createManualLoader();
    const onLoadFailure = vi.fn();
    const cache = new AudioBufferCache(loader, { onLoadFailure });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const failing = asset("ast_a", "f1", { kind: "loop" });
    cache.subscribe(failing, vi.fn());
    const error = new Error("decode failed");
    pending[0].reject(error);
    await Promise.resolve();
    await Promise.resolve();

    expect(onLoadFailure).toHaveBeenCalledExactlyOnceWith(failing, error);
    consoleError.mockRestore();
  });

  it("does not report a stale-generation failure to onLoadFailure", async () => {
    const { loader, pending } = createManualLoader();
    const onLoadFailure = vi.fn();
    const cache = new AudioBufferCache(loader, { onLoadFailure });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const subscription = cache.subscribe(asset("ast_a", "f1"), vi.fn());
    // Release before the load settles: the in-flight decode is now stale.
    subscription.release();
    pending[0].reject(new Error("decode failed"));
    await Promise.resolve();
    await Promise.resolve();

    expect(onLoadFailure).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("tracks pending-load and cached-asset diagnostics", async () => {
    const { loader, pending } = createManualLoader();
    const cache = new AudioBufferCache(loader);
    cache.subscribe(asset("ast_a", "f1"), () => {});
    cache.subscribe(asset("ast_b", "f1"), () => {});

    expect(cache.diagnostics()).toEqual({ cachedAssets: 2, pendingLoads: 2 });

    pending[0].resolve(new FakeBuffer("a"));
    pending[1].resolve(new FakeBuffer("b"));
    await Promise.resolve();
    await Promise.resolve();

    expect(cache.diagnostics()).toEqual({ cachedAssets: 2, pendingLoads: 0 });
  });

  it("dispose() releases every cached buffer and discards any in-flight decode", async () => {
    const { loader, pending } = createManualLoader();
    const cache = new AudioBufferCache(loader);
    const onBuffer = vi.fn();
    cache.subscribe(asset("ast_a", "f1"), onBuffer);
    const readyBuffer = new FakeBuffer("a@f1");
    pending[0].resolve(readyBuffer);
    await Promise.resolve();
    await Promise.resolve();

    cache.subscribe(asset("ast_b", "f1"), () => {});

    cache.dispose();
    expect(readyBuffer.disposed).toBe(true);
    expect(cache.diagnostics().cachedAssets).toBe(0);

    const lateBuffer = new FakeBuffer("b@f1");
    pending[1].resolve(lateBuffer);
    await Promise.resolve();
    await Promise.resolve();
    expect(lateBuffer.disposed).toBe(true);
    expect(onBuffer).toHaveBeenCalledTimes(1); // only its original decode, never re-notified after dispose
  });
});
