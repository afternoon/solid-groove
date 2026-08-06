/**
 * Arrangement outline templates: the loop-to-song structures (`ARR-003`; PRD
 * ARR-03).
 *
 * ARR-03 asks for "at least one editable structure template" that turns a
 * selected loop range into a named arrangement. A template here is nothing but
 * an ordered list of section names with a length in bars each — it is a *shape*,
 * not a document. `buildOutline` (in `arrangementOutline.ts`) reads one and
 * emits commands; nothing in this file knows what a project is.
 *
 * "Editable" is the important word, and it is satisfied by construction rather
 * than by a special edit mode: the outline is created out of ordinary
 * `section.create` / `clip.create` / `placement.create` commands, so once it
 * exists every section can be renamed, resized, recolored, and reordered with
 * the same commands any hand-made section uses, and the whole creation is one
 * transaction that undoes atomically.
 *
 * A template's `id` is also its analytics `template_id`, pinned in
 * `src/analytics/catalog.ts` as `OUTLINE_TEMPLATE_IDS` and typed against it
 * here, so a template cannot be added without deciding how it appears in a
 * report. A template's *label* may be reworded freely; its ID may not, because
 * renaming one splits a metric across two values for the same behavior.
 */

import type { OutlineTemplateId } from "../analytics/catalog";

/** A step in a template: one section, this many bars long. */
export interface OutlineStep {
	readonly name: string;
	readonly bars: number;
}

export interface OutlineTemplate {
	/** Stable analytics key; see the module comment on why it never changes. */
	readonly id: OutlineTemplateId;
	/** What the picker shows. Free to reword; the ID is the contract. */
	readonly label: string;
	readonly description: string;
	readonly steps: readonly OutlineStep[];
}

/**
 * The alpha's structure templates.
 *
 * Three shapes rather than one, because ARR-03's floor is "at least one" and a
 * single template would make the feature read as a fixed song form. They are
 * deliberately short and generic: an outline is a starting point the producer
 * then edits, so a longer template mostly means more sections to delete.
 */
export const OUTLINE_TEMPLATES: readonly OutlineTemplate[] = [
	{
		id: "basic_song",
		label: "Basic song",
		description: "Intro, two verses around a chorus, and an outro.",
		steps: [
			{ name: "Intro", bars: 4 },
			{ name: "Verse", bars: 8 },
			{ name: "Chorus", bars: 8 },
			{ name: "Verse", bars: 8 },
			{ name: "Chorus", bars: 8 },
			{ name: "Outro", bars: 4 },
		],
	},
	{
		id: "electronic_build",
		label: "Electronic build",
		description: "Intro, build, drop, breakdown, second drop, outro.",
		steps: [
			{ name: "Intro", bars: 8 },
			{ name: "Build", bars: 8 },
			{ name: "Drop", bars: 16 },
			{ name: "Breakdown", bars: 8 },
			{ name: "Drop", bars: 16 },
			{ name: "Outro", bars: 8 },
		],
	},
	{
		id: "aaba",
		label: "AABA",
		description: "Four eight-bar sections: A, A, bridge, A.",
		steps: [
			{ name: "A", bars: 8 },
			{ name: "A", bars: 8 },
			{ name: "Bridge", bars: 8 },
			{ name: "A", bars: 8 },
		],
	},
];

export function findOutlineTemplate(id: string): OutlineTemplate | undefined {
	return OUTLINE_TEMPLATES.find((template) => template.id === id);
}

/** How many bars a template spans end to end. */
export function templateBars(template: OutlineTemplate): number {
	return template.steps.reduce((total, step) => total + step.bars, 0);
}
