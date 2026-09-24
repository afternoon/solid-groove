/**
 * Removing a stretch of time from placements (`ARR-006`, #292).
 *
 * Delete and cut act on the time a range covers, not on the clips it touches,
 * as in Ableton. A clip wholly inside the range is removed. A clip partly
 * inside is trimmed to the part outside, and one the range falls strictly
 * inside is split in two around it. Nothing outside the range changes.
 *
 * Pure, like the rest of placement editing: the caller hands the commands to
 * `CommandHistory` as one transaction, and a split's new placement carries an
 * explicit ID from the injected `IdFactory`. Trimming here is deliberately not
 * bar-snapped. The range is free, so its edges are where the cut falls.
 */

import {
  addPlacement,
  removePlacement,
  updatePlacement,
} from "../commands/definitions/placements";
import type { RawCommandInput } from "../commands/types";
import type { Placement, Project } from "../domain/entities";
import type { IdFactory, PlacementId } from "../domain/ids";
import { toTicks } from "../domain/time";
import type { PlacementClipboardEntry } from "./placementClipboard";
import { findPlacement } from "./placementGeometry";

export interface RangeRemoval {
  /** The commands that take the covered time out, as one transaction. */
  readonly commands: RawCommandInput[];
  /** The covered pieces, for a cut to put on the clipboard. */
  readonly clipboard: PlacementClipboardEntry[];
}

/** The commands that leave only the parts of `placement` outside `[start, end)`. */
function trimOutside(
  placement: Placement,
  start: number,
  end: number,
  ids: IdFactory,
): RawCommandInput[] {
  const placementEnd = placement.startTicks + placement.durationTicks;
  const keepsHead = start > placement.startTicks;
  const keepsTail = end < placementEnd;
  // The tail's own content starts `end - startTicks` further into the clip.
  const tail = {
    startTicks: toTicks(end),
    durationTicks: toTicks(placementEnd - end),
    clipOffsetTicks: toTicks(placement.clipOffsetTicks + (end - placement.startTicks)),
  };
  if (!keepsHead && !keepsTail) return [removePlacement(placement.id)];
  if (!keepsHead) return [updatePlacement(placement.id, tail)];
  const head = updatePlacement(placement.id, {
    durationTicks: toTicks(start - placement.startTicks),
  });
  if (!keepsTail) return [head];
  return [head, addPlacement({ ...placement, id: ids("placement"), ...tail })];
}

/**
 * Take the time from `startTicks` to `endTicks` out of each of `placementIds`.
 * A placement the project no longer has, or one the range does not overlap, is
 * left alone. An empty or inverted range changes nothing.
 */
export function removePlacementRange(
  project: Project,
  placementIds: readonly PlacementId[],
  startTicks: number,
  endTicks: number,
  ids: IdFactory,
): RangeRemoval {
  const commands: RawCommandInput[] = [];
  const clipboard: PlacementClipboardEntry[] = [];
  for (const id of placementIds) {
    const placement = findPlacement(project, id);
    if (!placement) continue;
    const start = Math.max(Math.round(startTicks), placement.startTicks);
    const end = Math.min(
      Math.round(endTicks),
      placement.startTicks + placement.durationTicks,
    );
    if (end <= start) continue;
    clipboard.push({
      clipId: placement.clipId,
      trackId: placement.trackId,
      startTicks: start,
      durationTicks: end - start,
      clipOffsetTicks: placement.clipOffsetTicks + (start - placement.startTicks),
      looped: placement.looped,
    });
    commands.push(...trimOutside(placement, start, end, ids));
  }
  return { commands, clipboard };
}
