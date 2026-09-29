import { type Analytics, analytics as defaultAnalytics } from "../../analytics/analytics";
import type { Project } from "../../domain/entities";
import { exportStems, type StemExportOptions } from "../../export/stems/exportStems";
import type { WavBitDepth } from "../../export/wav";
import { type Clock, systemClock } from "../../shared/clock";
import { localDateStamp, safeFileStem } from "./exportFileName";
import { projectSampleRate } from "./stereoExport";

/**
 * The Export dialog's stems action (EXP-003, CF-022): every stem at the
 * project's own sample rate, at the chosen bit depth, as one ZIP named
 * `<project name> <YYYY-MM-DD> stems.zip`.
 */

export interface StemsExportFile {
  /** The ZIP, built over the archive's parts without copying them again. */
  readonly blob: Blob;
  readonly fileName: string;
}

export interface StemsExportRequest {
  readonly bitDepth: WavBitDepth;
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

export async function exportStemsFile(
  project: Project,
  request: StemsExportRequest,
): Promise<StemsExportFile> {
  const clock = request.clock ?? systemClock;
  const archive = await (request.exportStems ?? exportStems)(project, {
    bitDepth: request.bitDepth,
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
