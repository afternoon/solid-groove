import type { StemBatch } from "../../export/stems/stemBatches";
import type { DownloadCard, DownloadState } from "./DownloadsRow";
import { exportFileName } from "./exportFileName";
import type { ExportFormat } from "./FormatCards";
import { formatBytes } from "./stemSelection";
import { stemsBatchFileName } from "./stemsExport";

/**
 * What the Downloads row lists (EXP-004): the stereo WAV, or the ZIP(s) the
 * current selection splits into, each with the state the export has reached.
 * Pure, so the row and its tests share one derivation.
 */

export interface DownloadCardsInput {
  readonly format: ExportFormat;
  readonly projectName: string;
  /** One date for every name, so a run across midnight stays together. */
  readonly date: Date;
  /** The planned ZIPs, for stems. */
  readonly batches: readonly StemBatch[];
  /** The stereo WAV's size, for stereo. */
  readonly stereoBytes: number;
  /** The state of the file being made now; every other file waits. */
  readonly state: DownloadState;
  /** The printing fraction of that file, 0..1. */
  readonly fraction: number;
}

const files = (count: number): string => `${count} ${count === 1 ? "file" : "files"}`;

export function downloadCards(input: DownloadCardsInput): DownloadCard[] {
  const { state, fraction } = input;
  if (input.format === "stereo") {
    return [
      {
        name: exportFileName(input.projectName, input.date, "wav"),
        detail: `1 file · ${formatBytes(input.stereoBytes)}`,
        state,
        fraction: state === "done" ? 1 : fraction,
      },
    ];
  }
  const count = input.batches.length;
  return input.batches.map((batch, index) => {
    const current = index === 0;
    const name = stemsBatchFileName(input.projectName, input.date, index, count);
    return {
      name: count > 1 ? `ZIP ${index + 1} of ${count}` : name,
      title: name,
      detail: `${files(batch.paths.length)} · ${formatBytes(batch.bytes)}`,
      state: current ? state : "waiting",
      fraction: !current ? 0 : state === "done" ? 1 : fraction,
    };
  });
}
