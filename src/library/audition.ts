import type { LibraryAsset } from "./manifest";

/**
 * Sync-aware audition of a single library asset through the shared audio runtime
 * (PRD LIB-01: "The user can search, filter, and audition an asset in sync where
 * appropriate. Audition stops cleanly and does not become part of export.";
 * sample-library section 12).
 *
 * The controller here is deliberately framework- and Tone-free: it owns the
 * *policy* — one preview at a time, sync where it matters, a coded failure when
 * an asset cannot load, and a stop that is idempotent — over a {@link PreviewEngine}
 * that owns the *audio*. The Tone-backed engine ({@link ToneAuditionEngine},
 * built by the browser) plays through the runtime's shared destination, never
 * an offline/export context, and registers its nodes with a runtime project
 * scope so teardown is instrumented and idempotent (PRD AUD-07/AUD-09).
 *
 * Because the controller is pure over the engine, every rule the AC pins is a
 * unit test with no Web Audio at all: starting a second preview stops the first,
 * `stop()` is idempotent, a load failure surfaces a reason, and a decode error
 * never leaves a dangling voice.
 */

/** Why an audition could not start — mapped to an analytics `error_code`. */
export type AuditionFailureReason =
  | "asset_missing"
  | "decode_failed"
  | "network"
  | "timeout";

export class AuditionError extends Error {
  constructor(
    readonly reason: AuditionFailureReason,
    message: string,
  ) {
    super(message);
    this.name = "AuditionError";
  }
}

/** One playing (or loading) preview voice, stoppable once. */
export interface PreviewVoice {
  /** Stop and dispose this voice. Idempotent. */
  stop(): void;
}

/**
 * The audio side of audition, injected so the controller's policy is testable
 * without Tone. `start` resolves when the voice is playing (or throws an
 * {@link AuditionError} if the asset cannot be decoded), and the returned voice
 * stops that one preview.
 */
export interface PreviewEngine {
  start(asset: LibraryAsset, options: PreviewStartOptions): Promise<PreviewVoice>;
  /** Dispose every resource this engine owns (its runtime scope). Idempotent. */
  dispose(): Promise<void> | void;
}

export interface PreviewStartOptions {
  /**
   * True when the preview should lock to the transport grid rather than start
   * immediately — appropriate for a loop, so it drops in on the beat, but not
   * for a one-shot, which a producer expects to fire the instant they click it.
   */
  readonly sync: boolean;
}

/** Whether an asset auditions in sync (LIB-01: "in sync where appropriate"). */
export function auditionsInSync(asset: LibraryAsset): boolean {
  return asset.type === "loop";
}

export interface AuditionCallbacks {
  /** The asset whose preview is now audible (or `null` when stopped). */
  readonly onActiveChange?: (assetId: string | null) => void;
  readonly onError?: (asset: LibraryAsset, error: AuditionError) => void;
}

/**
 * Owns the "one preview at a time" audition surface for the browser.
 *
 * A new {@link play} stops the current preview before starting the next, so a
 * selection change never stacks two voices; {@link stop} silences whatever is
 * playing and is safe to call on close, navigation, or project teardown; and
 * {@link dispose} tears the whole thing down through the engine's runtime scope.
 * A load that is superseded before it becomes audible is discarded rather than
 * connected, so a fast click-through never leaves a late decode playing.
 */
export class AuditionController {
  private voice: PreviewVoice | null = null;
  private activeId: string | null = null;
  /** Monotonic token; a resolved load whose token is stale is discarded. */
  private generation = 0;
  private disposed = false;

  constructor(
    private readonly engine: PreviewEngine,
    private readonly callbacks: AuditionCallbacks = {},
  ) {}

  get activeAssetId(): string | null {
    return this.activeId;
  }

  /**
   * Audition one asset. Stops the current preview first, then starts this one,
   * synced when {@link auditionsInSync} says so. A decode/network failure is
   * reported through `onError` and leaves nothing playing — it never throws to
   * the caller, because a browser click must not surface an exception.
   */
  async play(asset: LibraryAsset): Promise<void> {
    if (this.disposed) return;
    this.stop();
    if (!asset.url) {
      this.callbacks.onError?.(
        asset,
        new AuditionError("asset_missing", `Asset "${asset.id}" has no audio`),
      );
      return;
    }
    const token = ++this.generation;
    try {
      const voice = await this.engine.start(asset, {
        sync: auditionsInSync(asset),
      });
      if (this.disposed || token !== this.generation) {
        // Superseded by a newer play/stop before this decode finished. Discard
        // the voice rather than connecting a preview the user has moved past.
        voice.stop();
        return;
      }
      this.voice = voice;
      this.activeId = asset.id;
      this.callbacks.onActiveChange?.(asset.id);
    } catch (error) {
      if (token !== this.generation) return;
      const auditionError =
        error instanceof AuditionError
          ? error
          : new AuditionError("decode_failed", messageOf(error));
      this.callbacks.onError?.(asset, auditionError);
    }
  }

  /** Silence the current preview. Idempotent; safe on close/navigation/teardown. */
  stop(): void {
    // Bump the generation so any in-flight load is discarded when it resolves.
    this.generation++;
    if (this.voice) {
      this.voice.stop();
      this.voice = null;
    }
    if (this.activeId !== null) {
      this.activeId = null;
      this.callbacks.onActiveChange?.(null);
    }
  }

  /** Tear down the audition surface and its engine's runtime scope. */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    await this.engine.dispose();
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Audition failed";
}
