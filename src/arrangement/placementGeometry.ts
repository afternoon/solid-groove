/**
 * Bar-snapped placement geometry edits for the arrangement (`ARR-002`; PRD
 * CLP-01, ARR-01).
 *
 * The gestures that change *where and how long* a placement is — bar-snapped
 * move, edge resize, loop toggle, and delete — as pure functions from the
 * current `Project` and the user's intent to typed command inputs. Nothing here
 * holds state, imports DOM/Canvas/SolidJS, or mutates the project: the caller
 * hands the commands to `CommandHistory`, which applies them as one atomic
 * transaction producing one revision and one undo entry. An operation that
 * would change nothing returns no commands, so a drag ending where it started
 * never burns a history entry. Duplication and the clipboard live next door in
 * `placementDuplication.ts`, built on this module's snapping and bounds.
 *
 * Nothing here uses an array index as identity: placements and clips are found
 * by schema-v1 prefixed ID (PRD CLP-01, 9.6).
 */

import {
	removePlacement,
	updatePlacement,
} from "../commands/definitions/placements";
import type { RawCommandInput } from "../commands/types";
import type { Clip, Placement, Project } from "../domain/entities";
import type { PlacementId, TrackId } from "../domain/ids";
import { TICKS_PER_BAR, type Ticks, toTicks } from "../domain/time";

/**
 * The longest arrangement position the alpha guarantees, in ticks (PRD ARR-01's
 * 10:00 floor). It is a *tick* bound derived from the slowest supported tempo:
 * ten minutes at 40 BPM (the bottom of the AUD-02 range) is the largest tick
 * position ten minutes can reach at any higher tempo, so clamping here never
 * truncates an arrangement that is legal at some supported tempo. Editing
 * clamps to it so a drag at extreme zoom-out cannot fling a placement to tick
 * 10^9; longer arrangements may still work, they are simply not guaranteed.
 */
export const MAX_ARRANGEMENT_TICKS = (10 * 40 * TICKS_PER_BAR) / 4;

/** Snaps a tick to the nearest bar line — ARR-01's default snapping. */
export function snapToBar(ticks: number): Ticks {
	const snapped = Math.round(ticks / TICKS_PER_BAR) * TICKS_PER_BAR;
	return toTicks(clampTick(snapped));
}

/** Snaps down to the bar line at or before `ticks`. */
export function floorToBar(ticks: number): Ticks {
	const snapped = Math.floor(ticks / TICKS_PER_BAR) * TICKS_PER_BAR;
	return toTicks(clampTick(snapped));
}

/** Clamps a raw tick into `[0, MAX_ARRANGEMENT_TICKS]`, treating NaN as zero. */
export function clampTick(ticks: number): number {
	if (!Number.isFinite(ticks)) return 0;
	return Math.max(0, Math.min(MAX_ARRANGEMENT_TICKS, Math.round(ticks)));
}

/** A duration is at least one bar and never runs past the guaranteed bound. */
export function clampDuration(
	startTicks: number,
	durationTicks: number,
): Ticks {
	const maxDuration = Math.max(
		TICKS_PER_BAR,
		MAX_ARRANGEMENT_TICKS - startTicks,
	);
	const bars = Math.max(1, Math.round(durationTicks / TICKS_PER_BAR));
	return toTicks(Math.min(bars * TICKS_PER_BAR, maxDuration));
}

export function findPlacement(
	project: Project,
	placementId: PlacementId,
): Placement | undefined {
	return project.song.placements.find(
		(placement) => placement.id === placementId,
	);
}

export function findClip(
	project: Project,
	clipId: Clip["id"],
): Clip | undefined {
	return project.clips.find((clip) => clip.id === clipId);
}

/**
 * Move a placement to a bar-snapped start tick, optionally onto another track.
 * A cross-track move is only legal when the target track already owns the clip
 * — `placement.update`'s integrity check rejects re-parenting otherwise, and
 * silently forking a copy behind the user's back would be exactly the "reuse or
 * fork?" ambiguity CLP-01 exists to remove. `canMoveToTrack` is how a UI asks
 * before offering the drop.
 */
export function movePlacement(
	project: Project,
	placementId: PlacementId,
	startTicks: number,
	trackId?: TrackId,
): RawCommandInput[] {
	const placement = findPlacement(project, placementId);
	if (!placement) return [];
	const nextStart = snapToBar(startTicks);
	const nextTrackId = trackId ?? placement.trackId;
	if (nextStart === placement.startTicks && nextTrackId === placement.trackId) {
		return [];
	}
	if (
		nextTrackId !== placement.trackId &&
		!canMoveToTrack(project, placement, nextTrackId)
	) {
		return [];
	}
	return [
		updatePlacement(placementId, {
			startTicks: nextStart,
			...(nextTrackId === placement.trackId ? {} : { trackId: nextTrackId }),
		}),
	];
}

/** True when `track` already owns the placement's clip, so a move is legal. */
export function canMoveToTrack(
	project: Project,
	placement: Placement,
	trackId: TrackId,
): boolean {
	if (placement.trackId === trackId) return true;
	const clip = findClip(project, placement.clipId);
	return clip?.trackId === trackId;
}

/**
 * Resize a placement by dragging one edge to a bar-snapped tick. The end edge
 * changes duration alone. The start edge moves the start *and* shortens the
 * duration by the same amount, so the far edge stays put, advancing
 * `clipOffsetTicks` in step so clip content does not slide out from under it.
 */
export function resizePlacement(
	project: Project,
	placementId: PlacementId,
	edge: "start" | "end",
	ticks: number,
): RawCommandInput[] {
	const placement = findPlacement(project, placementId);
	if (!placement) return [];
	const endTicks = placement.startTicks + placement.durationTicks;

	if (edge === "end") {
		const nextEnd = Math.max(
			placement.startTicks + TICKS_PER_BAR,
			snapToBar(ticks),
		);
		const durationTicks = clampDuration(
			placement.startTicks,
			nextEnd - placement.startTicks,
		);
		if (durationTicks === placement.durationTicks) return [];
		return [updatePlacement(placementId, { durationTicks })];
	}

	const nextStart = Math.min(snapToBar(ticks), endTicks - TICKS_PER_BAR);
	if (nextStart === placement.startTicks) return [];
	const delta = nextStart - placement.startTicks;
	return [
		updatePlacement(placementId, {
			startTicks: toTicks(clampTick(nextStart)),
			durationTicks: clampDuration(nextStart, placement.durationTicks - delta),
			// Trimming the head skips that much of the clip; extending it rewinds,
			// never below the clip's own start.
			clipOffsetTicks: toTicks(Math.max(0, placement.clipOffsetTicks + delta)),
		}),
	];
}

/** Toggle the loop flag (ARR-01 / KEY-01 `arrangement.toggle_loop`). */
export function setPlacementLooped(
	project: Project,
	placementId: PlacementId,
	looped: boolean,
): RawCommandInput[] {
	const placement = findPlacement(project, placementId);
	if (!placement || placement.looped === looped) return [];
	return [updatePlacement(placementId, { looped })];
}

export function deletePlacements(
	project: Project,
	placementIds: readonly PlacementId[],
): RawCommandInput[] {
	return placementIds
		.filter((id) => findPlacement(project, id) !== undefined)
		.map((id) => removePlacement(id));
}
