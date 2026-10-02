import type * as Tone from "tone";
import type { AudioSongProjection } from "../projection/audioProjection";
import type { Scheduler } from "../shared/scheduler";
import type { AssetBufferLoader } from "./AudioBufferCache";
import type { InstrumentNodeFactory } from "./InstrumentGraph";
import { disposeVoicesFinishedBy } from "./instruments/assetVoice";
import { masterLatencyFrames } from "./masterLatency";
import {
  finishOfflineRender,
  renderOfflineInStep,
  withGlobalContext,
} from "./offlineClock";
import {
  OfflineRenderError,
  openOfflineSession,
  RENDER_CHANNELS,
  renderCancelled,
} from "./offlineSession";
import { MAX_TAIL_SECONDS, songEndSeconds, trimRenderedTail } from "./renderLength";
import type { ResourceRegistry } from "./resourceRegistry";

export { OfflineRenderError, RENDER_CHANNELS } from "./offlineSession";

/**
 * The shared offline renderer (EXP-001): renders a song to audio faster than
 * real time, for stereo export and stems alike.
 *
 * It plays the song through the same `ProjectAudioGraph` live playback uses
 * (see `offlineSession.ts`), so notes, clips, tempo, inserts, sends, the
 * master chain with its limiter, and every release and effect tail sound in
 * the render exactly as they do live. It only reads the projection, and never
 * touches the live context, transport or graph. Automation is not rendered
 * because live playback does not render it yet either (ARR-004).
 *
 * A render prepares (decodes assets), then runs the clock — firing scheduled
 * events, the offline context installed only while each chunk runs — and the
 * audio thread in step, disposing each voice once the audio is past it (see
 * `offlineClock.ts`). A cancel takes effect before
 * the next chunk, at most five seconds of audio away.
 */

export interface OfflineRenderOptions {
  /** The rate to render at, in Hz. The caller chooses it (export uses the
   * project's); the renderer never reads the live context's. */
  sampleRate: number;
  /** Aborting it cancels the render: the promise rejects with code
   * `"aborted"` once every offline resource has been released. */
  signal?: AbortSignal;
  /** Monotonic 0..1 progress, for a progress bar. */
  onProgress?: (fraction: number) => void;
  /** How far past the song a tail may ring; see {@link MAX_TAIL_SECONDS}. */
  maxTailSeconds?: number;
  /** Decodes assets. Production uses Tone's loader; tests inject buffers. */
  bufferLoader?: AssetBufferLoader<Tone.ToneAudioBuffer>;
  /** Where the offline graph registers its resources, so a test can prove
   * every one is released. A private registry is used otherwise. */
  registry?: ResourceRegistry;
  /** Where the yields between clock chunks are scheduled. */
  scheduler?: Scheduler;
  /** Test seam: the instrument factory `ProjectAudioGraph` would use. */
  createInstrument?: InstrumentNodeFactory;
  /** Every track feeds only its sends, so only the returns sound: how a
   * return's stem is rendered (EXP-003). */
  tracksSendOnly?: boolean;
}

export interface OfflineRender {
  /** One array per channel (`[left, right]`), each `frames` long. */
  readonly channels: Float32Array[];
  readonly sampleRate: number;
  readonly frames: number;
  /** Where the last clip ends: the render is never shorter than this. */
  readonly songEndSeconds: number;
  /** True when a tail was still sounding at the end of the tail budget. */
  readonly tailTruncated: boolean;
}

/** Progress reached when assets are ready, and when the clock has run. */
const PREPARED = 0.1;
const CLOCKED = 0.95;

/**
 * Renders `projection` offline. Resolves with the rendered audio, or rejects
 * with an {@link OfflineRenderError}; either way only after every offline
 * resource is released. A song with nothing placed renders zero frames.
 */
export async function renderProjectOffline(
  projection: AudioSongProjection,
  options: OfflineRenderOptions,
): Promise<OfflineRender> {
  const { sampleRate, signal } = options;
  if (signal?.aborted) throw renderCancelled();
  const endSeconds = songEndSeconds(projection);
  if (endSeconds <= 0) {
    const channels = Array.from({ length: RENDER_CHANNELS }, () => new Float32Array(0));
    return { channels, sampleRate, frames: 0, songEndSeconds: 0, tailTruncated: false };
  }

  let progress = 0;
  const report = (fraction: number) => {
    if (fraction <= progress) return;
    progress = fraction;
    options.onProgress?.(fraction);
  };

  let latencyFrames: number;
  try {
    latencyFrames = await masterLatencyFrames(sampleRate);
  } catch (error) {
    throw new OfflineRenderError("not_supported", "Offline rendering is unavailable", {
      cause: error,
    });
  }
  if (signal?.aborted) throw renderCancelled();

  // The limiter's pre-delay is rendered, then dropped from the front, so bar 1
  // is the file's first frame (see `masterLatency.ts`).
  const tailSeconds = options.maxTailSeconds ?? MAX_TAIL_SECONDS;
  const session = openOfflineSession(projection, {
    ...options,
    durationSeconds: endSeconds + tailSeconds + latencyFrames / sampleRate,
  });
  try {
    session.build();
    await session.prepare();
    if (signal?.aborted) throw renderCancelled();
    report(PREPARED);

    const { context } = session;
    withGlobalContext(context, () => context.transport.start(0));
    const rendered = await renderOfflineInStep(context, {
      scheduler: options.scheduler,
      shouldStop: () => signal?.aborted === true,
      onProgress: (fraction) => report(PREPARED + (CLOCKED - PREPARED) * fraction),
      // Voices that have finished sounding leave the render as it goes.
      onRendered: (seconds) => disposeVoicesFinishedBy(context, seconds),
    });
    if (rendered === "stopped" || signal?.aborted) throw renderCancelled();

    const channels = Array.from({ length: RENDER_CHANNELS }, (_, channel) =>
      rendered
        .getChannelData(Math.min(channel, rendered.numberOfChannels - 1))
        .subarray(latencyFrames),
    );
    const endFrames = Math.round(endSeconds * sampleRate);
    const trimmed = trimRenderedTail(channels, sampleRate, endFrames);
    report(1);
    return {
      channels: trimmed.channels,
      sampleRate,
      frames: trimmed.frames,
      songEndSeconds: endSeconds,
      tailTruncated: trimmed.truncated,
    };
  } catch (error) {
    if (error instanceof OfflineRenderError) throw error;
    throw new OfflineRenderError("internal", "The offline render failed", {
      cause: error,
    });
  } finally {
    await session.release();
    // A render cancelled or failed part-way finishes, as silence now the graph is gone.
    await finishOfflineRender(session.context);
  }
}
