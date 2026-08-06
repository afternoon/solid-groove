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

import { addPlacement } from "../commands/definitions/placements";
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

/**
 * Paste the clipboard at a bar-snapped target tick, preserving the relative
 * offsets between the copied placements so a multi-placement paste keeps its
 * shape. A clip that no longer exists is skipped — the paste places what it
 * still can rather than failing the whole transaction or inventing content.
 */
export function pastePlacements(
	project: Project,
	clipboard: readonly PlacementClipboardEntry[],
	targetTicks: number,
	ids: IdFactory,
): RawCommandInput[] {
	if (clipboard.length === 0) return [];
	const anchor = Math.min(...clipboard.map((entry) => entry.startTicks));
	const target = snapToBar(targetTicks);
	const commands: RawCommandInput[] = [];
	for (const entry of clipboard) {
		if (!findClip(project, entry.clipId)) continue;
		const startTicks = toTicks(clampTick(target + (entry.startTicks - anchor)));
		if (startTicks + entry.durationTicks > MAX_ARRANGEMENT_TICKS) continue;
		commands.push(
			addPlacement({
				id: ids("placement"),
				clipId: entry.clipId,
				trackId: entry.trackId,
				startTicks,
				durationTicks: toTicks(entry.durationTicks),
				clipOffsetTicks: toTicks(entry.clipOffsetTicks),
				looped: entry.looped,
			}),
		);
	}
	return commands;
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
	return {
		commands: [
			addPlacement({
				id: placementId,
				clipId: clip.id,
				trackId: clip.trackId,
				startTicks: start,
				durationTicks,
				clipOffsetTicks: toTicks(0),
				looped: false,
			}),
		],
		placementId,
	};
}
