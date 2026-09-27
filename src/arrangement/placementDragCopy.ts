/**
 * Alt-drag copy: every selected clip copied by one drag's offset (ARR-011).
 *
 * Pure, like `placementDuplication.ts` beside it, whose `copyClip` it reuses:
 * each copy is an independent clip with fresh IDs throughout, so an edit to a
 * copy is never heard in its original. The IDs are minted once, in the plan,
 * so a drag that moves its copies bar by bar keeps the same copies rather
 * than creating new ones at every step.
 */

import { addClip } from "../commands/definitions/clips";
import {
  addPlacement,
  overwritePlacements,
  updatePlacement,
} from "../commands/definitions/placements";
import { executeTransaction } from "../commands/execute";
import type { RawCommandInput } from "../commands/types";
import type { Clip, Placement, Project } from "../domain/entities";
import type { IdFactory, PlacementId } from "../domain/ids";
import { toTicks } from "../domain/time";
import { copyClip } from "./placementDuplication";
import { findClip, findPlacement, MAX_ARRANGEMENT_TICKS } from "./placementGeometry";

/** One source clip and the independent copy the drag makes of it. */
export interface DragCopy {
  readonly source: Placement;
  readonly clip: Clip;
  readonly placementId: PlacementId;
}

export type DragCopyPlan = readonly DragCopy[];

/** Plans a copy of each placement, minting every ID the copies will carry. */
export function planDragCopy(
  project: Project,
  placementIds: readonly PlacementId[],
  ids: IdFactory,
): DragCopyPlan {
  return placementIds.flatMap((id): DragCopy[] => {
    const source = findPlacement(project, id);
    const clip = source && findClip(project, source.clipId);
    if (!source || !clip) return [];
    return [{ source, clip: copyClip(clip, ids), placementId: ids("placement") }];
  });
}

/**
 * The offset the copies can actually take: the drag's, narrowed so that no
 * copy starts before the song or ends past the guaranteed bound. Keeping one
 * offset for the whole plan is what keeps the copies' spacing.
 */
export function clampCopyOffset(plan: DragCopyPlan, offsetTicks: number): number {
  let low = Number.NEGATIVE_INFINITY;
  let high = Number.POSITIVE_INFINITY;
  for (const { source } of plan) {
    low = Math.max(low, -source.startTicks);
    high = Math.min(
      high,
      MAX_ARRANGEMENT_TICKS - source.startTicks - source.durationTicks,
    );
  }
  return Math.max(low, Math.min(high, offsetTicks));
}

function copyAt(copy: DragCopy, offsetTicks: number): Placement {
  return {
    ...copy.source,
    id: copy.placementId,
    clipId: copy.clip.id,
    startTicks: toTicks(copy.source.startTicks + offsetTicks),
  };
}

/**
 * Commands that put every copy at `offsetTicks` from its source: created when
 * `placedAt` is null, moved from `placedAt` after that. Read off the plan, not
 * the project, so a step never depends on a project the UI has not caught up
 * with yet. Nothing is overwritten here; a drag passing over a clip leaves it
 * intact until the drop (#290).
 */
export function dragCopyCommands(
  plan: DragCopyPlan,
  offsetTicks: number,
  placedAt: number | null,
): RawCommandInput[] {
  if (placedAt === offsetTicks) return [];
  return plan.flatMap((copy): RawCommandInput[] => {
    const target = copyAt(copy, offsetTicks);
    return placedAt === null
      ? [addClip(copy.clip), addPlacement(target)]
      : [updatePlacement(copy.placementId, { startTicks: target.startTicks })];
  });
}

/**
 * The drop's overwrite: every copy wins the ticks it landed on, exactly as a
 * moved clip does (#290). Resolved one copy at a time against the project the
 * previous one left, so a clip two copies both cover is cut once, correctly.
 */
export function dragCopyOverwrites(
  project: Project,
  plan: DragCopyPlan,
  newPlacementId: () => PlacementId,
): RawCommandInput[] {
  const commands: RawCommandInput[] = [];
  let at = project;
  for (const copy of plan) {
    const landed = findPlacement(at, copy.placementId);
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
