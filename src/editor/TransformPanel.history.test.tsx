import { cleanup, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import {
	clickTransform,
	clipEdited,
	currentNotes,
	pitches,
	rhythmOf,
	setOption,
	setUpTransformPanel as setUp,
} from "./transformPanelHarness";

afterEach(() => cleanup());

/**
 * The CLP-04 acceptance criteria that are about a transformation's *contract*
 * rather than its arithmetic: seeded output, atomic undo, exact redo, and the
 * OPS-02 events. What each transformation computes has its own suite
 * (`TransformPanel.test.tsx`).
 */
describe("TransformPanel determinism", () => {
	it("produces the same variation for the same seed", async () => {
		const first = await setUp();
		first.renderPanel([]);
		clickTransform("Vary");
		const a = rhythmOf(first.session);
		cleanup();

		const second = await setUp();
		second.renderPanel([]);
		clickTransform("Vary");

		// Same seed, same variation — this is what makes the command previewable
		// by the assistant and reproducible on redo.
		expect(rhythmOf(second.session)).toEqual(a);
	});

	it("produces a different variation for a different seed", async () => {
		const baseline = await setUp();
		baseline.renderPanel([]);
		clickTransform("Vary");
		const defaultSeed = rhythmOf(baseline.session);
		cleanup();

		const { session, renderPanel } = await setUp();
		renderPanel([]);
		setOption("Vary seed", "another-seed");
		clickTransform("Vary");

		expect(rhythmOf(session)).not.toEqual(defaultSeed);
	});
});

describe("TransformPanel history", () => {
	it("undoes a whole transformation as one atomic entry", async () => {
		const { session, renderPanel } = await setUp();
		const before = pitches(session);
		const revisionBefore = session.project.metadata.revision;
		renderPanel([]);

		clickTransform("Transpose");
		expect(pitches(session)).not.toEqual(before);
		// One transformation is one revision, not one per note it touched.
		expect(session.project.metadata.revision).toBe(revisionBefore + 1);

		session.undo();

		expect(pitches(session)).toEqual(before);
	});

	it("drops a stale rejection once the clip changes underneath", async () => {
		const { session, renderPanel } = await setUp();
		renderPanel([]);

		// One accepted transformation, so there is something to undo, then one
		// the command refuses.
		clickTransform("Quantize");
		setOption("Semitones", "96");
		clickTransform("Transpose");
		expect(screen.getByRole("alert").textContent).not.toBe("");

		// The message described the clip as it was at the click. An undo (or any
		// other edit) can make it untrue, so it must not linger.
		session.undo();

		expect(screen.getByRole("alert").textContent).toBe("");
	});

	it("redoes a seeded variation to exactly the same notes", async () => {
		const { session, renderPanel } = await setUp();
		renderPanel([]);

		clickTransform("Vary");
		const applied = rhythmOf(session);

		session.undo();
		session.redo();

		expect(rhythmOf(session)).toEqual(applied);
	});

	it("redoes a duplicate to the same event ids", async () => {
		const { session, renderPanel } = await setUp();
		const before = currentNotes(session).length;
		renderPanel([]);

		clickTransform("Duplicate");
		const duplicated = currentNotes(session).map((event) => event.id);
		expect(duplicated).toHaveLength(before * 2);

		session.undo();
		expect(currentNotes(session)).toHaveLength(before);

		session.redo();
		// The new ids live in the payload, so redo reproduces them exactly rather
		// than minting fresh ones.
		expect(currentNotes(session).map((event) => event.id)).toEqual(duplicated);
	});
});

describe("TransformPanel analytics", () => {
	it("emits clip_edited exactly once per applied transformation", async () => {
		const { transport, renderPanel } = await setUp();
		renderPanel([]);

		clickTransform("Transpose");

		const events = clipEdited(transport);
		expect(events).toHaveLength(1);
		expect(events[0].params.editor).toBe("piano_roll");
		expect(events[0].params.event_count_bucket).toBeDefined();
	});

	it("emits nothing for a rejected transformation", async () => {
		const { transport, renderPanel } = await setUp();
		renderPanel([]);
		setOption("Semitones", "24");

		for (let index = 0; index < 6; index += 1) clickTransform("Transpose");

		// Six clicks, but the ones the command refused changed nothing, so they
		// are not edits and must not be counted as such.
		expect(clipEdited(transport).length).toBeLessThan(6);
		expect(screen.getByRole("alert").textContent).not.toBe("");
	});

	it("records the piano_roll feature key once, however many transformations run", async () => {
		const { transport, renderPanel } = await setUp();
		renderPanel([]);

		clickTransform("Quantize");
		clickTransform("Quantize");

		const first = transport.events.filter(
			(event) => event.name === "feature_first_use",
		);
		expect(first).toHaveLength(1);
		expect(first[0].params.feature).toBe("piano_roll");
	});

	it("changes nothing about the transformation when analytics is disabled", async () => {
		const { session, transport, renderPanel } = await setUp({
			analyticsEnabled: false,
		});
		const before = pitches(session);
		renderPanel([]);

		clickTransform("Transpose");

		expect(pitches(session)).toEqual(before.map((pitch) => pitch + 12));
		expect(transport.events).toHaveLength(0);
	});
});
