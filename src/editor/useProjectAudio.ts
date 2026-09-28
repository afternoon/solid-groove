import { type Accessor, createEffect, createSignal, onCleanup } from "solid-js";
import { type Analytics, analytics as defaultAnalytics } from "../analytics/analytics";
import type { BufferSubscription } from "../audio/AudioBufferCache";
import { type AudioHost, getAudioRuntime } from "../audio/AudioRuntime";
import { ProjectAudioGraph } from "../audio/ProjectAudioGraph";
import {
  type LoopRange,
  liveTransportEngine,
  TransportController,
  TransportMetronome,
} from "../audio/Transport";
import { createTriggerFeed } from "../audio/triggerFeed";
import { UnderrunMonitor } from "../audio/underrun";
import type { NoteTrigger, Project } from "../domain/entities";
import type { AssetId, PadId, TrackId } from "../domain/ids";
import { CodedError, codeFor, reportError } from "../monitoring/errorReporting";
import type { AudioAssetProjection } from "../projection/audioProjection";
import {
  type AudioSongProjection,
  buildAudioProjection,
} from "../projection/audioProjection";
import { createTrackLevels, type TrackLevel } from "./trackLevels";

/**
 * Maps an asset's library kind to the `asset_load_failed` `asset_type` value
 * (PRD OPS-02). A `loop` asset is a tempo-labelled loop; a `sample` or
 * `recording` plays as a pitched one-shot, so both report `one_shot`.
 */
function assetLoadFailureType(kind: string): "one_shot" | "loop" | "instrument_preset" {
  return kind === "loop" ? "loop" : "one_shot";
}

export interface ProjectAudioControls {
  readonly isPlaying: Accessor<boolean>;
  /** The playhead position in ticks, updated per animation frame while playing. */
  readonly positionTicks: Accessor<number>;
  /**
   * The song's loop as the transport is currently obeying it. Read-only: the
   * loop is song state, changed only by the `loop.*` commands (see
   * `loopActions.ts`), and mirrored onto the transport on every project change.
   */
  readonly loopEnabled: Accessor<boolean>;
  readonly loop: Accessor<LoopRange | null>;
  readonly metronomeEnabled: Accessor<boolean>;
  play(): Promise<void>;
  pause(): void;
  stop(): void;
  toggle(): Promise<void>;
  /** Resume from where playback last stopped (KEY-01 `transport.continue`). */
  continueFromStop(): Promise<void>;
  seekTicks(ticks: number): void;
  /**
   * A track's post-fader level, reactively, or `null` when it is not sounding
   * (PRD TRK-02, #447). Every track's meter is read once per frame while the
   * transport plays, in the same loop as the playhead, so a view's meters
   * cost no loop of their own; reading a meter emits no telemetry.
   */
  trackLevel(trackId: TrackId): TrackLevel | null;
  toggleMetronome(): void;
  /**
   * Plays one drum pad immediately (a panel audition, PRD INS-01). It resumes
   * the shared audio context behind the click, so the first audition is a valid
   * user-gesture unlock just like `play()`.
   */
  auditionPad(trackId: TrackId, padId: PadId): Promise<void>;
  /**
   * Plays one note through a track's instrument for auditioning (PRD INS-01).
   * Resumes the shared context behind the calling user gesture, then triggers
   * the sound through the track's own chain. Resolves whether a note was
   * triggered; a browser-blocked unlock reports `audio_start_failed` and
   * resolves `false`, like `play()`.
   */
  auditionTrack(
    trackId: TrackId,
    trigger: NoteTrigger,
    durationTicks: number,
    velocity: number,
  ): Promise<boolean>;
  /**
   * Follows the waveform of one of the project's sounds for drawing it (#447):
   * `onPeaks` gets `buckets` peaks, 0..1, once the engine has decoded the sound
   * to play it, and again whenever it changes. Returns the way to stop. Safe to
   * call before the graph exists or the asset is in the song; it attaches as
   * soon as both are there.
   */
  watchAssetPeaks(
    assetId: AssetId,
    buckets: number,
    onPeaks: (peaks: Float32Array | null) => void,
  ): () => void;
  /**
   * Follows one track's instrument triggers as they are heard, scheduled or
   * auditioned, so a view can show what is playing (#447). Returns the way to
   * stop.
   */
  watchTriggers(trackId: TrackId, onTrigger: (trigger: NoteTrigger) => void): () => void;
}

export interface UseProjectAudioOptions {
  /** Defaults to the application's single `AudioRuntime`; injectable for tests. */
  readonly runtime?: AudioHost;
  readonly analytics?: Analytics;
  /** Overrides the animation-frame scheduler used to advance the playhead. */
  readonly requestFrame?: (callback: () => void) => number;
  readonly cancelFrame?: (handle: number) => void;
  /**
   * How long to wait for the user-gesture unlock before treating it as a
   * browser-blocked refusal (PRD OPS-02 / issue #43). Firefox under a blocked
   * autoplay policy never settles `Tone.start()`'s context resume, so without a
   * bound the play button would silently do nothing forever. Defaults to
   * {@link DEFAULT_RESUME_TIMEOUT_MS}; injectable so tests can drive the
   * never-settling path deterministically.
   */
  readonly resumeTimeoutMs?: number;
  /** Overrides the timer used to bound the unlock; injectable for tests. */
  readonly setTimer?: (callback: () => void, delayMs: number) => number;
  readonly clearTimer?: (handle: number) => void;
}

/**
 * The unlock timeout. Long enough that a genuinely slow-but-succeeding resume
 * on a healthy browser still wins the race, short enough that a user staring at
 * a dead play button gets actionable feedback rather than an indefinite hang.
 */
export const DEFAULT_RESUME_TIMEOUT_MS = 5_000;

/**
 * True until the first play of the analytics session, across projects. Module
 * scope (not per-hook) so opening a second project in the same tab does not
 * reset `is_first_play_in_session` (PRD OPS-02).
 */
let firstPlayInSession = true;

/** Test-only: reset the session-first-play flag between tests. */
export function __resetFirstPlayInSessionForTests(): void {
  firstPlayInSession = true;
}

/**
 * Wires one project onto the stable, ID-keyed audio graph, the single shared
 * `AudioRuntime`, and the transport (PRD AUD-01..AUD-04, AUD-07/AUD-08).
 *
 * `project()` changing reconciles the existing `ProjectAudioGraph` — an
 * unrelated edit never rebuilds nodes it did not touch — and only a change of
 * project *id* disposes the previous graph and opens a new scope. The song's
 * tempo is mirrored onto the transport on every reconcile, so a tempo command
 * re-times the schedule without restarting the song (PRD AUD-02).
 *
 * `play()` is the allowed user gesture that resumes the runtime's context and
 * emits `transport_play`; a browser refusal is reported as `audio_start_failed`
 * (PRD OPS-02). The playhead follows via animation frames, but every audible
 * event is scheduled ahead of time by the graph, and late dispatches are
 * sampled into `audio_underrun` — playback emits nothing per scheduled event or
 * per frame (PRD AUD-03/OPS-02).
 */
export function useProjectAudio(
  project: Accessor<Project | null>,
  options: UseProjectAudioOptions = {},
): ProjectAudioControls {
  const runtime = options.runtime ?? getAudioRuntime();
  const analytics = options.analytics ?? defaultAnalytics;
  const requestFrame =
    options.requestFrame ??
    ((callback) =>
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame(() => callback())
        : (setTimeout(callback, 16) as unknown as number));
  const cancelFrame =
    options.cancelFrame ??
    ((handle) => {
      if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(handle);
      else clearTimeout(handle);
    });
  const resumeTimeoutMs = options.resumeTimeoutMs ?? DEFAULT_RESUME_TIMEOUT_MS;
  const setTimer =
    options.setTimer ??
    ((callback, delayMs) => setTimeout(callback, delayMs) as unknown as number);
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle));

  const [isPlaying, setIsPlaying] = createSignal(false);
  const [positionTicks, setPositionTicks] = createSignal(0);
  const [loopEnabled, setLoopEnabled] = createSignal(false);
  const [loop, setLoop] = createSignal<LoopRange | null>(null);
  const [metronomeEnabled, setMetronomeEnabled] = createSignal(false);
  const levels = createTrackLevels();

  let graph: ProjectAudioGraph | null = null;
  let transport: TransportController | null = null;
  let metronome: TransportMetronome | null = null;
  let ownerId: string | null = null;
  let lastProjection: AudioSongProjection | undefined;
  let frameHandle: number | null = null;

  function underrunMonitor(): UnderrunMonitor {
    return new UnderrunMonitor({
      contextSampleRate: runtime.getSampleRate(),
      emit: (report) => {
        analytics.log("audio_underrun", {
          dropped_event_bucket: report.droppedEventBucket,
          sample_rate: report.sampleRate,
        });
      },
    });
  }

  /**
   * A loop or sample the graph needed could not be decoded or is missing
   * (PRD OPS-02, LOOP-006). Emitted once per failed load attempt by the buffer
   * cache; the error is classified into an actionable code and the asset's
   * library kind into an `asset_type`. Carries no URL, storage ref, or asset
   * name — those are project/content strings the OPS-02 catalog keeps out of
   * telemetry.
   */
  function reportAssetLoadFailure(asset: AudioAssetProjection, error: unknown): void {
    analytics.log("asset_load_failed", {
      asset_type: assetLoadFailureType(asset.kind),
      error_code: codeFor(error),
    });
  }

  interface PeakWatcher {
    readonly assetId: AssetId;
    readonly buckets: number;
    readonly onPeaks: (peaks: Float32Array | null) => void;
    subscription?: BufferSubscription;
    /** The projection entry the subscription follows, while it has one. */
    asset?: AudioAssetProjection;
  }
  const peakWatchers = new Set<PeakWatcher>();

  /**
   * Points every peak watcher at the sound the graph carries now: a watcher
   * whose sound arrived attaches, one whose sound changed follows the new
   * entry, and one whose sound left the song lets its buffer go until it
   * returns. The projection shares unchanged entries, so identity is change.
   */
  function attachPeakWatchers(): void {
    if (!graph || !lastProjection) return;
    const assets = new Map(lastProjection.assets.map((entry) => [entry.id, entry]));
    for (const watcher of peakWatchers) {
      const asset = assets.get(watcher.assetId);
      if (asset === watcher.asset) continue;
      watcher.subscription?.release();
      watcher.subscription = asset
        ? graph.watchAssetPeaks(asset, watcher.buckets, watcher.onPeaks)
        : undefined;
      watcher.asset = asset;
    }
  }

  function watchAssetPeaks(
    assetId: AssetId,
    buckets: number,
    onPeaks: (peaks: Float32Array | null) => void,
  ): () => void {
    const watcher: PeakWatcher = { assetId, buckets, onPeaks };
    peakWatchers.add(watcher);
    attachPeakWatchers();
    return () => {
      peakWatchers.delete(watcher);
      watcher.subscription?.release();
    };
  }

  // What is playing, for the views that show it (#447). The feed outlives any
  // one graph: a view's subscription survives a project switch, and only the
  // deliveries still waiting on the old graph are dropped with it.
  const triggers = createTriggerFeed();
  let stopGraphTriggers: (() => void) | null = null;

  function watchTriggers(
    trackId: TrackId,
    onTrigger: (trigger: NoteTrigger) => void,
  ): () => void {
    return triggers.subscribe(trackId, onTrigger);
  }

  function tearDown(): void {
    stopGraphTriggers?.();
    stopGraphTriggers = null;
    triggers.cancelPending();
    // The graph's buffer cache goes with it; watchers reattach to the next one.
    for (const watcher of peakWatchers) {
      watcher.subscription?.release();
      watcher.subscription = undefined;
      watcher.asset = undefined;
    }
    stopFrameLoop();
    metronome?.dispose();
    metronome = null;
    transport = null;
    void graph?.dispose();
    graph = null;
  }

  // Split effect. `project()` is the effect's only reactive read, so the
  // compute half is exactly that read and the whole body below moves to the
  // apply half — which is also where it belongs, because it writes the
  // loop/metronome signals and Solid 2 throws on a write inside a tracking
  // scope.
  //
  // `lastProjection` stays a closure variable of the hook, not of the apply
  // function, so each run still hands the *previous* projection back to
  // `buildAudioProjection` and an unrelated edit reuses every entry it did not
  // touch (PRD AUD-08).
  createEffect(
    () => project(),
    (current) => {
      if (!current) return;
      if (!graph || ownerId !== current.metadata.id) {
        tearDown();
        ownerId = current.metadata.id;
        graph = new ProjectAudioGraph(runtime, ownerId, {
          underrunMonitor: underrunMonitor(),
          onAssetLoadFailure: reportAssetLoadFailure,
        });
        stopGraphTriggers = graph.watchTriggers(triggers.publish);
        metronome = new TransportMetronome(
          liveTransportEngine,
          graph.projectScope,
          graph.masterInput,
        );
        transport = new TransportController({ metronome });
        setMetronomeEnabled(false);
        lastProjection = undefined;
      }
      lastProjection = buildAudioProjection(current, lastProjection);
      graph.reconcile(lastProjection);
      attachPeakWatchers();
      // Mirror the song tempo and loop onto the transport without restarting
      // it: a tempo, range, or toggle edit re-times or re-bounds the running
      // transport in place (PRD AUD-02, LOOP-017).
      transport?.setTempo(current.song.tempo);
      transport?.mirrorLoop(current.song.loop);
      setLoop(transport?.loop ?? null);
      setLoopEnabled(current.song.loop.enabled);

      // `audio_loop` first-use (PRD OPS-02, INS-02): the first time a project
      // with a tempo-labelled loop clip is wired onto the audio graph. Fired
      // via `logFeatureFirstUse`, so it lands at most once per account per
      // browser even though the effect re-runs on every edit.
      if (current.clips.some((clip) => clip.content.kind === "audioLoop")) {
        analytics.logFeatureFirstUse("audio_loop");
      }
    },
  );

  onCleanup(() => {
    tearDown();
    triggers.dispose();
  });

  function startFrameLoop(): void {
    if (frameHandle !== null) return;
    const tick = (): void => {
      if (!transport) return;
      setPositionTicks(transport.positionTicks);
      levels.sample(graph?.readTrackLevels() ?? new Map());
      if (transport.isPlaying) {
        frameHandle = requestFrame(tick);
      } else {
        frameHandle = null;
        levels.clear();
      }
    };
    frameHandle = requestFrame(tick);
  }

  function stopFrameLoop(): void {
    if (frameHandle !== null) {
      cancelFrame(frameHandle);
      frameHandle = null;
    }
    levels.clear();
  }

  /**
   * Awaits the runtime unlock, but rejects with an `autoplay_blocked`-coded
   * error if it does not settle within `resumeTimeoutMs`. Firefox under a
   * blocked autoplay policy never settles `Tone.start()`'s underlying
   * `context.resume()` (issue #43), so a bare `await runtime.resume()` would
   * hang forever: the `catch` below would never run, no `audio_start_failed`
   * would fire, and `setIsPlaying(true)` would never be reached — a dead play
   * button with no feedback. Racing a timeout turns that hang into the same
   * browser-blocked outcome a rejecting resume produces.
   */
  function resumeWithinTimeout(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = setTimer(() => {
        if (settled) return;
        settled = true;
        reject(
          new CodedError(
            "autoplay_blocked",
            "Audio unlock timed out; the browser likely blocked autoplay.",
          ),
        );
      }, resumeTimeoutMs);
      runtime.resume().then(
        () => {
          if (settled) return;
          settled = true;
          clearTimer(timer);
          resolve();
        },
        (error) => {
          if (settled) return;
          settled = true;
          clearTimer(timer);
          reject(error);
        },
      );
    });
  }

  /**
   * The one start path, shared by `play()` and `continueFromStop()`: unlock the
   * context behind the user gesture, start the transport the caller asked for,
   * then report it. Both mappings are a "start playback" gesture, so both must
   * unlock and both emit exactly one `transport_play`.
   */
  async function startPlayback(
    startTransport: (controller: TransportController) => void,
  ): Promise<void> {
    try {
      // Resuming the shared context is the runtime's job; this call site is
      // the allowed user gesture that permits it (PRD AUD-07). The unlock is
      // bounded: a browser that never settles the resume is treated as a
      // blocked autoplay, not left to hang the play button forever (#43).
      await resumeWithinTimeout();
      if (transport) startTransport(transport);
      analytics.log("transport_play", {
        is_first_play_in_session: firstPlayInSession,
      });
      firstPlayInSession = false;
      setIsPlaying(true);
      startFrameLoop();
    } catch (error) {
      const code = codeFor(error);
      analytics.log("audio_start_failed", {
        error_code: code,
        was_browser_blocked: code === "autoplay_blocked",
      });
      reportError(error, { area: "audio", fatal: false, code });
      setIsPlaying(false);
    }
  }

  function play(): Promise<void> {
    return startPlayback((controller) => controller.play());
  }

  function continueFromStop(): Promise<void> {
    return startPlayback((controller) => controller.continueFromStop());
  }

  function pause(): void {
    transport?.pause();
    setIsPlaying(false);
    stopFrameLoop();
  }

  function stop(): void {
    transport?.stop();
    setIsPlaying(false);
    stopFrameLoop();
    setPositionTicks(transport?.positionTicks ?? 0);
  }

  async function toggle(): Promise<void> {
    if (isPlaying()) {
      stop();
    } else {
      await play();
    }
  }

  function seekTicks(ticks: number): void {
    transport?.seekTicks(ticks);
    setPositionTicks(transport?.positionTicks ?? 0);
  }

  function toggleMetronome(): void {
    transport?.toggleMetronome();
    setMetronomeEnabled(transport?.metronomeEnabled ?? false);
  }

  async function auditionPad(trackId: TrackId, padId: PadId): Promise<void> {
    if (!graph) return;
    try {
      // The click is the allowed gesture to unlock the shared context; a
      // blocked/never-settling resume is swallowed rather than throwing into
      // the panel (a failed audition must never break editing — PRD OPS-02).
      await resumeWithinTimeout();
    } catch {
      return;
    }
    graph?.auditionPad(trackId, padId);
  }

  async function auditionTrack(
    trackId: TrackId,
    trigger: NoteTrigger,
    durationTicks: number,
    velocity: number,
  ): Promise<boolean> {
    try {
      await resumeWithinTimeout();
      graph?.auditionTrack(trackId, trigger, durationTicks, velocity);
      return true;
    } catch (error) {
      const code = codeFor(error);
      analytics.log("audio_start_failed", {
        error_code: code,
        was_browser_blocked: code === "autoplay_blocked",
      });
      reportError(error, { area: "audio", fatal: false, code });
      return false;
    }
  }

  return {
    isPlaying,
    positionTicks,
    loopEnabled,
    loop,
    metronomeEnabled,
    play,
    pause,
    stop,
    toggle,
    continueFromStop,
    seekTicks,
    trackLevel: levels.level,
    toggleMetronome,
    auditionPad,
    auditionTrack,
    watchAssetPeaks,
    watchTriggers,
  };
}
