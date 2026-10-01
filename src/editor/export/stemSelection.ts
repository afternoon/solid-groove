import type { StemExportEstimate } from "../../export/stems/exportStems";

/**
 * How a stem selection reads against the export's size budget (EXP-003, a
 * product-owner decision on #66). Which tracks are selected is the track
 * list's state (`trackListSelection`), export UI state that is never saved.
 */

const MiB = 1024 ** 2;
const GiB = 1024 ** 3;

/** A size as the dialog writes it: binary units, as the 2 GiB budget is. */
export function formatBytes(bytes: number): string {
  if (bytes >= GiB) return `${(bytes / GiB).toFixed(1).replace(/\.0$/, "")} GiB`;
  return `${Math.max(1, Math.round(bytes / MiB))} MiB`;
}

/** Why Export is blocked for this selection, in words; `null` when it is not. */
export function stemsBlocker(
  selected: number,
  estimate: StemExportEstimate,
): string | null {
  if (selected === 0) return "Select at least one track to export.";
  if (estimate.fits) return null;
  return (
    `This selection is about ${formatBytes(estimate.bytes)}, over the ` +
    `${formatBytes(estimate.limitBytes)} limit for an export in the browser. ` +
    "Deselect tracks to get under it."
  );
}
