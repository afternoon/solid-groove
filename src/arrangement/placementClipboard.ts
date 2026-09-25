/**
 * The arrangement clipboard and placement creation (`ARR-002`; PRD ARR-01:
 * "copy, cut, paste, duplicate, and delete work for selected placements").
 *
 * Copy/cut capture a placement's fields into a plain, project-independent
 * entry; paste re-resolves the clip from the *live* project and places what it
 * still can. That indirection is deliberate — a clipboard holding a snapshot of
 * clip *content* would let a paste resurrect a clip the user deleted in
 * between, so the clipboard holds only a reference, and an entry whose clip is
 * gone is skipped rather than recreated.
 *
 * Like the rest of placement editing, everything here is pure: the caller hands
 * the returned commands to `CommandHistory` as one atomic transaction, and
 * every created entity carries an explicit ID from the injected `IdFactory`.
 */

import { addPlacement, overwritePlacements } from "../commands/definitions/placements";
import { executeTransaction } from "../commands/execute";
import type { RawCommandInput } from "../commands/types";
import type { Clip, Project } from "../domain/entities";
import type { IdFactory, PlacementId, TrackId } from "../domain/ids";
import { toTicks } from "../domain/time";
import type { DuplicateResult } from "./placementDuplication";
import {
  clampDuration,
  clampTick,
  deletePlacements,
  findClip,
  findPlacement,
  MAX_ARRANGEMENT_TICKS,
  snapToBar,
} from "./placementGeometry";

/**
 * A copied placement, held by the UI between copy/cut and paste. It carries the
 * placement's own fields plus, for a clip the project may no longer contain by
 * the time of the paste (a cut whose clip was then deleted), nothing at all —
 * paste re-resolves the clip from the live project and declines if it is gone,
 * rather than resurrecting content from a stale snapshot.
 */
export interface PlacementClipboardEntry {
  readonly clipId: Clip["id"];
  readonly trackId: TrackId;
  readonly startTicks: number;
  readonly durationTicks: number;
  readonly clipOffsetTicks: number;
  readonly looped: boolean;
}

export function copyPlacements(
  project: Project,
  placementIds: readonly PlacementId[],
): PlacementClipboardEntry[] {
  const entries: PlacementClipboardEntry[] = [];
  for (const id of placementIds) {
    const placement = findPlacement(project, id);
    if (!placement) continue;
    entries.push({
      clipId: placement.clipId,
      trackId: placement.trackId,
      startTicks: placement.startTicks,
      durationTicks: placement.durationTicks,
      clipOffsetTicks: placement.clipOffsetTicks,
      looped: placement.looped,
    });
  }
  return entries;
}

/** Copy-then-delete: the clipboard content plus the commands that remove them. */
export function cutPlacements(
  project: Project,
  placementIds: readonly PlacementId[],
): {
  readonly clipboard: PlacementClipboardEntry[];
  readonly commands: RawCommandInput[];
} {
  return {
    clipboard: copyPlacements(project, placementIds),
    commands: deletePlacements(project, placementIds),
  };
}

export interface PasteOptions {
  /** Where the copied stretch began, so a range's leading gap survives the
   * paste. Defaults to the earliest entry's start. */
  readonly anchorTicks?: number;
  /** Snap the target to the nearest bar. Off when pasting at a selection,
   * which already names an exact position. Defaults to on. */
  readonly snap?: boolean;
}

/** The commands a paste runs, and the placements it creates. */
export interface PasteResult {
  readonly commands: RawCommandInput[];
  readonly placementIds: PlacementId[];
}

/**
 * Paste the clipboard at a target tick, preserving the relative offsets
 * between the copied placements so a multi-placement paste keeps its shape.
 * Each entry lands on its own clip's track, the only track that clip may be
 * placed on. What it lands on is overwritten, as a drop or a created placement
 * overwrites (#290), one entry after another so two pasted pieces never edit
 * the same neighbour twice. A clip that no longer exists is skipped — the
 * paste places what it still can rather than failing the whole transaction or
 * inventing content.
 */
export function pasteClipboard(
  project: Project,
  clipboard: readonly PlacementClipboardEntry[],
  targetTicks: number,
  ids: IdFactory,
  options: PasteOptions = {},
): PasteResult {
  if (clipboard.length === 0) return { commands: [], placementIds: [] };
  const anchor =
    options.anchorTicks ?? Math.min(...clipboard.map((entry) => entry.startTicks));
  const target = options.snap === false ? clampTick(targetTicks) : snapToBar(targetTicks);
  const commands: RawCommandInput[] = [];
  const placementIds: PlacementId[] = [];
  let working = project;
  for (const entry of clipboard) {
    if (!findClip(project, entry.clipId)) continue;
    const startTicks = toTicks(clampTick(target + (entry.startTicks - anchor)));
    if (startTicks + entry.durationTicks > MAX_ARRANGEMENT_TICKS) continue;
    const placement = {
      id: ids("placement"),
      clipId: entry.clipId,
      trackId: entry.trackId,
      startTicks,
      durationTicks: toTicks(entry.durationTicks),
      clipOffsetTicks: toTicks(entry.clipOffsetTicks),
      looped: entry.looped,
    };
    const step = [
      ...overwritePlacements(working, placement, () => ids("placement")),
      addPlacement(placement),
    ];
    const applied = executeTransaction(working, step, { commitRevision: false });
    if (!applied.ok) continue;
    working = applied.project;
    commands.push(...step);
    placementIds.push(placement.id);
  }
  return { commands, placementIds };
}

/** `pasteClipboard`'s commands alone, bar-snapped at the target. */
export function pastePlacements(
  project: Project,
  clipboard: readonly PlacementClipboardEntry[],
  targetTicks: number,
  ids: IdFactory,
): RawCommandInput[] {
  return pasteClipboard(project, clipboard, targetTicks, ids).commands;
}

/**
 * Place an existing clip on its own track at a bar-snapped tick — the
 * "create a placement" gesture, e.g. double-clicking empty arrangement space.
 */
export function createPlacementAt(
  project: Project,
  clipId: Clip["id"],
  startTicks: number,
  ids: IdFactory,
): DuplicateResult {
  const clip = findClip(project, clipId);
  if (!clip) return { commands: [], placementId: null };
  const start = snapToBar(startTicks);
  const durationTicks = clampDuration(start, clip.lengthTicks);
  if (start + durationTicks > MAX_ARRANGEMENT_TICKS) {
    return { commands: [], placementId: null };
  }
  const placementId = ids("placement");
  const placement = {
    id: placementId,
    clipId: clip.id,
    trackId: clip.trackId,
    startTicks: start,
    durationTicks,
    clipOffsetTicks: toTicks(0),
    looped: false,
  };
  // The new placement wins the ticks it lands on (#290 overwrite).
  return {
    commands: [
      ...overwritePlacements(project, placement, () => ids("placement")),
      addPlacement(placement),
    ],
    placementId,
  };
}
