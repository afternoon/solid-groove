import { describe, expect, it } from "vitest";
import {
	bars,
	createDrumPad,
	createNoteClip,
	createNoteEvent,
	createPlacement,
	createSeededIdFactory,
	createTrack as createTrackEntity,
	PAD_PITCH,
	TICKS_PER_BAR,
	TICKS_PER_SIXTEENTH,
	TRACK_VOLUME,
	toTicks,
} from "../domain";
import {
	addClip,
	addNotes,
	addPad,
	addPlacement,
	addTrack,
	clearNotes,
	duplicateNotes,
	quantizeNotes,
	removeClip,
	removeNotes,
	removePad,
	removePlacement,
	removeTrack,
	reorderPad,
	reorderTrack,
	scaleNoteVelocity,
	setPadAsset,
	setPadChoke,
	setPadFlag,
	setPadParameter,
	setParameter,
	setTrackFlag,
	transposeNotes,
	updateClip,
	updateNote,
	updatePlacement,
	updateTrack,
	varyNotes,
} from ".";
import { executeCommand } from "./execute";
import { createCommandHistory } from "./history";
import { COMMAND_TYPES } from "./registry";
import {
	type CommandTestProject,
	contentSignature,
	createCommandTestProject,
	createTestFactoryContext,
} from "./testProjects";
import type { RawCommandInput } from "./types";

/**
 * Undo is only as good as the generated inverses, so every registered command
 * is round-tripped here: apply it, undo it, and require the musical content to
 * be byte-identical to where it started, then redo it and require the same
 * result as the first application.
 *
 * The case list is checked against the registry, so a new command cannot be
 * added without an inverse test.
 */

interface InverseCase {
	readonly type: string;
	build(fixture: CommandTestProject): RawCommandInput;
}

const cases: InverseCase[] = [
	{
		type: "note.add",
		build: (fixture) =>
			addNotes(fixture.clipAId, [
				createNoteEvent(createTestFactoryContext("inverse-note"), {
					startTicks: TICKS_PER_SIXTEENTH,
					durationTicks: TICKS_PER_SIXTEENTH,
					pitch: 60,
				}),
			]),
	},
	{
		type: "note.remove",
		build: (fixture) =>
			removeNotes(fixture.clipAId, [fixture.eventIds[0], fixture.eventIds[2]]),
	},
	{
		type: "note.update",
		build: (fixture) =>
			updateNote(fixture.clipAId, fixture.eventIds[1], {
				startTicks: toTicks(TICKS_PER_SIXTEENTH),
				velocity: 0.9,
				probability: 0.4,
			}),
	},
	{
		type: "notes.transpose",
		build: (fixture) => transposeNotes(fixture.clipAId, null, 7),
	},
	{
		type: "notes.scaleVelocity",
		// A factor big enough to clamp, so the inverse cannot cheat by dividing.
		build: (fixture) => scaleNoteVelocity(fixture.clipAId, null, 8),
	},
	{
		type: "notes.quantize",
		build: (fixture) => quantizeNotes(fixture.clipAId, null, 100, 1),
	},
	{
		type: "notes.duplicate",
		build: (fixture) =>
			duplicateNotes(createSeededIdFactory("inverse-dup"), fixture.project, {
				clipId: fixture.clipAId,
				offsetTicks: TICKS_PER_SIXTEENTH,
			}),
	},
	{
		type: "notes.clear",
		build: (fixture) => clearNotes(fixture.clipAId),
	},
	{
		type: "notes.vary",
		build: (fixture) =>
			varyNotes(fixture.clipAId, null, {
				seed: "inverse",
				amount: 1,
				gridTicks: 24,
			}),
	},
	{
		type: "clip.create",
		build: (fixture) =>
			addClip(
				createNoteClip(createTestFactoryContext("inverse-clip"), {
					trackId: fixture.trackAId,
					name: "Extra",
				}),
			),
	},
	{
		type: "clip.delete",
		build: (fixture) => removeClip(fixture.clipAId),
	},
	{
		type: "clip.update",
		build: (fixture) =>
			updateClip(fixture.clipAId, {
				name: "Renamed",
				lengthTicks: toTicks(TICKS_PER_BAR * 2),
			}),
	},
	{
		type: "track.create",
		build: () =>
			addTrack(
				createTrackEntity(createTestFactoryContext("inverse-track"), {
					name: "Extra",
					order: 1,
				}),
			),
	},
	{
		type: "track.delete",
		build: (fixture) => removeTrack(fixture.trackAId),
	},
	{
		type: "track.update",
		build: (fixture) => updateTrack(fixture.trackBId, { name: "Percussion" }),
	},
	{
		type: "track.reorder",
		build: (fixture) => reorderTrack(fixture.trackAId, 1),
	},
	{
		type: "track.setFlag",
		build: (fixture) => setTrackFlag(fixture.trackAId, "muted", true),
	},
	{
		type: "placement.create",
		build: (fixture) =>
			addPlacement(
				createPlacement(createTestFactoryContext("inverse-placement"), {
					clipId: fixture.clipAId,
					trackId: fixture.trackAId,
					startTicks: bars(4),
					durationTicks: bars(1),
				}),
			),
	},
	{
		type: "placement.delete",
		build: (fixture) => removePlacement(fixture.placementAId),
	},
	{
		type: "placement.update",
		build: (fixture) =>
			updatePlacement(fixture.placementAId, {
				startTicks: bars(2),
				looped: true,
			}),
	},
	{
		type: "parameter.set",
		build: (fixture) =>
			setParameter(
				{
					scope: "track",
					trackId: fixture.trackAId,
					parameterId: TRACK_VOLUME.id,
				},
				-11,
			),
	},
	{
		type: "drum.setPadAsset",
		// The kick pad already uses the pad asset; point it at the sampler asset
		// (also in the project) so the change is real and never dangles.
		build: (fixture) =>
			setPadAsset(
				fixture.trackBId,
				fixture.padIds[0],
				fixture.assetIds.sampler,
			),
	},
	{
		type: "drum.setPadFlag",
		build: (fixture) =>
			setPadFlag(fixture.trackBId, fixture.padIds[0], "soloed", true),
	},
	{
		type: "drum.setPadChoke",
		build: (fixture) => setPadChoke(fixture.trackBId, fixture.padIds[0], 3),
	},
	{
		type: "drum.setPadParameter",
		build: (fixture) =>
			setPadParameter(fixture.trackBId, fixture.padIds[0], PAD_PITCH.id, 7),
	},
	{
		type: "drum.addPad",
		build: (fixture) =>
			addPad(
				fixture.trackBId,
				createDrumPad(createTestFactoryContext("inverse-pad"), {
					name: "Extra Pad",
				}),
			),
	},
	{
		type: "drum.removePad",
		build: (fixture) => removePad(fixture.trackBId, fixture.padIds[1]),
	},
	{
		type: "drum.reorderPad",
		build: (fixture) => reorderPad(fixture.trackBId, fixture.padIds[0], 1),
	},
];

describe("generated inverses", () => {
	it("covers every registered command", () => {
		expect(cases.map((entry) => entry.type).sort()).toEqual(
			[...COMMAND_TYPES].sort(),
		);
	});

	for (const testCase of cases) {
		it(`${testCase.type} undoes and redoes exactly`, () => {
			const fixture = createCommandTestProject();
			const history = createCommandHistory(fixture.project);
			const command = testCase.build(fixture);
			expect(command.type).toBe(testCase.type);

			const before = contentSignature(fixture.project);
			const result = history.execute(command);
			expect(result.ok, result.ok ? "" : result.issues[0].message).toBe(true);

			const after = contentSignature(history.project);
			expect(after).not.toBe(before);

			const undone = history.undo();
			expect(undone?.ok).toBe(true);
			expect(contentSignature(history.project)).toBe(before);

			const redone = history.redo();
			expect(redone?.ok).toBe(true);
			expect(contentSignature(history.project)).toBe(after);
		});

		it(`${testCase.type} is deterministic`, () => {
			// The same payload on the same project must produce the same project,
			// or an assistant preview, a redo, and a peer would each land
			// somewhere different.
			const fixture = createCommandTestProject();
			const command = testCase.build(fixture);
			const first = executeCommand(fixture.project, command);
			const second = executeCommand(fixture.project, command);

			expect(first.ok && second.ok).toBe(true);
			if (!first.ok || !second.ok) return;
			expect(contentSignature(second.project)).toBe(
				contentSignature(first.project),
			);
			expect(second.summary).toBe(first.summary);
		});
	}
});
