import { z } from "zod";
import { type Section, sectionSchema } from "../../domain/entities";
import { type SectionId, sectionIdSchema } from "../../domain/ids";
import { quoted, withSong } from "../projectEdits";
import {
	applied,
	type CommandInput,
	defineCommand,
	eraseCommand,
	type RegisteredCommand,
	rejected,
} from "../types";

/**
 * Song-section commands (`ARR-003`; PRD ARR-02).
 * A section labels a *range of the same timeline* — it holds no audio of its
 * own (ARR-02: "Section markers do not contain hidden audio"), so nothing here
 * ever creates, copies, or deletes a clip, and deleting a section leaves every
 * placement it labelled exactly where it was. Sections are stored unordered in
 * `song.sections`; their order *is* their `startTicks`, which is why `add`,
 * `rename`, `resize`, and `color` are all this module needs — reordering is a
 * timeline operation rather than an array shuffle, and lands next as
 * `section.reorder`. These commands are the one mutation path the section UI, a
 * template, and the assistant all share (ARR-02: "Templates and the assistant
 * can create section markers through the shared command API").
 */

export const sectionCreatePayloadSchema = z.strictObject({
	section: sectionSchema,
});
export type SectionCreatePayload = z.infer<typeof sectionCreatePayloadSchema>;

export const sectionDeletePayloadSchema = z.strictObject({
	sectionId: sectionIdSchema,
});
export type SectionDeletePayload = z.infer<typeof sectionDeletePayloadSchema>;

export const sectionChangesSchema = z
	.strictObject({
		name: sectionSchema.shape.name.optional(),
		color: sectionSchema.shape.color.optional(),
		startTicks: sectionSchema.shape.startTicks.optional(),
		durationTicks: sectionSchema.shape.durationTicks.optional(),
	})
	.refine(
		(changes) => Object.values(changes).some((value) => value !== undefined),
		{ message: "An update must change at least one field" },
	);
export type SectionChanges = z.infer<typeof sectionChangesSchema>;

export const sectionUpdatePayloadSchema = z.strictObject({
	sectionId: sectionIdSchema,
	changes: sectionChangesSchema,
});
export type SectionUpdatePayload = z.infer<typeof sectionUpdatePayloadSchema>;

export function findSection(
	sections: readonly Section[],
	sectionId: SectionId,
): Section | undefined {
	return sections.find((section) => section.id === sectionId);
}

export const sectionCreateCommand = defineCommand<SectionCreatePayload>({
	type: "section.create",
	version: 1,
	schema: sectionCreatePayloadSchema,
	summarize: (payload) => `Add section ${quoted(payload.section.name)}`,
	apply(project, payload) {
		if (findSection(project.song.sections, payload.section.id)) {
			return rejected(`Section ${payload.section.id} already exists`);
		}
		return applied(
			withSong(project, {
				...project.song,
				sections: [...project.song.sections, payload.section],
			}),
		);
	},
	invert: (payload) => [removeSection(payload.section.id)],
});

export const sectionDeleteCommand = defineCommand<SectionDeletePayload>({
	type: "section.delete",
	version: 1,
	schema: sectionDeletePayloadSchema,
	summarize(payload, project) {
		const section = findSection(project.song.sections, payload.sectionId);
		return section
			? `Remove section ${quoted(section.name)}`
			: "Remove a section";
	},
	apply(project, payload) {
		const section = findSection(project.song.sections, payload.sectionId);
		if (!section) {
			return rejected(`Section ${payload.sectionId} does not exist`);
		}
		// Deleting a label never deletes what it labelled: placements stay exactly
		// where they are (ARR-02, "section markers do not contain hidden audio").
		return applied(
			withSong(project, {
				...project.song,
				sections: project.song.sections.filter(
					(candidate) => candidate.id !== section.id,
				),
			}),
		);
	},
	invert(payload, before) {
		const section = findSection(before.song.sections, payload.sectionId);
		return section ? [addSection(section)] : [];
	},
});

export const sectionUpdateCommand = defineCommand<SectionUpdatePayload>({
	type: "section.update",
	version: 1,
	schema: sectionUpdatePayloadSchema,
	summarize(payload, project) {
		const section = findSection(project.song.sections, payload.sectionId);
		const label = section ? quoted(section.name) : "a section";
		if (payload.changes.name !== undefined) {
			return `Rename ${label} to ${quoted(payload.changes.name)}`;
		}
		if (payload.changes.durationTicks !== undefined) {
			return `Resize section ${label}`;
		}
		if (payload.changes.startTicks !== undefined) {
			return `Move section ${label}`;
		}
		return `Recolor section ${label}`;
	},
	apply(project, payload) {
		const section = findSection(project.song.sections, payload.sectionId);
		if (!section) {
			return rejected(`Section ${payload.sectionId} does not exist`);
		}
		const next: Section = {
			...section,
			...(payload.changes.name !== undefined
				? { name: payload.changes.name }
				: {}),
			...(payload.changes.color !== undefined
				? { color: payload.changes.color }
				: {}),
			...(payload.changes.startTicks !== undefined
				? { startTicks: payload.changes.startTicks }
				: {}),
			...(payload.changes.durationTicks !== undefined
				? { durationTicks: payload.changes.durationTicks }
				: {}),
		};
		return applied(
			withSong(project, {
				...project.song,
				sections: project.song.sections.map((candidate) =>
					candidate.id === next.id ? next : candidate,
				),
			}),
		);
	},
	invert(payload, before) {
		const section = findSection(before.song.sections, payload.sectionId);
		if (!section) return [];
		return [
			updateSection(payload.sectionId, {
				...(payload.changes.name !== undefined ? { name: section.name } : {}),
				...(payload.changes.color !== undefined
					? { color: section.color }
					: {}),
				...(payload.changes.startTicks !== undefined
					? { startTicks: section.startTicks }
					: {}),
				...(payload.changes.durationTicks !== undefined
					? { durationTicks: section.durationTicks }
					: {}),
			}),
		];
	},
});

// --- Typed builders -------------------------------------------------------

export function addSection(
	section: Section,
): CommandInput<SectionCreatePayload> {
	return { type: sectionCreateCommand.type, payload: { section } };
}

export function removeSection(
	sectionId: SectionId,
): CommandInput<SectionDeletePayload> {
	return { type: sectionDeleteCommand.type, payload: { sectionId } };
}

export function updateSection(
	sectionId: SectionId,
	changes: SectionChanges,
): CommandInput<SectionUpdatePayload> {
	return { type: sectionUpdateCommand.type, payload: { sectionId, changes } };
}

/** Registered, payload-erased commands from this module. */
export const sectionCommands: readonly RegisteredCommand[] = [
	eraseCommand(sectionCreateCommand),
	eraseCommand(sectionDeleteCommand),
	eraseCommand(sectionUpdateCommand),
];
