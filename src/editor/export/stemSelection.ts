import { createMemo, createSignal } from "solid-js";
import type { Project, Track } from "../../domain/entities";
import type { TrackId } from "../../domain/ids";
import type { StemExportEstimate } from "../../export/stems/exportStems";
import { estimateStemsFile } from "./stemsExport";

/**
 * The stems dialog's track selection (EXP-003, a product-owner decision on
 * #66): which tracks a stem export includes, every one unless the producer
 * leaves some out, and whether that selection fits the export's size budget.
 *
 * It is export UI state, not project state: it is never saved, never a
 * command, and gone when the dialog closes. It records the tracks left out
 * rather than the ones kept, so a track added while the dialog is open is
 * included like every other.
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

export function createStemSelection(project: () => Project) {
  const [leftOut, setLeftOut] = createSignal<ReadonlySet<TrackId>>(new Set());
  const tracks = createMemo((): Track[] =>
    [...project().song.tracks].sort((a, b) => a.order - b.order),
  );
  const trackIds = createMemo(() =>
    tracks()
      .map((track) => track.id)
      .filter((id) => !leftOut().has(id)),
  );
  const estimate = createMemo(() => estimateStemsFile(project(), trackIds()));
  const blocker = createMemo(() => stemsBlocker(trackIds().length, estimate()));
  return {
    tracks,
    trackIds,
    estimate,
    blocker,
    isSelected: (id: TrackId) => !leftOut().has(id),
    setSelected(id: TrackId, selected: boolean) {
      const next = new Set(leftOut());
      if (selected) next.delete(id);
      else next.add(id);
      setLeftOut(next);
    },
  };
}

export type StemSelection = ReturnType<typeof createStemSelection>;
