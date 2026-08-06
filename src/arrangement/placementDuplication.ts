/**
 * Placement duplication: reuse versus independent variation (`ARR-002`; PRD
 * CLP-01).
 *
 * Built on the bar snapping and ten-minute bounds in `placementGeometry.ts`,
 * and pure in the same way: every function returns typed command inputs the
 * caller hands to `CommandHistory` as one atomic transaction, and none of them
 * mutate the project.
 *
 * The property CLP-01 turns on lives here: **reuse versus independent variation
 * is an explicit choice, not a heuristic.** `duplicatePlacement` takes a
 * `DuplicateMode`. `"linked"` emits one `placement.create` pointing at the
 * *same* clip, so editing either occurrence changes both — the whole reason the
 * schema separates placements from clip content (invariant 3). `"independent"`
 * emits a `clip.create` for a deep copy with fresh IDs — a new clip ID and a
 * fresh event ID for every note — followed by a `placement.create` pointing at
 * the copy, so the two can diverge. `describeDuplicate` renders the sentence
 * the UI shows *before* the gesture runs, so CLP-01's "the UI states which
 * operation will occur" is answered by the same module that performs it and
 * cannot drift from it.
 *
 * Everything created carries an explicit ID minted from the injected
 * `IdFactory`, so replay, redo, and an assistant preview all reproduce the same
 * project (PRD 9.6) — never an array position.
 */

import { addClip } from "../commands/definitions/clips";
import { addPlacement } from "../commands/definitions/placements";
import type { RawCommandInput } from "../commands/types";
import type { Clip, Project } from "../domain/entities";
import type { IdFactory, PlacementId } from "../domain/ids";
import { toTicks } from "../domain/time";
import {
	clampTick,
	findClip,
	findPlacement,
	MAX_ARRANGEMENT_TICKS,
} from "./placementGeometry";

/**
 * Which of CLP-01's two duplicate operations to perform. `"linked"` reuses the
 * source clip — the arrangement's whole reason for separating placements from
 * content — so an edit to either occurrence is heard in both. `"independent"`
 * forks a deep copy that can then diverge.
 */
export type DuplicateMode = "linked" | "independent";

/**
 * The sentence the UI shows *before* a duplicate runs, so the user knows which
 * of the two operations the affordance will perform (CLP-01: "the UI states
 * which operation will occur"). Generated from the same mode the operation
 * takes, so the label and the behavior cannot drift apart.
 */
export function describeDuplicate(mode: DuplicateMode): string {
	return mode === "linked"
		? "Duplicate as a linked copy — editing either occurrence changes both"
		: "Duplicate as an independent copy — the new clip can be edited on its own";
}

export interface DuplicateResult {
	readonly commands: RawCommandInput[];
	/** The new placement's ID, so a caller can select what it just created. */
	readonly placementId: PlacementId | null;
}

/**
 * Duplicate a placement immediately after itself, either reusing its clip or
 * forking an independent variation.
 *
 * The independent path copies the clip with a *fresh* ID and mints a fresh
 * event ID for every note it contains, so nothing about the copy shares
 * identity with the source; `clip.create` and `placement.create` then land in
 * one transaction, so a half-created variation is not reachable even if the
 * second command were to be rejected.
 */
export function duplicatePlacement(
	project: Project,
	placementId: PlacementId,
	mode: DuplicateMode,
	ids: IdFactory,
): DuplicateResult {
	const placement = findPlacement(project, placementId);
	if (!placement) return { commands: [], placementId: null };
	const startTicks = toTicks(
		clampTick(placement.startTicks + placement.durationTicks),
	);
	// A duplicate that would land beyond the guaranteed bound is refused rather
	// than silently stacked on top of its source.
	if (startTicks + placement.durationTicks > MAX_ARRANGEMENT_TICKS) {
		return { commands: [], placementId: null };
	}

	const newPlacementId = ids("placement");
	const commands: RawCommandInput[] = [];
	let clipId = placement.clipId;

	if (mode === "independent") {
		const source = findClip(project, placement.clipId);
		if (!source) return { commands: [], placementId: null };
		const copy = copyClip(source, ids);
		clipId = copy.id;
		commands.push(addClip(copy));
	}

	commands.push(
		addPlacement({
			...placement,
			id: newPlacementId,
			clipId,
			startTicks,
		}),
	);
	return { commands, placementId: newPlacementId };
}

/** A deep copy of a clip with fresh IDs throughout — never a shared reference. */
export function copyClip(clip: Clip, ids: IdFactory): Clip {
	return {
		...clip,
		id: ids("clip"),
		content:
			clip.content.kind === "notes"
				? {
						...clip.content,
						events: clip.content.events.map((event) => ({
							...event,
							id: ids("event"),
						})),
					}
				: { ...clip.content },
	};
}
