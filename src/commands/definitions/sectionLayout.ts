/**
 * Section reordering as a timeline layout (`ARR-003`; PRD ARR-02).
 *
 * Sections have no stored order field: their order *is* their `startTicks` on
 * the shared timeline. So "move Drop before Intro" is not an array shuffle — it
 * is a re-layout, and the placements sitting inside each section have to travel
 * with it, which is the requirement ARR-02 actually turns on ("Reordering a
 * section moves its contained clip placements as one undoable operation").
 *
 * Pure functions only: `layoutReorder` computes the new starts and the tick
 * delta each moved section's contents shift by, and `applyLayout` applies both
 * in one step. Keeping them here rather than in the command keeps the arithmetic
 * testable on its own and keeps `sections.ts` about commands.
 */

import type { Placement, Section, Song } from "../../domain/entities";
import type { SectionId } from "../../domain/ids";
import { toTicks } from "../../domain/time";

/** Sections in timeline order: by start, then by ID so ties are deterministic. */
export function sectionsInOrder(sections: readonly Section[]): Section[] {
	return [...sections].sort(
		(a, b) => a.startTicks - b.startTicks || a.id.localeCompare(b.id),
	);
}

export interface SectionReorderLayout {
	/** Every section, with its post-move start tick. */
	readonly sections: readonly Section[];
	/** Section ID to the tick delta its contained placements move by. */
	readonly deltas: ReadonlyMap<string, number>;
}

/**
 * Move one section to another index in timeline order.
 *
 * The whole run is re-laid-out back to back from where it currently starts, so
 * no gap opens between two sections and none of them overlap. Only the sections
 * between the source and destination actually move; everything outside that span
 * keeps its start tick and therefore gets no delta at all.
 *
 * Returns `null` when the section is unknown, when there is nothing to move, or
 * when the (clamped) destination is where the section already is — a no-op is
 * refused rather than committed, so a stray drag never burns a history entry.
 */
export function layoutReorder(
	sections: readonly Section[],
	sectionId: SectionId,
	toIndex: number,
): SectionReorderLayout | null {
	const ordered = sectionsInOrder(sections);
	const fromIndex = ordered.findIndex((section) => section.id === sectionId);
	if (fromIndex === -1 || ordered.length < 2) return null;
	const clampedTo = Math.max(0, Math.min(ordered.length - 1, toIndex));
	if (clampedTo === fromIndex) return null;

	const moved = [...ordered];
	const [section] = moved.splice(fromIndex, 1);
	moved.splice(clampedTo, 0, section);

	const deltas = new Map<string, number>();
	let cursor: number = ordered[0].startTicks;
	const next = moved.map((candidate) => {
		const startTicks = toTicks(cursor);
		cursor += candidate.durationTicks;
		if (startTicks === candidate.startTicks) return candidate;
		deltas.set(candidate.id, startTicks - candidate.startTicks);
		return { ...candidate, startTicks };
	});

	return { sections: next, deltas };
}

/**
 * True when a placement *starts* inside `[start, start + duration)`.
 *
 * Containment is decided by the start alone, deliberately. A placement that
 * begins in one section and runs past its end belongs to the section it began
 * in and moves once, with that section; a placement whose start is outside a
 * moved section is not dragged along just because its tail overlaps one. Any
 * rule based on overlap instead would move some placements twice when two
 * adjacent sections both move.
 */
function startsInside(placement: Placement, section: Section): boolean {
	return (
		placement.startTicks >= section.startTicks &&
		placement.startTicks < section.startTicks + section.durationTicks
	);
}

/**
 * Every section that actually moved, paired with its tick delta and its
 * *pre-move* range. `applyLayout` shifts placements by this; `ARR-004` reads the
 * same list to move automation breakpoints with a reordered section
 * ("Automation ... moves with reordered sections"), so the containment rule
 * lives in one place rather than being reimplemented alongside automation.
 */
export function movedSections(
	song: Song,
	layout: SectionReorderLayout,
): ReadonlyArray<{ readonly section: Section; readonly delta: number }> {
	return sectionsInOrder(song.sections)
		.map((section) => ({ section, delta: layout.deltas.get(section.id) ?? 0 }))
		.filter((entry) => entry.delta !== 0);
}

/**
 * Apply a layout to a song: sections take their new starts, and every placement
 * contained by a moved section shifts by that section's delta.
 */
export function applyLayout(song: Song, layout: SectionReorderLayout): Song {
	const shifts = movedSections(song, layout);
	if (shifts.length === 0) {
		return { ...song, sections: [...layout.sections] };
	}

	const placements = song.placements.map((placement) => {
		const shift = shifts.find((entry) =>
			startsInside(placement, entry.section),
		);
		if (!shift) return placement;
		const startTicks = toTicks(Math.max(0, placement.startTicks + shift.delta));
		return startTicks === placement.startTicks
			? placement
			: { ...placement, startTicks };
	});

	return { ...song, sections: [...layout.sections], placements };
}
