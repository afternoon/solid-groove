import * as Tone from "tone";
import type { AssetId } from "../../domain/ids";
import type { BufferSubscription } from "../AudioBufferCache";
import type { AudioProjectScope } from "../AudioRuntime";
import type { InstrumentGraphContext } from "./types";

/**
 * Plays `buffer` once through `destination`, self-disposing once it stops —
 * the "short-lived source node" AUD-08 explicitly permits per note/trigger,
 * as long as its schedule and references don't accumulate after completion.
 *
 * `offsetSeconds` is a position inside the buffer's own timeline, so a clip
 * or placement trimmed at its left edge starts from the material the
 * arrangement draws rather than from sample zero.
 */
export function playOneShot(
  buffer: Tone.ToneAudioBuffer,
  destination: Tone.ToneAudioNode,
  time: Tone.Unit.Time,
  duration: Tone.Unit.Time,
  playbackRate = 1,
  offsetSeconds = 0,
): void {
  const player = new Tone.Player(buffer).connect(destination);
  player.playbackRate = playbackRate;
  player.onstop = () => player.dispose();
  player.start(time, offsetSeconds, duration);
}

/** A live subscription to one asset's decoded buffer, reattachable to a new asset id. */
export interface AssetVoice {
  assetId: AssetId | null;
  buffer: Tone.ToneAudioBuffer | null;
  subscription: BufferSubscription | null;
  subscriptionHandle: ReturnType<AudioProjectScope["register"]> | null;
}

export function createAssetVoice(): AssetVoice {
  return {
    assetId: null,
    buffer: null,
    subscription: null,
    subscriptionHandle: null,
  };
}

export function attachAssetVoice(
  voice: AssetVoice,
  context: InstrumentGraphContext,
  assetId: AssetId | null,
): void {
  voice.subscription?.release();
  voice.subscription = null;
  if (voice.subscriptionHandle) {
    void context.scope.release(voice.subscriptionHandle);
    voice.subscriptionHandle = null;
  }
  voice.buffer = null;
  voice.assetId = assetId;
  if (!assetId) return;

  const asset = context.assetsById.get(assetId);
  if (!asset) return;

  voice.subscriptionHandle = context.scope.register("subscription", () => {});
  voice.subscription = context.bufferCache.subscribe(asset, (buffer) => {
    voice.buffer = buffer;
  });
}

export function releaseAssetVoice(voice: AssetVoice, scope: AudioProjectScope): void {
  voice.subscription?.release();
  voice.subscription = null;
  if (voice.subscriptionHandle) {
    void scope.release(voice.subscriptionHandle);
    voice.subscriptionHandle = null;
  }
  voice.buffer = null;
}

/** Folds a stored 0..1 position into range, guarding a bad projected value. */
export function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** `null` (muted) collapses to silence; otherwise converts the stored decibel value to linear gain. */
export function dbToLinear(db: number | null): number {
  return db === null ? 0 : Tone.dbToGain(db);
}

/** 2^(semitones/12) — a per-pad pitch offset as a playback-rate multiplier. */
export function pitchToPlaybackRate(semitones: number): number {
  return 2 ** (semitones / 12);
}
