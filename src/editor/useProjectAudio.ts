import { type Accessor, createEffect, createSignal, onCleanup } from "solid-js";
import { type Analytics, analytics as defaultAnalytics } from "../analytics/analytics";
import { type AudioHost, getAudioRuntime } from "../audio/AudioRuntime";
import { ProjectAudioGraph } from "../audio/ProjectAudioGraph";
import {
  type LoopRange,
  liveTransportEngine,
  TransportController,
  TransportMetronome,
} from "../audio/Transport";
import { UnderrunMonitor } from "../audio/underrun";
import type { NoteTrigger, Project } from "../domain/entities";
import type { PadId, TrackId } from "../domain/ids";
import { TICKS_PER_BAR } from "../domain/time";
import { CodedError, codeFor, reportError } from "../monitoring/errorReporting";
import type { AudioAssetProjection } from "../projection/audioProjection";
import {
  type AudioSongProjection,
  buildAudioProjection,
} from "../projection/audioProjection";

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
   * The current post-fader peak level of a track, in dBFS, or `null` when no
   * graph is live yet or the track has no meter. The mixer polls this for a
   * per-track level display (PRD TRK-02); reading a meter emits no telemetry.
   */
  trackLevelDb(trackId: string): number | null;
  /**
   * Redefine the (bar-aligned) loop range. No surface calls this yet: the
   * `FND-009` slice renders a 16-step grid and no timeline, so there is nothing
   * to drag a range on — the loop is the one bar the grid shows. The range
   * *selection* UI belongs with the timeline that owns range select and range
   * loop (`ARR-002`); `setLoop`/`barAlignedLoop` are the engine side of it and
   * are exercised by `Transport.test.ts`.
   */
  setLoop(startTicks: number, endTicks: number): void;
  toggleLoop(): void;
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

  function tearDown(): void {
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
        metronome = new TransportMetronome(
          liveTransportEngine,
          graph.projectScope,
          graph.masterInput,
        );
        transport = new TransportController({ metronome });
        // The slice's loop is the one bar its 16-step grid shows. Enabling it
        // is a user gesture, but the range is fixed here rather than selected:
        // there is no timeline to drag a range on until `ARR-002`, which owns
        // range select and range loop. See `setLoop` on the controls above.
        transport.setLoop(0, TICKS_PER_BAR);
        setLoop(transport.loop);
        setLoopEnabled(false);
        setMetronomeEnabled(false);
        lastProjection = undefined;
      }
      lastProjection = buildAudioProjection(current, lastProjection);
      graph.reconcile(lastProjection);
      // Mirror the song tempo onto the transport without restarting it.
      transport?.setTempo(current.song.tempo);

      // `audio_loop` first-use (PRD OPS-02, INS-02): the first time a project
      // with a tempo-labelled loop clip is wired onto the audio graph. Fired
      // via `logFeatureFirstUse`, so it lands at most once per account per
      // browser even though the effect re-runs on every edit.
      if (current.clips.some((clip) => clip.content.kind === "audioLoop")) {
        analytics.logFeatureFirstUse("audio_loop");
      }
    },
  );

  onCleanup(tearDown);

  function startFrameLoop(): void {
    if (frameHandle !== null) return;
    const tick = (): void => {
      if (!transport) return;
      setPositionTicks(transport.positionTicks);
      if (transport.isPlaying) {
        frameHandle = requestFrame(tick);
      } else {
        frameHandle = null;
      }
    };
    frameHandle = requestFrame(tick);
  }

  function stopFrameLoop(): void {
    if (frameHandle !== null) {
      cancelFrame(frameHandle);
      frameHandle = null;
    }
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

  function trackLevelDb(trackId: string): number | null {
    const meter = graph?.trackMeter(
      trackId as Parameters<ProjectAudioGraph["trackMeter"]>[0],
    );
    if (!meter) return null;
    const value = meter.getValue();
    // Tone.Meter returns a single number in mono or a per-channel array in
    // stereo; the level display wants one peak, so take the louder channel.
    return Array.isArray(value) ? Math.max(...value) : value;
  }

  function seekTicks(ticks: number): void {
    transport?.seekTicks(ticks);
    setPositionTicks(transport?.positionTicks ?? 0);
  }

  function setLoopRange(startTicks: number, endTicks: number): void {
    const range = transport?.setLoop(startTicks, endTicks);
    if (range) setLoop(range);
  }

  function toggleLoop(): void {
    transport?.toggleLoop();
    setLoopEnabled(transport?.loopEnabled ?? false);
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
    trackLevelDb,
    setLoop: setLoopRange,
    toggleLoop,
    toggleMetronome,
    auditionPad,
    auditionTrack,
  };
}
