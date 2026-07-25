import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
	BEATS_PER_BAR,
	barsBeatsSixteenthsToTicks,
	barsToTicks,
	formatBarsBeatsSixteenths,
	isTicks,
	minutesToTicks,
	PPQ,
	parseBarsBeatsSixteenths,
	roundToTicks,
	secondsToTicks,
	sixteenthsToTicks,
	TICKS_PER_BAR,
	TICKS_PER_EIGHTH_TRIPLET,
	TICKS_PER_QUARTER,
	TICKS_PER_SIXTEENTH,
	tickSchema,
	ticksToBarsBeatsSixteenths,
	ticksToSeconds,
	toTicks,
} from "./time";

describe("musical time", () => {
	it("uses the PRD section 9.5 resolution", () => {
		expect(PPQ).toBe(192);
		expect(TICKS_PER_QUARTER).toBe(192);
		expect(TICKS_PER_SIXTEENTH).toBe(48);
		expect(TICKS_PER_EIGHTH_TRIPLET).toBe(64);
		expect(BEATS_PER_BAR).toBe(4);
		expect(TICKS_PER_BAR).toBe(768);
	});

	it("keeps a ten-minute arrangement at 240 BPM under 500,000 ticks", () => {
		expect(minutesToTicks(10, 240)).toBe(460_800);
		expect(minutesToTicks(10, 240)).toBeLessThan(500_000);
	});

	it("rejects floating-point and non-finite musical time", () => {
		expect(isTicks(48)).toBe(true);
		expect(isTicks(48.5)).toBe(false);
		expect(isTicks(-1)).toBe(false);
		expect(isTicks(Number.NaN)).toBe(false);
		expect(isTicks(Number.POSITIVE_INFINITY)).toBe(false);
		expect(() => toTicks(0.5)).toThrow(/non-negative safe integer/);
		expect(() => roundToTicks(Number.NaN)).toThrow(/non-finite/);
		expect(tickSchema.safeParse(24.5).success).toBe(false);
		expect(tickSchema.safeParse(-1).success).toBe(false);
		expect(tickSchema.safeParse(24).success).toBe(true);
	});

	it("converts between ticks and seconds at a given tempo", () => {
		expect(ticksToSeconds(TICKS_PER_QUARTER, 120)).toBeCloseTo(0.5, 10);
		expect(ticksToSeconds(TICKS_PER_BAR, 120)).toBeCloseTo(2, 10);
		expect(secondsToTicks(2, 120)).toBe(TICKS_PER_BAR);
		expect(() => ticksToSeconds(96, 0)).toThrow(/positive finite/);
	});

	it("converts bars, beats, and sixteenths without losing ticks", () => {
		expect(barsToTicks(2)).toBe(1_536);
		expect(sixteenthsToTicks(3)).toBe(144);
		expect(ticksToBarsBeatsSixteenths(0)).toEqual({
			bars: 0,
			beats: 0,
			sixteenths: 0,
			ticks: 0,
		});
		expect(ticksToBarsBeatsSixteenths(TICKS_PER_BAR + 96 + 24)).toEqual({
			bars: 1,
			beats: 0,
			sixteenths: 2,
			ticks: 24,
		});
		expect(
			barsBeatsSixteenthsToTicks({ bars: 1, beats: 2, sixteenths: 3 }),
		).toBe(TICKS_PER_BAR + 2 * TICKS_PER_QUARTER + 3 * TICKS_PER_SIXTEENTH);
	});

	it("formats and parses Tone.js bars:beats:sixteenths", () => {
		expect(formatBarsBeatsSixteenths(0)).toBe("0:0:0");
		expect(formatBarsBeatsSixteenths(TICKS_PER_BAR + TICKS_PER_SIXTEENTH)).toBe(
			"1:0:1",
		);
		expect(formatBarsBeatsSixteenths(24)).toBe("0:0:0.5");
		expect(parseBarsBeatsSixteenths("1:0:1")).toBe(
			TICKS_PER_BAR + TICKS_PER_SIXTEENTH,
		);
		expect(() => parseBarsBeatsSixteenths("1:0")).toThrow(
			/bars:beats:sixteenths/,
		);
		expect(() => parseBarsBeatsSixteenths("a:b:c")).toThrow(
			/Invalid musical position/,
		);
	});

	it("round trips any tick position through bars/beats/16ths", () => {
		fc.assert(
			fc.property(fc.integer({ min: 0, max: 500_000 }), (ticks) => {
				const position = ticksToBarsBeatsSixteenths(ticks);
				expect(barsBeatsSixteenthsToTicks(position)).toBe(ticks);
			}),
		);
	});

	it("round trips any tick position through seconds at any supported tempo", () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 0, max: 500_000 }),
				fc.integer({ min: 20, max: 300 }),
				(ticks, bpm) => {
					expect(secondsToTicks(ticksToSeconds(ticks, bpm), bpm)).toBe(ticks);
				},
			),
		);
	});
});
