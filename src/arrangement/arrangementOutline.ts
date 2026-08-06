/**
 * Loop-to-song: turning a selected loop range into an arrangement outline
 * (`ARR-003`; PRD ARR-03).
 *
 * A pure function from `(project, loop range, template, mode)` to typed command
 * inputs, in the same style as `placementGeometry`/`placementDuplication` next
 * door. Nothing here mutates a project or touches the DOM: the caller hands the
 * whole list to `CommandHistory` as **one transaction**, which is what makes
 * ARR-03's "can be undone atomically" true by construction rather than by a
 * bespoke rollback.
 *
 * ## What it does, and what it deliberately does not
 * ARR-03: "It duplicates placements into named sections without destructively
 * modifying source clips." So this only ever *appends*: it emits
 * `section.create` for each template step, and `placement.create` (plus, in
 * independent mode, `clip.create`) to repeat the loop's placements across those
 * sections. It emits no `placement.update` and no `clip.update` — the source
 * range is left byte-for-byte as it was, and the outline is built after it.
 *
 * ## Linked or copied is the user's explicit choice
 * `OutlineMode` mirrors `DuplicateMode` from `placementDuplication.ts` and
 * carries the same CLP-01 property: `"linked"` repeats the *same* clip, so
 * editing the loop once changes every section that uses it; `"independent"`
 * forks a deep copy per section, so each section can diverge. `describeOutline`
 * renders the sentence the UI shows *before* the action runs, generated from the
 * same mode the action takes, so the label cannot drift from the behavior.
 *
 * The result is immediately playable because the outline is made of ordinary
 * placements on existing tracks: `useProjectAudio` rebuilds the audio projection
 * from the new project like it would for any other edit, with no separate
 * "render the outline" step.
 */

import { addClip, addPlacement } from "../commands";
import { addSection } from "../commands/definitions/sections";
import type { RawCommandInput } from "../commands/types";
import type { Placement, Project, Section } from "../domain/entities";
import type { IdFactory, SectionId } from "../domain/ids";
import { TICKS_PER_BAR, toTicks } from "../domain/time";
import type { OutlineTemplate } from "./outlineTemplates";
import { copyClip } from "./placementDuplication";
import { findClip, MAX_ARRANGEMENT_TICKS } from "./placementGeometry";

/** Whether each repeat reuses the loop's clips or forks its own copies. */
export type OutlineMode = "linked" | "independent";

/** The sentence the UI shows *before* the outline is created (CLP-01/ARR-03). */
export function describeOutline(mode: OutlineMode): string {
	return mode === "linked"
		? "Build the outline from linked copies — editing the loop changes every section that uses it"
		: "Build the outline from independent copies — each section can be edited on its own";
}

export interface OutlineRequest {
	readonly project: Project;
	readonly template: OutlineTemplate;
	readonly mode: OutlineMode;
	/** The loop range to repeat, in ticks. Bar-aligned by the caller. */
	readonly loopStartTicks: number;
	readonly loopEndTicks: number;
	/** Where the outline begins. Defaults to the end of the existing sections. */
	readonly startTicks?: number;
	readonly ids: IdFactory;
}

export interface OutlineResult {
	readonly commands: readonly RawCommandInput[];
	readonly sectionIds: readonly SectionId[];
	/** How many sections the outline created — the OPS-02 `section_count`. */
	readonly sectionCount: number;
	/**
	 * Why nothing was produced, when `commands` is empty. The UI shows this
	 * rather than silently doing nothing (ARR-03's empty state).
	 */
	readonly refusal: OutlineRefusal | null;
}

export type OutlineRefusal =
	| "empty_loop"
	| "no_placements_in_loop"
	| "exceeds_arrangement_bound";

const EMPTY = (refusal: OutlineRefusal): OutlineResult => ({
	commands: [],
	sectionIds: [],
	sectionCount: 0,
	refusal,
});

/** Placements whose start lies inside `[start, end)` — the loop's contents. */
export function placementsInRange(
	project: Project,
	startTicks: number,
	endTicks: number,
): readonly Placement[] {
	return project.song.placements.filter(
		(placement) =>
			placement.startTicks >= startTicks && placement.startTicks < endTicks,
	);
}

/** The first free tick after every existing section and placement. */
export function defaultOutlineStart(project: Project): number {
	const ends = [
		...project.song.sections.map((s) => s.startTicks + s.durationTicks),
		...project.song.placements.map((p) => p.startTicks + p.durationTicks),
		0,
	];
	const end = Math.max(...ends);
	// Start on the next bar line, so the outline never begins mid-bar.
	return Math.ceil(end / TICKS_PER_BAR) * TICKS_PER_BAR;
}

/**
 * Build the outline. Each template step becomes one section; the loop's placements are repeated
 * into it as many whole times as the step is long, so an 8-bar step over a
 * 2-bar loop gets four repeats. Every created entity carries an explicit ID
 * minted from the injected `IdFactory` (PRD 9.6), so replay, redo, and an
 * assistant preview all reproduce the same project.
 */
export function buildOutline(request: OutlineRequest): OutlineResult {
	const { project, template, mode, ids } = request;
	const loopStart = Math.min(request.loopStartTicks, request.loopEndTicks);
	const loopEnd = Math.max(request.loopStartTicks, request.loopEndTicks);
	const loopLength = loopEnd - loopStart;
	if (loopLength < TICKS_PER_BAR) return EMPTY("empty_loop");

	const sources = placementsInRange(project, loopStart, loopEnd);
	if (sources.length === 0) return EMPTY("no_placements_in_loop");

	const outlineStart = request.startTicks ?? defaultOutlineStart(project);
	const totalTicks = template.steps.reduce(
		(total, step) => total + step.bars * TICKS_PER_BAR,
		0,
	);
	if (outlineStart + totalTicks > MAX_ARRANGEMENT_TICKS) {
		return EMPTY("exceeds_arrangement_bound");
	}

	const commands: RawCommandInput[] = [];
	const sectionIds: SectionId[] = [];
	// In independent mode each source clip is forked *once per section*, so two
	// sections can diverge from each other but the repeats inside one section
	// stay together — that is what "a section can be edited on its own" means.
	let cursor = outlineStart;

	for (const step of template.steps) {
		const durationTicks = step.bars * TICKS_PER_BAR;
		const section: Section = {
			id: ids("section"),
			name: step.name,
			color: project.song.sections[0]?.color ?? "#6b7280",
			startTicks: toTicks(cursor),
			durationTicks: toTicks(durationTicks),
		};
		commands.push(addSection(section));
		sectionIds.push(section.id);

		const clipForSource = new Map<string, string>();
		if (mode === "independent") {
			for (const source of sources) {
				if (clipForSource.has(source.clipId)) continue;
				const original = findClip(project, source.clipId);
				if (!original) continue;
				const copy = copyClip(original, ids);
				clipForSource.set(source.clipId, copy.id);
				commands.push(addClip(copy));
			}
		}

		const repeats = Math.max(1, Math.floor(durationTicks / loopLength));
		for (let repeat = 0; repeat < repeats; repeat += 1) {
			const offset = cursor + repeat * loopLength;
			for (const source of sources) {
				const startTicks = offset + (source.startTicks - loopStart);
				if (startTicks + source.durationTicks > cursor + durationTicks)
					continue;
				commands.push(
					addPlacement({
						...source,
						id: ids("placement"),
						clipId: (clipForSource.get(source.clipId) ??
							source.clipId) as Placement["clipId"],
						startTicks: toTicks(startTicks),
					}),
				);
			}
		}
		cursor += durationTicks;
	}

	return {
		commands,
		sectionIds,
		sectionCount: sectionIds.length,
		refusal: null,
	};
}
