import type { Analytics } from "../../analytics/analytics";
import { bucketOf } from "../../analytics/buckets";
import type { ErrorCode } from "../../analytics/errorCodes";
import {
  OfflineRenderError,
  RENDER_CHANNELS,
  renderProjectOffline,
} from "../../audio/offlineRenderer";
import { MAX_TAIL_SECONDS, songEndSeconds } from "../../audio/renderLength";
import { pcm24, WAV_BITS_PER_SAMPLE, wav24ByteLength } from "../../audio/wavEncoder";
import type { Project } from "../../domain/entities";
import type { TrackId } from "../../domain/ids";
import { type Clock, systemClock } from "../../shared/clock";
import {
  buildStemArchive,
  type EncodedStem,
  MAX_ZIP_BYTES,
  type StemArchive,
  stemArchiveBytes,
} from "./stemArchive";
import { planStems, type StemRender } from "./stemPlan";

/**
 * A stem export, end to end (EXP-003): plan, render each stem offline, encode
 * it, and package them all as one aligned ZIP.
 *
 * Stems render one after another through the shared offline renderer, which
 * yields between chunks, so the page stays responsive and a cancel lands
 * within one chunk. Each render's float audio is dropped as soon as it is
 * encoded to integer PCM, so at most one stem's float render is held at a
 * time; the encoded PCM of every stem is held until packaging, because the
 * longest stem is only known once the last has rendered.
 *
 * An export over {@link MAX_STEM_EXPORT_BYTES} is refused before anything
 * renders, sizing every stem at {@link maxStemFrames}, an upper bound: an
 * export that starts rendering never fails on size afterwards. The Export
 * dialog shows the same estimate ({@link estimateStemExport}) and blocks Export
 * over it, so the producer deselects tracks instead of meeting this refusal.
 *
 * Stems carry each track's static fader value: the offline renderer does not
 * play automation until ARR-004 (#62) lands, and then stems include it.
 */

/**
 * The largest stem archive an export builds: the working-memory budget. The
 * encoded stems and the archive over them live in the page's memory until the
 * download is handed off, so this bounds the tab's peak, well under both the
 * 4 GiB a plain ZIP can hold and what a browser tab survives. At 48 kHz,
 * 24-bit stereo it is about 124 minutes of audio across every stem together.
 * The PRD reference project (50 tracks, ten minutes) is over it whole; the
 * product decision on #66 is that the producer then exports a selection of
 * its tracks, not that the budget grows.
 */
export const MAX_STEM_EXPORT_BYTES = 2 * 1024 ** 3;

/** Every stem's bit depth, as the stereo export's: there is no choice. */
export const STEM_BIT_DEPTH = WAV_BITS_PER_SAMPLE;

/** The most frames a stem's render can return: the song, the longest tail the
 * renderer keeps, and one frame for rounding in the renderer's own length. */
export function maxStemFrames(seconds: number, rate: number, tail = MAX_TAIL_SECONDS) {
  return Math.ceil((seconds + tail) * rate) + 1;
}

export type StemRenderer = typeof renderProjectOffline;

export interface StemExportOptions {
  /** The rate every stem renders at, in Hz. */
  readonly sampleRate: number;
  /** The tracks to export; every track when absent. */
  readonly trackIds?: readonly TrackId[];
  readonly signal?: AbortSignal;
  /** Monotonic 0..1 progress across the whole export. */
  readonly onProgress?: (fraction: number) => void;
  /** Where the export's events go. Nothing about the export depends on it. */
  readonly analytics?: Pick<Analytics, "log" | "logFeatureFirstUse">;
  readonly clock?: Clock;
  /** How far past the song a tail may ring; see `MAX_TAIL_SECONDS`. */
  readonly maxTailSeconds?: number;
  /** The largest archive the export may produce; {@link MAX_STEM_EXPORT_BYTES}
   * by default, and never more than a plain ZIP holds. */
  readonly maxBytes?: number;
  /** Test seam: the offline renderer. */
  readonly render?: StemRenderer;
}

/** Why a stem export did not finish. `code` is a stable analytics code. */
export class StemExportError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "StemExportError";
  }

  get cancelled(): boolean {
    return this.code === "aborted";
  }
}

/** What a stem export would weigh, before rendering it. */
export interface StemExportEstimate {
  /** An upper bound: every stem the song plus the longest tail it may keep. */
  readonly bytes: number;
  readonly limitBytes: number;
  readonly fits: boolean;
}

type EstimateOptions = Pick<
  StemExportOptions,
  "sampleRate" | "trackIds" | "maxTailSeconds" | "maxBytes"
>;

/** Estimates a stem export's size against its budget without rendering. */
export function estimateStemExport(
  project: Project,
  options: EstimateOptions,
): StemExportEstimate {
  return estimatePlan(planFor(project, options.trackIds), options);
}

function planFor(project: Project, trackIds?: readonly TrackId[]): StemRender[] {
  return planStems(project, trackIds && new Set(trackIds));
}

function estimatePlan(
  plan: readonly StemRender[],
  options: EstimateOptions,
  frames = maxStemFrames(
    songEndSeconds(plan[plan.length - 1].projection),
    options.sampleRate,
    options.maxTailSeconds,
  ),
): StemExportEstimate {
  const wav = wav24ByteLength(RENDER_CHANNELS, frames);
  const paths = plan.map((stem) => stem.path);
  const bytes = stemArchiveBytes(paths, wav);
  const limitBytes = Math.min(options.maxBytes ?? MAX_STEM_EXPORT_BYTES, MAX_ZIP_BYTES);
  return { bytes, limitBytes, fits: bytes <= limitBytes };
}

/** Progress reached once every stem has rendered; packaging is the rest. */
const RENDERED = 0.95;

export async function exportStems(
  project: Project,
  options: StemExportOptions,
): Promise<StemArchive> {
  const { sampleRate, signal, analytics } = options;
  const clock = options.clock ?? systemClock;
  const render = options.render ?? renderProjectOffline;
  const started = clock.now();
  const plan = planFor(project, options.trackIds);
  const mix = plan[plan.length - 1].projection;
  const songSeconds = songEndSeconds(mix);
  const selected = options.trackIds && new Set(options.trackIds);
  const leavesTrackOut =
    !!selected && project.song.tracks.some((track) => !selected.has(track.id));

  analytics?.logFeatureFirstUse("export_stems");
  if (leavesTrackOut) analytics?.logFeatureFirstUse("export_stems_selection");
  analytics?.log("export_started", {
    export_type: "stems",
    duration_bucket: bucketOf("musical_duration", songSeconds),
    track_count_bucket: bucketOf("track_count", project.song.tracks.length),
  });

  let progress = 0;
  const report = (fraction: number) => {
    if (fraction <= progress) return;
    progress = fraction;
    options.onProgress?.(fraction);
  };

  try {
    const refuseOverBudget = (frames?: number) => {
      if (estimatePlan(plan, options, frames).fits) return;
      throw new StemExportError("quota_exceeded", "The stems are too large");
    };
    // The estimate's bound covers every render: refuse before a single one.
    refuseOverBudget();

    const encoded: EncodedStem[] = [];
    for (const [index, stem] of plan.entries()) {
      if (signal?.aborted)
        throw new StemExportError("aborted", "The export was cancelled");
      const rendered = await render(stem.projection, {
        sampleRate,
        signal,
        maxTailSeconds: options.maxTailSeconds,
        tracksSendOnly: stem.tracksSendOnly,
        onProgress: (fraction) => report(((index + fraction) / plan.length) * RENDERED),
      });
      encoded.push({
        path: stem.path,
        pcm: pcm24(rendered.channels),
        frames: rendered.frames,
      });
    }
    if (signal?.aborted) throw new StemExportError("aborted", "The export was cancelled");
    // A safety net only: the bound above already covers every render.
    refuseOverBudget(Math.max(0, ...encoded.map((stem) => stem.frames)));

    const archive = buildStemArchive(encoded, {
      sampleRate,
      bitDepth: STEM_BIT_DEPTH,
      channels: RENDER_CHANNELS,
    });
    report(1);
    analytics?.log("export_completed", {
      export_type: "stems",
      elapsed_ms_bucket: bucketOf("elapsed_ms", clock.now() - started),
    });
    return archive;
  } catch (error) {
    const failure = asStemExportError(error, signal);
    analytics?.log("export_failed", {
      export_type: "stems",
      error_code: failure.code,
      was_cancelled: failure.cancelled,
    });
    throw failure;
  }
}

function asStemExportError(error: unknown, signal?: AbortSignal): StemExportError {
  if (error instanceof StemExportError) return error;
  if (signal?.aborted) {
    return new StemExportError("aborted", "The export was cancelled", { cause: error });
  }
  if (error instanceof OfflineRenderError) {
    return new StemExportError(error.code, error.message, { cause: error });
  }
  return new StemExportError("internal", "The stem export failed", { cause: error });
}
