import { beforeEach, describe, expect, it } from "vitest";
import {
	createDrumMachineFixtureProject,
	createNoteEvent,
	type NoteEvent,
	type Project,
	TICKS_PER_SIXTEENTH,
	toTicks,
} from "../domain";
import { addNotes, removeNotes, updateNote, updateNotes } from ".";
import { executeCommand } from "./execute";
import { findClip, noteEventsOf } from "./projectEdits";
import {
	ABSENT_IDS,
	type CommandTestProject,
	createCommandTestProject,
	createTestFactoryContext,
} from "./testProjects";

function eventsOf(project: Project, clipId: CommandTestProject["clipAId"]) {
	const clip = findClip(project, clipId);
	return clip ? (noteEventsOf(clip) ?? []) : [];
}

describe("note commands", () => {
	let fixture: CommandTestProject;
	let note: NoteEvent;

	beforeEach(() => {
		fixture = createCommandTestProject();
		note = createNoteEvent(createTestFactoryContext("new-note"), {
			startTicks: 2 * TICKS_PER_SIXTEENTH,
			durationTicks: TICKS_PER_SIXTEENTH,
			pitch: 48,
			velocity: 0.7,
		});
	});

	describe("note.add", () => {
		it("adds a note to a note clip", () => {
			const result = executeCommand(
				fixture.project,
				addNotes(fixture.clipAId, [note]),
			);

			expect(result.ok).toBe(true);
			if (!result.ok) return;
			const events = eventsOf(result.project, fixture.clipAId);
			expect(events).toHaveLength(5);
			expect(events.find((event) => event.id === note.id)).toMatchObject({
				velocity: 0.7,
				trigger: { kind: "pitch", pitch: 48 },
			});
			expect(result.summary).toBe('Add 1 note to "Bassline"');
		});

		it("summarizes a multi-note add in plural", () => {
			const other = createNoteEvent(createTestFactoryContext("second-note"), {
				startTicks: 3 * TICKS_PER_SIXTEENTH,
				durationTicks: TICKS_PER_SIXTEENTH,
			});
			const result = executeCommand(
				fixture.project,
				addNotes(fixture.clipAId, [note, other]),
			);
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.summary).toBe('Add 2 notes to "Bassline"');
		});

		it("rejects a well-formed but unknown clip ID", () => {
			const result = executeCommand(
				fixture.project,
				addNotes(ABSENT_IDS.clip, [note]),
			);
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.issues[0]).toMatchObject({
				code: "rejected",
				commandType: "note.add",
			});
		});

		it("rejects a note whose ID is already in the clip", () => {
			const existing = eventsOf(fixture.project, fixture.clipAId)[0];
			const result = executeCommand(
				fixture.project,
				addNotes(fixture.clipAId, [{ ...note, id: existing.id }]),
			);
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.issues[0].message).toMatch(/already exists/);
		});

		it("rejects a note that starts outside its clip", () => {
			const result = executeCommand(
				fixture.project,
				addNotes(fixture.clipAId, [{ ...note, startTicks: toTicks(10_000) }]),
			);
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.issues[0].code).toBe("invalid_project");
		});

		it("rejects an audio-loop clip", () => {
			const audioProject = createDrumMachineFixtureProject();
			const loopClip = audioProject.clips.find(
				(clip) => clip.content.kind === "audioLoop",
			);
			expect(loopClip).toBeDefined();
			if (!loopClip) return;
			const result = executeCommand(
				audioProject,
				addNotes(loopClip.id, [note]),
			);
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.issues[0].message).toMatch(/does not hold note content/);
		});

		it("rejects an empty note list at the schema", () => {
			const result = executeCommand(
				fixture.project,
				addNotes(fixture.clipAId, []),
			);
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.issues[0].code).toBe("invalid_payload");
		});
	});

	describe("note.remove", () => {
		it("removes the listed notes and leaves the rest", () => {
			const [first, second] = fixture.eventIds;
			const result = executeCommand(
				fixture.project,
				removeNotes(fixture.clipAId, [first, second]),
			);

			expect(result.ok).toBe(true);
			if (!result.ok) return;
			const remaining = eventsOf(result.project, fixture.clipAId).map(
				(event) => event.id,
			);
			expect(remaining).toEqual(fixture.eventIds.slice(2));
			expect(result.summary).toBe('Delete 2 notes from "Bassline"');
		});

		it("rejects a stale selection rather than deleting fewer notes", () => {
			const result = executeCommand(
				fixture.project,
				removeNotes(fixture.clipAId, [fixture.eventIds[0], ABSENT_IDS.event]),
			);
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.issues[0].message).toMatch(/has no note/);
			expect(eventsOf(fixture.project, fixture.clipAId)).toHaveLength(4);
		});
	});

	describe("note.update", () => {
		it("changes only the fields it was given", () => {
			const target = fixture.eventIds[1];
			const before = eventsOf(fixture.project, fixture.clipAId)[1];
			const result = executeCommand(
				fixture.project,
				updateNote(fixture.clipAId, target, { velocity: 0.95 }),
			);

			expect(result.ok).toBe(true);
			if (!result.ok) return;
			const after = eventsOf(result.project, fixture.clipAId)[1];
			expect(after.velocity).toBe(0.95);
			expect(after.startTicks).toBe(before.startTicks);
			expect(after.durationTicks).toBe(before.durationTicks);
			expect(after.trigger).toEqual(before.trigger);
		});

		it("moves several notes in one command", () => {
			const result = executeCommand(
				fixture.project,
				updateNotes(fixture.clipAId, [
					{ eventId: fixture.eventIds[0], changes: { velocity: 0.1 } },
					{ eventId: fixture.eventIds[1], changes: { velocity: 0.2 } },
				]),
			);

			expect(result.ok).toBe(true);
			if (!result.ok) return;
			const velocities = eventsOf(result.project, fixture.clipAId).map(
				(event) => event.velocity,
			);
			expect(velocities.slice(0, 2)).toEqual([0.1, 0.2]);
			expect(result.summary).toBe('Edit 2 notes in "Bassline"');
		});

		it("clears a probability with an explicit null", () => {
			const withProbability = executeCommand(
				fixture.project,
				updateNote(fixture.clipAId, fixture.eventIds[0], { probability: 0.5 }),
			);
			expect(withProbability.ok).toBe(true);
			if (!withProbability.ok) return;
			expect(
				eventsOf(withProbability.project, fixture.clipAId)[0].probability,
			).toBe(0.5);

			const cleared = executeCommand(
				withProbability.project,
				updateNote(fixture.clipAId, fixture.eventIds[0], {
					probability: null,
				}),
			);
			expect(cleared.ok).toBe(true);
			if (!cleared.ok) return;
			expect(eventsOf(cleared.project, fixture.clipAId)[0].probability).toBe(
				null,
			);
		});

		it("rejects an update with no fields", () => {
			const result = executeCommand(
				fixture.project,
				updateNote(fixture.clipAId, fixture.eventIds[0], {}),
			);
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.issues[0].code).toBe("invalid_payload");
		});

		it("rejects a note that is not in the clip", () => {
			const result = executeCommand(
				fixture.project,
				updateNote(fixture.clipAId, ABSENT_IDS.event, { velocity: 0.5 }),
			);
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.issues[0].code).toBe("rejected");
		});

		it("rejects a velocity outside the shared parameter range", () => {
			const result = executeCommand(
				fixture.project,
				updateNote(fixture.clipAId, fixture.eventIds[0], { velocity: 4 }),
			);
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.issues[0].code).toBe("invalid_payload");
		});
	});
});
