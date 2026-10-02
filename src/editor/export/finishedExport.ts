import type { StemBatch } from "../../export/stems/stemBatches";
import type { ExportFacts } from "./exportFacts";
import { exportFileName } from "./exportFileName";
import type { ExportFormat } from "./FormatCards";
import type { SleeveStripe } from "./sleeveCanvas";
import { formatBytes } from "./stemSelection";
import { stemsBatchFileName } from "./stemsExport";
import type { TrackLaneView } from "./trackLanes";

/**
 * What the finished screen of an export says (EXP-004): its file or ZIPs, the
 * four readouts, and the stripes the sleeve draws. A pure read of the export
 * the producer just made, so the screen and its tests share one derivation.
 */

export interface FinishedExport {
  readonly name: string;
  /** `120 BPM`, for the sleeve's caption. */
  readonly tempo: string;
  readonly length: string;
  readonly format: ExportFormat;
  /** The one file's name; for several ZIPs, the first's. */
  readonly fileName: string;
  /** Every ZIP with its size, when there are several. */
  readonly zips: readonly { readonly name: string; readonly size: string }[];
  /** Stems made, or the tracks in the mix. */
  readonly count: number;
  readonly size: string;
  readonly bars: number;
  readonly stripes: readonly SleeveStripe[];
  /** Samples a stereo mix flattened at full scale; 0 when it did not clip, and for stems. */
  readonly clippedSamples: number;
}

export interface FinishedExportInput {
  readonly format: ExportFormat;
  readonly facts: ExportFacts;
  readonly date: Date;
  readonly rows: readonly TrackLaneView[];
  readonly batches: readonly StemBatch[];
  readonly stereoBytes: number;
  readonly bars: number;
  /** What the stereo export reported; stems carry their own gain per file. */
  readonly clippedSamples: number;
}

export function finishedExport(input: FinishedExportInput): FinishedExport {
  const { format, facts, date, batches } = input;
  const stereo = format === "stereo";
  const included = input.rows.filter((row) => row.included);
  const tracks = included.filter((row) => !row.fixed);
  const several = !stereo && batches.length > 1;
  const names = batches.map((_, i) =>
    stemsBatchFileName(facts.name, date, i, batches.length),
  );
  const bytes = stereo
    ? input.stereoBytes
    : batches.reduce((sum, batch) => sum + batch.bytes, 0);
  return {
    name: facts.name,
    tempo: facts.tempo,
    length: facts.length,
    format,
    fileName: stereo ? exportFileName(facts.name, date, "wav") : (names[0] ?? ""),
    zips: several
      ? batches.map((batch, i) => ({ name: names[i], size: formatBytes(batch.bytes) }))
      : [],
    count: stereo ? tracks.length : included.length,
    size: formatBytes(bytes),
    bars: input.bars,
    stripes: tracks.flatMap((row) =>
      row.color ? [{ color: row.color, lanes: row.lanes }] : [],
    ),
    clippedSamples: stereo ? input.clippedSamples : 0,
  };
}
