import type { Analytics } from "../../analytics/analytics";
import { bucketOf } from "../../analytics/buckets";
import type { ErrorCode } from "../../analytics/errorCodes";
import {
  OfflineRenderError,
  RENDER_CHANNELS,
  renderProjectOffline,
} from "../../audio/offlineRenderer";
import { MAX_TAIL_SECONDS, songEndSeconds } from "../../audio/renderLength";
import type { Project } from "../../domain/entities";
import { type Clock, systemClock } from "../../shared/clock";
import { encodePcm, WAV_HEADER_BYTES } from "../wav";
import {
  buildStemArchive,
  type EncodedStem,
  MAX_ZIP_BYTES,
  type StemArchive,
  stemArchiveBytes,
} from "./stemArchive";
import { planStems } from "./stemPlan";

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
 * export that starts rendering never fails on size afterwards.
 */

/**
 * The largest stem archive an export builds: the working-memory budget. The
 * encoded stems and the archive over them live in the page's memory until the
 * download is handed off, so this bounds the tab's peak, well under both the
 * 4 GiB a plain ZIP can hold and what a browser tab survives. At 48 kHz,
 * 24-bit stereo it is about 124 minutes of audio across every stem together:
 * provisional, as the PRD reference project (50 tracks, ten minutes) is over it.
 */
export const MAX_STEM_EXPORT_BYTES = 2 * 1024 ** 3;

/** Every stem's bit depth, as the stereo export's: there is no choice. */
export const STEM_BIT_DEPTH = 24;

/** The most frames a stem's render can return: the song, the longest tail the
 * renderer keeps, and one frame for rounding in the renderer's own length. */
export function maxStemFrames(seconds: number, rate: number, tail = MAX_TAIL_SECONDS) {
  return Math.ceil((seconds + tail) * rate) + 1;
}

export type StemRenderer = typeof renderProjectOffline;

export interface StemExportOptions {
  /** The rate every stem renders at, in Hz. */
  readonly sampleRate: number;
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

/** Progress reached once every stem has rendered; packaging is the rest. */
const RENDERED = 0.95;

/** A generous allowance for the manifest in the up-front size estimate. */
const MANIFEST_ALLOWANCE_BYTES = 64 * 1024;

export async function exportStems(
  project: Project,
  options: StemExportOptions,
): Promise<StemArchive> {
  const { sampleRate, signal, analytics } = options;
  const clock = options.clock ?? systemClock;
  const render = options.render ?? renderProjectOffline;
  const started = clock.now();
  const plan = planStems(project);
  const mix = plan[plan.length - 1].projection;
  const songSeconds = songEndSeconds(mix);

  analytics?.logFeatureFirstUse("export_stems");
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
    const paths = plan.map((stem) => stem.path);
    const maxBytes = Math.min(options.maxBytes ?? MAX_STEM_EXPORT_BYTES, MAX_ZIP_BYTES);
    const refuseOverBudget = (frames: number) => {
      const wav = WAV_HEADER_BYTES + frames * RENDER_CHANNELS * (STEM_BIT_DEPTH / 8);
      if (stemArchiveBytes(paths, wav, MANIFEST_ALLOWANCE_BYTES) <= maxBytes) return;
      throw new StemExportError("quota_exceeded", "The stems are too large");
    };
    // No stem renders longer than this bound: refuse before a single render.
    refuseOverBudget(maxStemFrames(songSeconds, sampleRate, options.maxTailSeconds));

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
        kind: stem.kind,
        path: stem.path,
        name: stem.name,
        sourceId: stem.sourceId,
        pcm: encodePcm(rendered.channels, STEM_BIT_DEPTH),
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
      tempo: mix.tempo,
      timeSignature: mix.timeSignature,
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
