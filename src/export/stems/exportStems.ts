import type { ErrorCode } from "../../analytics/errorCodes";
import {
  OfflineRenderError,
  RENDER_CHANNELS,
  renderProjectOffline,
} from "../../audio/offlineRenderer";
import { songEndSeconds } from "../../audio/renderLength";
import type { Project } from "../../domain/entities";
import { encodePcm, WAV_HEADER_BYTES, type WavBitDepth } from "../wav";
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
 * An export over {@link MAX_STEM_EXPORT_BYTES} is refused, before anything
 * renders when the song's length alone already says so.
 */

/**
 * The largest stem archive an export builds: the working-memory budget. The
 * encoded stems and the archive over them live in the page's memory until the
 * download is handed off, so this bounds the tab's peak, well under both the
 * 4 GiB a plain ZIP can hold and what a browser tab survives. At 48 kHz,
 * 24-bit stereo it is about 124 minutes of audio across every stem together.
 */
export const MAX_STEM_EXPORT_BYTES = 2 * 1024 ** 3;

export type StemRenderer = typeof renderProjectOffline;

export interface StemExportOptions {
  readonly bitDepth: WavBitDepth;
  /** The rate every stem renders at, in Hz. */
  readonly sampleRate: number;
  readonly signal?: AbortSignal;
  /** Monotonic 0..1 progress across the whole export. */
  readonly onProgress?: (fraction: number) => void;
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
  const { bitDepth, sampleRate, signal } = options;
  const render = options.render ?? renderProjectOffline;
  const plan = planStems(project);
  const mix = plan[plan.length - 1].projection;
  const songSeconds = songEndSeconds(mix);

  let progress = 0;
  const report = (fraction: number) => {
    if (fraction <= progress) return;
    progress = fraction;
    options.onProgress?.(fraction);
  };

  try {
    // Every stem is at least as long as the song, so this is a lower bound:
    // an export that fails it is refused before a single render.
    const blockAlign = RENDER_CHANNELS * (bitDepth / 8);
    const shortest = WAV_HEADER_BYTES + Math.ceil(songSeconds * sampleRate) * blockAlign;
    const paths = plan.map((stem) => stem.path);
    const maxBytes = Math.min(options.maxBytes ?? MAX_STEM_EXPORT_BYTES, MAX_ZIP_BYTES);
    if (stemArchiveBytes(paths, shortest, MANIFEST_ALLOWANCE_BYTES) > maxBytes) {
      throw new StemExportError("quota_exceeded", "The stems are too large to export");
    }

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
        pcm: encodePcm(rendered.channels, bitDepth),
        frames: rendered.frames,
      });
    }
    if (signal?.aborted) throw new StemExportError("aborted", "The export was cancelled");
    const frames = Math.max(0, ...encoded.map((stem) => stem.frames));
    const wavBytes = WAV_HEADER_BYTES + frames * blockAlign;
    if (stemArchiveBytes(paths, wavBytes, MANIFEST_ALLOWANCE_BYTES) > maxBytes) {
      throw new StemExportError("quota_exceeded", "The stems are too large to export");
    }

    const archive = buildStemArchive(encoded, {
      sampleRate,
      bitDepth,
      channels: RENDER_CHANNELS,
      tempo: mix.tempo,
      timeSignature: mix.timeSignature,
    });
    report(1);
    return archive;
  } catch (error) {
    throw asStemExportError(error, signal);
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
