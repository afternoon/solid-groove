import type { AssetId } from "../domain/ids";
import type { AudioAssetProjection } from "../projection/audioProjection";

/**
 * Buffer cache keyed by asset ID and revision (PRD AUD-08, section 9.7:
 * "Decoded buffers are cached by asset identity and source revision with
 * reference-counted or otherwise deterministic eviction").
 *
 * Deliberately generic over the decoded buffer type rather than importing
 * Tone directly: this module never touches Tone or Web Audio, so its
 * generation/refcount bookkeeping — the part that has to be exactly right for
 * "no stale-load reconnection" — is tested with a trivial fake loader and no
 * Web Audio globals at all. `toneBufferLoader.ts` supplies the real loader
 * used everywhere in production.
 */
export interface CachedBuffer {
  dispose(): void;
}

export interface AssetBufferLoader<B extends CachedBuffer = CachedBuffer> {
  load(asset: AudioAssetProjection): Promise<B>;
}

export interface BufferSubscription {
  /** Stop receiving updates and release this consumer's reference. Idempotent. */
  release(): void;
}

/** One asset's cache bookkeeping. Mutated in place rather than replaced, so a
 * subscriber's `release()` — captured against this same object — always
 * decrements the refcount that its `subscribe()` incremented, even across a
 * fingerprint change in between. */
interface AssetTracker<B extends CachedBuffer> {
  refCount: number;
  listeners: Set<(buffer: B | null) => void>;
  fingerprint: string | null;
  /** Bumped every time the tracked fingerprint changes or the tracker is
   * fully released. A load whose generation no longer matches when it
   * settles is stale and is discarded rather than installed or reported. */
  generation: number;
  buffer: B | null;
}

export interface AudioBufferCacheDiagnostics {
  cachedAssets: number;
  pendingLoads: number;
}

/**
 * Called once for each decode attempt that fails and is still current when it
 * settles. It carries the asset the load was for and the caught reason so the
 * owner can classify it (missing vs. undecodable) and emit `asset_load_failed`
 * (PRD OPS-02, LOOP-006/LOOP-013). A load superseded by a replace or release
 * before it settled is *not* reported — a stale failure is not a user-visible
 * failure. Deliberately fired at most once per load attempt, since the cache
 * never auto-retries a failed decode, so the event cannot fan out per frame.
 */
export type BufferLoadFailureListener = (
  asset: AudioAssetProjection,
  error: unknown,
) => void;

export interface AudioBufferCacheOptions {
  onLoadFailure?: BufferLoadFailureListener;
}

export class AudioBufferCache<B extends CachedBuffer = CachedBuffer> {
  private readonly trackers = new Map<AssetId, AssetTracker<B>>();
  private pendingLoads = 0;
  private readonly onLoadFailure?: BufferLoadFailureListener;

  constructor(
    private readonly loader: AssetBufferLoader<B>,
    options: AudioBufferCacheOptions = {},
  ) {
    this.onLoadFailure = options.onLoadFailure;
  }

  /**
   * Subscribe to the decoded buffer for `asset`. `onBuffer` runs synchronously
   * if a buffer is already decoded at this fingerprint; otherwise it runs
   * once decoding settles, and again any time this same asset id's content
   * changes underneath the subscription (e.g. a replaced sample). Multiple
   * subscribers to one asset id share a single decode and a single buffer.
   */
  subscribe(
    asset: AudioAssetProjection,
    onBuffer: (buffer: B | null) => void,
  ): BufferSubscription {
    const tracker = this.trackerFor(asset);
    tracker.refCount += 1;
    tracker.listeners.add(onBuffer);
    if (tracker.buffer !== null) onBuffer(tracker.buffer);

    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        tracker.listeners.delete(onBuffer);
        tracker.refCount = Math.max(0, tracker.refCount - 1);
        if (tracker.refCount === 0) {
          if (this.trackers.get(asset.id) === tracker) {
            this.trackers.delete(asset.id);
          }
          // Bumping the generation here (not just on delete-from-map) means
          // a load already in flight for this tracker is recognized as
          // stale even if a *new* tracker for the same asset id gets
          // created before that load settles.
          tracker.generation += 1;
          tracker.buffer?.dispose();
          tracker.buffer = null;
        }
      },
    };
  }

  /**
   * Re-checks `asset` against the cache and starts a reload if its
   * fingerprint has changed since it was last decoded. A no-op for an asset
   * this cache has no tracker for, or whose fingerprint is unchanged — so
   * calling this for every known asset on every project reconcile pass never
   * causes unrelated churn.
   */
  refresh(asset: AudioAssetProjection): void {
    const tracker = this.trackers.get(asset.id);
    if (tracker) this.syncFingerprint(tracker, asset);
  }

  private trackerFor(asset: AudioAssetProjection): AssetTracker<B> {
    let tracker = this.trackers.get(asset.id);
    if (!tracker) {
      tracker = {
        refCount: 0,
        listeners: new Set(),
        fingerprint: null,
        generation: 0,
        buffer: null,
      };
      this.trackers.set(asset.id, tracker);
    }
    this.syncFingerprint(tracker, asset);
    return tracker;
  }

  private syncFingerprint(tracker: AssetTracker<B>, asset: AudioAssetProjection): void {
    if (tracker.fingerprint === asset.fingerprint) return;

    const previousBuffer = tracker.buffer;
    tracker.buffer = null;
    tracker.fingerprint = asset.fingerprint;
    tracker.generation += 1;
    const generation = tracker.generation;

    if (previousBuffer) {
      // Tell every subscriber the buffer is gone *before* disposing it, so
      // a consumer never holds a reference to a disposed buffer while the
      // replacement decode is in flight (PRD AUD-09: no use-after-dispose).
      // Skipped when there was no buffer yet (e.g. a refresh() that lands
      // while the first decode is still in flight) — there is nothing to
      // invalidate and no spurious null notification to send.
      for (const listener of tracker.listeners) listener(null);
      previousBuffer.dispose();
    }

    this.pendingLoads += 1;
    this.loader.load(asset).then(
      (buffer) => {
        this.pendingLoads -= 1;
        if (tracker.generation !== generation) {
          // Superseded by a replace or a full release before this decode
          // settled — never install or report a stale-generation result.
          buffer.dispose();
          return;
        }
        tracker.buffer = buffer;
        for (const listener of tracker.listeners) listener(buffer);
      },
      (error: unknown) => {
        this.pendingLoads -= 1;
        if (tracker.generation !== generation) return;
        console.error(`AudioBufferCache: failed to load asset "${asset.id}"`, error);
        for (const listener of tracker.listeners) listener(null);
        // Report after notifying subscribers so the graph has already
        // dropped the (now-null) buffer before the owner reacts to the
        // failure. Fired at most once per load attempt — see
        // `BufferLoadFailureListener`.
        this.onLoadFailure?.(asset, error);
      },
    );
  }

  /** Diagnostics (PRD AUD-09): cached asset count and in-flight decode count. */
  diagnostics(): AudioBufferCacheDiagnostics {
    return {
      cachedAssets: this.trackers.size,
      pendingLoads: this.pendingLoads,
    };
  }

  /** Release every cached buffer and forget every asset. Idempotent. */
  dispose(): void {
    for (const tracker of this.trackers.values()) {
      tracker.generation += 1;
      tracker.buffer?.dispose();
      tracker.buffer = null;
      tracker.listeners.clear();
    }
    this.trackers.clear();
  }
}
