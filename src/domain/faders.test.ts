import { describe, expect, it } from "vitest";
import {
	dbToFaderPosition,
	faderPositionToDb,
	formatDb,
	formatPan,
	UNITY_POSITION,
} from "./faders";
import { MASTER_VOLUME, TRACK_VOLUME } from "./parameters";

/**
 * The perceptual fader (PRD TRK-02): a reversible, monotonic map between fader
 * position and decibels that gives the region around unity the most travel, and
 * human-readable readouts for volume and pan.
 */
describe("perceptual fader curve", () => {
	it("maps the top of travel to the max and the bottom to the min", () => {
		expect(faderPositionToDb(TRACK_VOLUME, 1)).toBeCloseTo(TRACK_VOLUME.max, 5);
		expect(faderPositionToDb(TRACK_VOLUME, 0)).toBeCloseTo(TRACK_VOLUME.min, 5);
	});

	it("places unity gain (0 dB) at the unity position", () => {
		expect(faderPositionToDb(TRACK_VOLUME, UNITY_POSITION)).toBeCloseTo(0, 5);
		expect(dbToFaderPosition(TRACK_VOLUME, 0)).toBeCloseTo(UNITY_POSITION, 5);
	});

	it("is reversible across the whole range", () => {
		for (let db = TRACK_VOLUME.min; db <= TRACK_VOLUME.max; db += 1) {
			const position = dbToFaderPosition(TRACK_VOLUME, db);
			expect(faderPositionToDb(TRACK_VOLUME, position)).toBeCloseTo(db, 3);
		}
	});

	it("is monotonic: a higher position is never a lower dB", () => {
		let previous = Number.NEGATIVE_INFINITY;
		for (let p = 0; p <= 1; p += 0.01) {
			const db = faderPositionToDb(TRACK_VOLUME, p);
			expect(db).toBeGreaterThanOrEqual(previous - 1e-9);
			previous = db;
		}
	});

	it("gives the region around unity more travel than a linear curve would", () => {
		// The bottom 60% of the fader below unity should NOT span 60% of the dB
		// range — the taper compresses the quiet tail, so the audible upper region
		// gets disproportionately more resolution.
		const halfway = faderPositionToDb(TRACK_VOLUME, UNITY_POSITION / 2);
		const linearMidpoint = TRACK_VOLUME.min + (0 - TRACK_VOLUME.min) * 0.5;
		expect(halfway).toBeLessThan(linearMidpoint);
	});

	it("clamps out-of-range positions rather than mapping past the fader", () => {
		expect(faderPositionToDb(TRACK_VOLUME, 2)).toBeCloseTo(TRACK_VOLUME.max, 5);
		expect(faderPositionToDb(TRACK_VOLUME, -1)).toBeCloseTo(
			TRACK_VOLUME.min,
			5,
		);
		expect(faderPositionToDb(TRACK_VOLUME, Number.NaN)).toBeCloseTo(
			TRACK_VOLUME.min,
			5,
		);
	});

	it("works for any decibel parameter, not just track volume", () => {
		expect(faderPositionToDb(MASTER_VOLUME, UNITY_POSITION)).toBeCloseTo(0, 5);
		expect(faderPositionToDb(MASTER_VOLUME, 1)).toBeCloseTo(
			MASTER_VOLUME.max,
			5,
		);
	});
});

describe("formatDb", () => {
	it("shows the floor as silence", () => {
		expect(formatDb(TRACK_VOLUME, TRACK_VOLUME.min)).toBe("-∞ dB");
		expect(formatDb(TRACK_VOLUME, -100)).toBe("-∞ dB");
	});

	it("shows unity with an explicit zero", () => {
		expect(formatDb(TRACK_VOLUME, 0)).toBe("0.0 dB");
	});

	it("signs values above and below unity", () => {
		expect(formatDb(TRACK_VOLUME, 3)).toBe("+3.0 dB");
		expect(formatDb(TRACK_VOLUME, -6)).toBe("-6.0 dB");
	});
});

describe("formatPan", () => {
	it("shows centre as C", () => {
		expect(formatPan(0)).toBe("C");
	});

	it("shows left and right as percentages", () => {
		expect(formatPan(-1)).toBe("L100");
		expect(formatPan(1)).toBe("R100");
		expect(formatPan(0.5)).toBe("R50");
		expect(formatPan(-0.25)).toBe("L25");
	});
});
