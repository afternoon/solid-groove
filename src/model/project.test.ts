import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the data service so we can observe writes without touching Firebase.
// `vi.mock` is hoisted above module-level declarations, so the shared spy must
// come from `vi.hoisted`.
const { updateProject } = vi.hoisted(() => ({
	updateProject: vi.fn(async () => {}),
}));

vi.mock("./dataService", () => ({
	dataService: {
		subscribeToProject: () => () => {},
		updateProject,
	},
}));

import { newProject } from "./newProject";
import { setInstrumentEnvelope, setProject } from "./project";
import type { Envelope } from "./types";

const envelope = (attack: number): Envelope => ({
	attack,
	decay: 0.1,
	sustain: 0.5,
	release: 0.2,
});

describe("project store persistence", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		// Seed the store synchronously. setProject writes immediately; clear that
		// so the assertions below only see the debounced setter writes.
		setProject({ ...newProject("user-1"), id: "p1" });
		updateProject.mockClear();
	});

	afterEach(() => {
		vi.runOnlyPendingTimers();
		vi.useRealTimers();
	});

	it("coalesces rapid edits into a single debounced write with the latest value", () => {
		// Simulate a drag: many setter calls in quick succession.
		for (let i = 1; i <= 10; i++) {
			setInstrumentEnvelope(0, envelope(i / 10));
		}

		// Nothing written yet — still within the debounce window.
		expect(updateProject).not.toHaveBeenCalled();

		vi.advanceTimersByTime(200);

		// Exactly one write, carrying the final value.
		expect(updateProject).toHaveBeenCalledTimes(1);
		const written = updateProject.mock.calls[0][0] as ReturnType<
			typeof newProject
		>;
		const instrument = written.latestSnapshot.song.tracks[0].instrument;
		if (instrument.type === "synth" || instrument.type === "sampler") {
			expect(instrument.envelope.attack).toBeCloseTo(1.0);
		}
	});

	it("does not write until the debounce window elapses", () => {
		setInstrumentEnvelope(0, envelope(0.5));
		vi.advanceTimersByTime(199);
		expect(updateProject).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(updateProject).toHaveBeenCalledTimes(1);
	});
});
