import { describe, expect, it } from "vitest";
import { createFactoryContext } from "../domain/factories";
import { createSeededIdFactory } from "../domain/ids";
import {
	createNewTrack,
	instrumentTypeKey,
	NEW_TRACK_KINDS,
} from "./trackCreation";

const context = () =>
	createFactoryContext({ ids: createSeededIdFactory(223), now: 0 });

describe("new track kinds (#223)", () => {
	it("offers every instrument the domain can build a track from", () => {
		expect(NEW_TRACK_KINDS.map((spec) => spec.kind)).toEqual([
			"sampler",
			"drumMachine",
			"synth",
		]);
	});

	it("keeps each button's visible text inside its accessible name", () => {
		// WCAG 2.5.3: a speech-input user says what they can see, so the label on
		// the button has to be part of the name assistive technology reports.
		for (const spec of NEW_TRACK_KINDS) {
			expect(spec.actionLabel.toLowerCase(), spec.kind).toContain(
				spec.label.toLowerCase(),
			);
		}
	});

	it("reports the instrument each kind mints as its analytics value", () => {
		for (const spec of NEW_TRACK_KINDS) {
			const { track } = createNewTrack(context(), {
				kind: spec.kind,
				order: 0,
				existingNames: [],
			});
			expect(instrumentTypeKey(track.instrument), spec.kind).toBe(
				spec.analyticsType,
			);
		}
	});

	it("has no instrument value for a track that carries none", () => {
		expect(instrumentTypeKey(null)).toBeUndefined();
	});
});

describe("createNewTrack", () => {
	it("ties the clip and its placement to the track it built", () => {
		const { track, clip, placement } = createNewTrack(context(), {
			kind: "sampler",
			order: 2,
			existingNames: [],
		});

		expect(track.order).toBe(2);
		expect(clip.trackId).toBe(track.id);
		expect(placement.trackId).toBe(track.id);
		expect(placement.clipId).toBe(clip.id);
		expect(clip.name).toBe(track.name);
	});

	it("numbers a repeated name rather than reusing one already on screen", () => {
		const name = (existingNames: readonly string[]) =>
			createNewTrack(context(), { kind: "synth", order: 0, existingNames })
				.track.name;

		expect(name([])).toBe("Synth");
		expect(name(["Synth"])).toBe("Synth 2");
		expect(name(["Synth", "Synth 2"])).toBe("Synth 3");
		// "Synth 2" is still on screen, so the freed "Synth" is what is reused —
		// numbering follows collisions, not the count of tracks.
		expect(name(["Synth 2"])).toBe("Synth");
	});
});
