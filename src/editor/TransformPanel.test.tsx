import { cleanup, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import {
	clickTransform,
	currentNotes,
	pitches,
	pitchOf,
	setOption,
	setUpTransformPanel as setUp,
} from "./transformPanelHarness";

afterEach(() => cleanup());

/**
 * What each of the six CLP-04 transformations does to a clip when the user
 * clicks it. The history and analytics contract has its own suite
 * (`TransformPanel.history.test.tsx`).
 */
describe("TransformPanel (CLP-04)", () => {
	it("transposes the whole clip when nothing is selected", async () => {
		const { session, renderPanel } = await setUp();
		const before = pitches(session);
		renderPanel([]);

		clickTransform("Transpose");

		expect(pitches(session)).toEqual(before.map((pitch) => pitch + 12));
	});

	it("transposes only the selected notes", async () => {
		const { session, renderPanel } = await setUp();
		const before = new Map(
			currentNotes(session).map((event) => [event.id, pitchOf(event)]),
		);
		const target = currentNotes(session)[0];
		renderPanel([target.id]);

		clickTransform("Transpose");

		// The selected note moved by the panel's semitone value; every other note
		// is exactly where it was.
		for (const event of currentNotes(session)) {
			const expected = before.get(event.id) ?? -1;
			expect(pitchOf(event)).toBe(
				event.id === target.id ? expected + 12 : expected,
			);
		}
	});

	it("scales velocity through the shared command, clamping at the range end", async () => {
		const { session, renderPanel } = await setUp();
		renderPanel([]);

		clickTransform("Velocity");

		for (const event of currentNotes(session)) {
			expect(event.velocity).toBeLessThanOrEqual(1);
			expect(event.velocity).toBeGreaterThan(0);
		}
	});

	it("quantizes onto the 16th grid", async () => {
		const { session, renderPanel } = await setUp();
		renderPanel([]);

		clickTransform("Quantize");

		for (const event of currentNotes(session)) {
			expect(event.startTicks % 48).toBe(0);
		}
	});

	it("duplicates every note in scope", async () => {
		const { session, renderPanel } = await setUp();
		const before = currentNotes(session).length;
		renderPanel([]);

		clickTransform("Duplicate");

		expect(currentNotes(session)).toHaveLength(before * 2);
	});

	it("clears every note in the clip", async () => {
		const { session, renderPanel } = await setUp();
		renderPanel([]);

		clickTransform("Clear");

		expect(currentNotes(session)).toHaveLength(0);
	});

	it("disables every transformation when the clip has no notes", async () => {
		const { session, renderPanel } = await setUp();
		renderPanel([]);
		clickTransform("Clear");
		cleanup();
		renderPanel([]);

		expect(currentNotes(session)).toHaveLength(0);
		for (const button of screen.getAllByRole("button")) {
			expect(button).toBeDisabled();
		}
	});

	it("surfaces a boundary rejection instead of clamping the notes", async () => {
		const { session, renderPanel } = await setUp();
		const before = pitches(session);
		renderPanel([]);

		// The fixture's top note is C5; repeated +24 transposes eventually leave
		// the 0-127 range, and the command refuses rather than clamping.
		setOption("Semitones", "24");
		for (let index = 0; index < 4; index += 1) clickTransform("Transpose");

		expect(screen.getByRole("alert").textContent).not.toBe("");
		// The refused transformation left every note where the last accepted one
		// put it: nothing was clamped to the edge of the range.
		expect(pitches(session).every((pitch) => pitch <= 127)).toBe(true);
		expect(pitches(session)).not.toEqual(before);
	});
});
