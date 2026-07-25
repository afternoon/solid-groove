import { z } from "zod";
import {
	type NoteEvent,
	noteEventSchema,
	noteTriggerSchema,
} from "../../domain/entities";
import {
	type ClipId,
	clipIdSchema,
	type EventId,
	eventIdSchema,
	type IdFactory,
} from "../../domain/ids";
import {
	NOTE_PROBABILITY,
	NOTE_VELOCITY,
	parameterValueSchema,
} from "../../domain/parameters";
import { durationTickSchema, tickSchema } from "../../domain/time";
import {
	clipLabel,
	findClip,
	findNoteEvent,
	noteEventsOf,
	pluralize,
	replaceClip,
	withNoteEvents,
} from "../projectEdits";
import {
	applied,
	type CommandInput,
	defineCommand,
	eraseCommand,
	type RegisteredCommand,
	rejected,
} from "../types";

/**
 * Note editing commands — the `FND-009` slice's write path.
 *
 * Payloads carry explicit event IDs rather than minting them inside `apply`,
 * so a command is a pure function of its payload: replaying it on redo, on a
 * peer, or in a test reproduces the same IDs and the same project.
 */

export const noteAddPayloadSchema = z.strictObject({
	clipId: clipIdSchema,
	notes: z.array(noteEventSchema).min(1),
});
export type NoteAddPayload = z.infer<typeof noteAddPayloadSchema>;

export const noteRemovePayloadSchema = z.strictObject({
	clipId: clipIdSchema,
	eventIds: z.array(eventIdSchema).min(1),
});
export type NoteRemovePayload = z.infer<typeof noteRemovePayloadSchema>;

/**
 * Which fields of a note an update may set. An absent key means "leave alone";
 * `probability: null` clears a probability that was set.
 */
export const noteChangesSchema = z
	.strictObject({
		trigger: noteTriggerSchema.optional(),
		startTicks: tickSchema.optional(),
		durationTicks: durationTickSchema.optional(),
		velocity: parameterValueSchema(NOTE_VELOCITY).optional(),
		probability: parameterValueSchema(NOTE_PROBABILITY).nullable().optional(),
	})
	.refine(
		(changes) => Object.values(changes).some((value) => value !== undefined),
		{ message: "An update must change at least one field" },
	);
export type NoteChanges = z.infer<typeof noteChangesSchema>;

export const noteUpdatePayloadSchema = z.strictObject({
	clipId: clipIdSchema,
	updates: z
		.array(
			z.strictObject({ eventId: eventIdSchema, changes: noteChangesSchema }),
		)
		.min(1),
});
export type NoteUpdatePayload = z.infer<typeof noteUpdatePayloadSchema>;

export const noteAddCommand = defineCommand<NoteAddPayload>({
	type: "note.add",
	version: 1,
	schema: noteAddPayloadSchema,
	summarize: (payload, project) =>
		`Add ${pluralize(payload.notes.length, "note")} to ${clipLabel(project, payload.clipId)}`,
	apply(project, payload) {
		const clip = findClip(project, payload.clipId);
		if (!clip) {
			return rejected(`Clip ${payload.clipId} does not exist`);
		}
		const events = noteEventsOf(clip);
		if (!events) {
			return rejected(`Clip ${clip.id} does not hold note content`);
		}
		const existing = new Set(events.map((event) => event.id));
		const duplicate = payload.notes.find((note) => existing.has(note.id));
		if (duplicate) {
			return rejected(`Note ${duplicate.id} already exists in clip ${clip.id}`);
		}
		return applied(
			replaceClip(project, withNoteEvents(clip, [...events, ...payload.notes])),
		);
	},
	invert: (payload) => [
		removeNotes(
			payload.clipId,
			payload.notes.map((note) => note.id),
		),
	],
});

export const noteRemoveCommand = defineCommand<NoteRemovePayload>({
	type: "note.remove",
	version: 1,
	schema: noteRemovePayloadSchema,
	summarize: (payload, project) =>
		`Delete ${pluralize(payload.eventIds.length, "note")} from ${clipLabel(project, payload.clipId)}`,
	apply(project, payload) {
		const clip = findClip(project, payload.clipId);
		if (!clip) {
			return rejected(`Clip ${payload.clipId} does not exist`);
		}
		const events = noteEventsOf(clip);
		if (!events) {
			return rejected(`Clip ${clip.id} does not hold note content`);
		}
		const removing = new Set<string>(payload.eventIds);
		const missing = payload.eventIds.filter(
			(eventId) => !events.some((event) => event.id === eventId),
		);
		if (missing.length > 0) {
			return rejected(
				`Clip ${clip.id} has no note ${missing.join(", ")} to delete`,
			);
		}
		return applied(
			replaceClip(
				project,
				withNoteEvents(
					clip,
					events.filter((event) => !removing.has(event.id)),
				),
			),
		);
	},
	invert(payload, before) {
		const clip = findClip(before, payload.clipId);
		const events = clip ? (noteEventsOf(clip) ?? []) : [];
		const removed = events.filter((event) =>
			payload.eventIds.includes(event.id),
		);
		return removed.length > 0 ? [addNotes(payload.clipId, removed)] : [];
	},
});

export const noteUpdateCommand = defineCommand<NoteUpdatePayload>({
	type: "note.update",
	version: 1,
	schema: noteUpdatePayloadSchema,
	summarize: (payload, project) =>
		`Edit ${pluralize(payload.updates.length, "note")} in ${clipLabel(project, payload.clipId)}`,
	apply(project, payload) {
		const clip = findClip(project, payload.clipId);
		if (!clip) {
			return rejected(`Clip ${payload.clipId} does not exist`);
		}
		const events = noteEventsOf(clip);
		if (!events) {
			return rejected(`Clip ${clip.id} does not hold note content`);
		}
		const changed = new Map<string, NoteEvent>();
		for (const update of payload.updates) {
			const source =
				changed.get(update.eventId) ?? findNoteEvent(clip, update.eventId);
			if (!source) {
				return rejected(
					`Clip ${clip.id} has no note ${update.eventId} to edit`,
				);
			}
			changed.set(update.eventId, applyNoteChanges(source, update.changes));
		}
		return applied(
			replaceClip(
				project,
				withNoteEvents(
					clip,
					events.map((event) => changed.get(event.id) ?? event),
				),
			),
		);
	},
	invert(payload, before) {
		const clip = findClip(before, payload.clipId);
		if (!clip) {
			return [];
		}
		const updates = payload.updates.flatMap((update) => {
			const event = findNoteEvent(clip, update.eventId);
			return event
				? [
						{
							eventId: update.eventId,
							changes: previousValues(event, update.changes),
						},
					]
				: [];
		});
		return updates.length > 0 ? [updateNotes(payload.clipId, updates)] : [];
	},
});

export function applyNoteChanges(
	event: NoteEvent,
	changes: NoteChanges,
): NoteEvent {
	return {
		...event,
		...(changes.trigger !== undefined ? { trigger: changes.trigger } : {}),
		...(changes.startTicks !== undefined
			? { startTicks: changes.startTicks }
			: {}),
		...(changes.durationTicks !== undefined
			? { durationTicks: changes.durationTicks }
			: {}),
		...(changes.velocity !== undefined ? { velocity: changes.velocity } : {}),
		...(changes.probability !== undefined
			? { probability: changes.probability }
			: {}),
	};
}

/** The event's current values for exactly the fields `changes` would set. */
function previousValues(event: NoteEvent, changes: NoteChanges): NoteChanges {
	return {
		...(changes.trigger !== undefined ? { trigger: event.trigger } : {}),
		...(changes.startTicks !== undefined
			? { startTicks: event.startTicks }
			: {}),
		...(changes.durationTicks !== undefined
			? { durationTicks: event.durationTicks }
			: {}),
		...(changes.velocity !== undefined ? { velocity: event.velocity } : {}),
		...(changes.probability !== undefined
			? { probability: event.probability }
			: {}),
	};
}

// --- Typed builders -------------------------------------------------------
//
// Callers construct commands through these rather than object literals, so a
// payload is type-checked at the call site as well as validated at execution.

export function addNotes(
	clipId: ClipId,
	notes: readonly NoteEvent[],
): CommandInput<NoteAddPayload> {
	return { type: noteAddCommand.type, payload: { clipId, notes: [...notes] } };
}

export function removeNotes(
	clipId: ClipId,
	eventIds: readonly EventId[],
): CommandInput<NoteRemovePayload> {
	return {
		type: noteRemoveCommand.type,
		payload: { clipId, eventIds: [...eventIds] },
	};
}

export function updateNotes(
	clipId: ClipId,
	updates: readonly { eventId: EventId; changes: NoteChanges }[],
): CommandInput<NoteUpdatePayload> {
	return {
		type: noteUpdateCommand.type,
		payload: { clipId, updates: updates.map((update) => ({ ...update })) },
	};
}

/** Convenience for the single-note case the step grid dispatches. */
export function updateNote(
	clipId: ClipId,
	eventId: EventId,
	changes: NoteChanges,
): CommandInput<NoteUpdatePayload> {
	return updateNotes(clipId, [{ eventId, changes }]);
}

/** Mints an event ID for a new note, so callers never hand-write one. */
export function newEventId(ids: IdFactory): EventId {
	return ids("event");
}

/** Registered, payload-erased commands from this module. */
export const noteCommands: readonly RegisteredCommand[] = [
	eraseCommand(noteAddCommand),
	eraseCommand(noteRemoveCommand),
	eraseCommand(noteUpdateCommand),
];
