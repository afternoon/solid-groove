import { type Analytics, analytics as defaultAnalytics } from "../../analytics/analytics";
import type { Project } from "../../domain/entities";
import type { TrackId } from "../../domain/ids";
import {
  estimateStemExport,
  exportStems,
  type StemExportEstimate,
  type StemExportOptions,
} from "../../export/stems/exportStems";
import { planStemBatches, type StemBatch } from "../../export/stems/stemBatches";
import { type Clock, systemClock } from "../../shared/clock";
import { localDateStamp, safeFileStem } from "./exportFileName";
import { projectSampleRate } from "./stereoExport";

/**
 * The Export dialog's stems action (EXP-003, CF-022): every stem at the
 * project's own sample rate, at 24-bit, as one ZIP named
 * `<project name> <YYYY-MM-DD> stems.zip`.
 */

export interface StemsExportFile {
  /** The ZIP, built over the archive's parts without copying them again. */
  readonly blob: Blob;
  readonly fileName: string;
}

export interface StemsExportRequest {
  /** The tracks to export; every track when absent. */
  readonly trackIds?: readonly TrackId[];
  readonly signal?: AbortSignal;
  readonly onProgress?: (fraction: number) => void;
  readonly analytics?: Analytics;
  readonly clock?: Clock;
  /** Test seam: the export pipeline itself. */
  readonly exportStems?: (
    project: Project,
    options: StemExportOptions,
  ) => ReturnType<typeof exportStems>;
}

/** The download name for a stem export of `projectName` made at `date`. */
export function stemsFileName(projectName: string, date: Date): string {
  return `${safeFileStem(projectName)} ${localDateStamp(date)} stems.zip`;
}

/** What the export of `trackIds` would weigh, before rendering: an upper bound. */
export function estimateStemsFile(
  project: Project,
  trackIds?: readonly TrackId[],
): StemExportEstimate {
  return estimateStemExport(project, {
    sampleRate: projectSampleRate(project),
    trackIds,
  });
}

export async function exportStemsFile(
  project: Project,
  request: StemsExportRequest,
): Promise<StemsExportFile> {
  const clock = request.clock ?? systemClock;
  const archive = await (request.exportStems ?? exportStems)(project, {
    trackIds: request.trackIds,
    sampleRate: projectSampleRate(project),
    signal: request.signal,
    onProgress: request.onProgress,
    analytics: request.analytics ?? defaultAnalytics,
    clock,
  });
  return {
    blob: new Blob(archive.parts as Uint8Array<ArrayBuffer>[], {
      type: "application/zip",
    }),
    fileName: stemsFileName(project.metadata.name, new Date(clock.now())),
  };
}

/** The download name of ZIP `index` (0-based) of `count`: the single ZIP's own
 * name when there is one, else `... stems 1 of 3.zip`. */
export function stemsBatchFileName(
  projectName: string,
  date: Date,
  index: number,
  count: number,
): string {
  if (count <= 1) return stemsFileName(projectName, date);
  const stem = `${safeFileStem(projectName)} ${localDateStamp(date)} stems`;
  return `${stem} ${index + 1} of ${count}.zip`;
}

/** The ZIPs a stem export of `trackIds` is split into, each under the budget
 * (EXP-004). One batch when it fits whole. */
export function planStemsFiles(
  project: Project,
  trackIds?: readonly TrackId[],
  maxBytes?: number,
): StemBatch[] {
  return planStemBatches(project, {
    sampleRate: projectSampleRate(project),
    trackIds,
    maxBytes,
  });
}

export interface StemsBatchRequest extends StemsExportRequest {
  /** The batch to build, from {@link planStemsFiles}. */
  readonly batch: StemBatch;
  /** How many ZIPs the whole export is. */
  readonly count: number;
  /** The export's start on the clock, so elapsed time spans every ZIP. */
  readonly startedAt?: number;
  /** One date for every ZIP's name, so a run across midnight stays together. */
  readonly date?: Date;
  readonly maxBytes?: number;
}

/** Builds one ZIP of a batched export. The event trio fires once across all of
 * them; `onProgress` is this ZIP's own 0..1. */
export async function exportStemsBatch(
  project: Project,
  request: StemsBatchRequest,
): Promise<StemsExportFile> {
  const clock = request.clock ?? systemClock;
  const { batch, count } = request;
  const archive = await (request.exportStems ?? exportStems)(project, {
    trackIds: request.trackIds,
    sampleRate: projectSampleRate(project),
    signal: request.signal,
    onProgress: request.onProgress,
    analytics: request.analytics ?? defaultAnalytics,
    clock,
    maxBytes: request.maxBytes,
    stems: batch.paths,
    batch: { index: batch.index, count, startedAt: request.startedAt },
  });
  return {
    blob: new Blob(archive.parts as Uint8Array<ArrayBuffer>[], {
      type: "application/zip",
    }),
    fileName: stemsBatchFileName(
      project.metadata.name,
      request.date ?? new Date(clock.now()),
      batch.index,
      count,
    ),
  };
}
