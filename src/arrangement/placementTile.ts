/**
 * Right-edge repeat: dragging a clip's end past where it ends tiles the span
 * with linked copies (#493), Bitwig-style.
 *
 * Pure, like `placementDragCopy.ts` beside it. Every copy is a linked
 * placement: it points at the *same* clip as the source, so an edit to any
 * occurrence is heard in all of them. The source is left exactly as it was.
 *
 * The rule for where the tiling stops is the simplest honest one: the drag's
 * end snaps to a bar line, whole repeats fill the span, and the last copy is
 * trimmed to end on that bar line when the span is not a whole number of
 * repeats. (Trimming keeps `clipOffsetTicks`, so it plays the clip's own
 * first bars.) A drag that ends at or before the source's end tiles nothing;
 * the controller resizes instead, which is how a clip is trimmed shorter.
 */

import { addPlacement, overwritePlacements } from "../commands/definitions/placements";
import { executeTransaction } from "../commands/execute";
import type { RawCommandInput } from "../commands/types";
import type { Placement, Project } from "../domain/entities";
import type { PlacementId } from "../domain/ids";
import { toTicks } from "../domain/time";
import { findPlacement, snapToBar } from "./placementGeometry";

/** The bar-snapped end a drag to `pointerTicks` asks the tiling to reach. */
export const tileTarget = snapToBar;

/** The linked copies filling `[source end, targetEnd)`; `idAt(k)` names the
 * k-th, so a drag that grows and shrinks keeps naming the same copies. */
export function tilePlacements(
  source: Placement,
  targetEnd: number,
  idAt: (index: number) => PlacementId,
): Placement[] {
  const copies: Placement[] = [];
  const length = source.durationTicks;
  let start = source.startTicks + length;
  while (start < targetEnd) {
    copies.push({
      ...source,
      id: idAt(copies.length),
      startTicks: toTicks(start),
      durationTicks: toTicks(Math.min(length, targetEnd - start)),
    });
    start += length;
  }
  return copies;
}

/** The commands that add the tiles, without resolving what they cover. */
export function tileCommands(
  project: Project,
  placementId: PlacementId,
  targetEnd: number,
  idAt: (index: number) => PlacementId,
): { commands: RawCommandInput[]; placementIds: PlacementId[] } {
  const source = findPlacement(project, placementId);
  const copies = source ? tilePlacements(source, targetEnd, idAt) : [];
  return {
    commands: copies.map((copy) => addPlacement(copy)),
    placementIds: copies.map((copy) => copy.id),
  };
}

/** The drop's overwrite (#290): each copy wins the ticks it landed on, resolved
 * one copy at a time against the project the previous one left. */
export function tileOverwrites(
  project: Project,
  placementIds: readonly PlacementId[],
  newPlacementId: () => PlacementId,
): RawCommandInput[] {
  const commands: RawCommandInput[] = [];
  let at = project;
  for (const id of placementIds) {
    const landed = findPlacement(at, id);
    if (!landed) continue;
    const overwrite = overwritePlacements(at, landed, newPlacementId);
    if (overwrite.length === 0) continue;
    const stepped = executeTransaction(at, overwrite, {
      commitRevision: false,
      deferredInvariants: ["placement_overlap"],
    });
    if (!stepped.ok) continue;
    commands.push(...overwrite);
    at = stepped.project;
  }
  return commands;
}
