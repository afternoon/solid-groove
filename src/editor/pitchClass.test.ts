import { describe, expect, it } from "vitest";
import {
	isBlackKey,
	isPitchInKey,
	keyPitchClasses,
	pitchClassOf,
	pitchLabel,
} from "./pitchClass";

describe("pitchClass", () => {
	it("reduces any MIDI pitch to a 0..11 pitch class", () => {
		expect(pitchClassOf(60)).toBe(0); // C
		expect(pitchClassOf(61)).toBe(1); // C#
		expect(pitchClassOf(72)).toBe(0); // C an octave up
		expect(pitchClassOf(-1)).toBe(11); // wraps for negatives
	});

	it("labels a pitch in scientific notation", () => {
		expect(pitchLabel(60)).toBe("C4");
		expect(pitchLabel(69)).toBe("A4");
		expect(pitchLabel(21)).toBe("A0");
	});

	describe("in-key guide", () => {
		it("knows the notes of C major", () => {
			const guide = { root: 0, mode: "major" as const };
			const classes = keyPitchClasses(guide);
			expect([...classes].sort((a, b) => a - b)).toEqual([
				0, 2, 4, 5, 7, 9, 11,
			]);
			// C, D, E, F, G, A, B are in key; the black keys are not.
			expect(isPitchInKey(guide, 60)).toBe(true); // C
			expect(isPitchInKey(guide, 62)).toBe(true); // D
			expect(isPitchInKey(guide, 61)).toBe(false); // C#
			expect(isPitchInKey(guide, 66)).toBe(false); // F#
		});

		it("knows the notes of A minor", () => {
			const guide = { root: 9, mode: "minor" as const };
			// A natural minor is the white keys: A B C D E F G.
			expect(isPitchInKey(guide, 69)).toBe(true); // A
			expect(isPitchInKey(guide, 60)).toBe(true); // C
			expect(isPitchInKey(guide, 70)).toBe(false); // A#/Bb
		});
	});

	it("identifies black keys", () => {
		expect(isBlackKey(61)).toBe(true); // C#
		expect(isBlackKey(60)).toBe(false); // C
		expect(isBlackKey(66)).toBe(true); // F#
	});
});
