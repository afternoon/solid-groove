import { z } from "zod";

/**
 * Musical time (PRD section 9.5 invariant 2).
 *
 * Persistent musical time is always an integer tick count at 192 PPQ — the
 * same resolution Tone.js's transport uses, so scheduling needs no conversion.
 * Seconds, pixels, and bars/beats/16ths are derived views computed here and
 * never stored.
 */

/** Pulses per quarter note. Changing this after schema v1 is a migration. */
export const PPQ = 192;

export const TICKS_PER_QUARTER = PPQ;
export const TICKS_PER_EIGHTH = PPQ / 2;
export const TICKS_PER_SIXTEENTH = PPQ / 4;
export const TICKS_PER_EIGHTH_TRIPLET = PPQ / 3;

/** The alpha time signature is fixed at 4/4 (PRD section 9.4). */
export const BEATS_PER_BAR = 4;
export const TICKS_PER_BAR = TICKS_PER_QUARTER * BEATS_PER_BAR;
export const SIXTEENTHS_PER_BEAT = TICKS_PER_QUARTER / TICKS_PER_SIXTEENTH;

/** A non-negative integer tick position or length. */
export const tickSchema = z.int().min(0).brand<"ticks">();
export type Ticks = z.infer<typeof tickSchema>;

/** A strictly positive integer tick length (durations are never zero). */
export const durationTickSchema = z.int().min(1).brand<"ticks">();

/** Is `value` a valid tick count: an integer, finite, and non-negative? */
export function isTicks(value: unknown): value is Ticks {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Narrows a number to `Ticks`, throwing on floating-point musical time. */
export function toTicks(value: number): Ticks {
	if (!isTicks(value)) {
		throw new TypeError(
			`Musical time must be a non-negative safe integer of ticks, received ${value}`,
		);
	}
	return value;
}

/** Rounds an arbitrary tick-valued number to the nearest storable tick. */
export function roundToTicks(value: number): Ticks {
	if (!Number.isFinite(value)) {
		throw new TypeError(`Cannot round non-finite musical time: ${value}`);
	}
	return toTicks(Math.max(0, Math.round(value)));
}

export function beatsToTicks(beats: number): Ticks {
	return roundToTicks(beats * TICKS_PER_QUARTER);
}

export function ticksToBeats(ticks: number): number {
	return ticks / TICKS_PER_QUARTER;
}

export function barsToTicks(bars: number): Ticks {
	return roundToTicks(bars * TICKS_PER_BAR);
}

export function ticksToBars(ticks: number): number {
	return ticks / TICKS_PER_BAR;
}

export function sixteenthsToTicks(sixteenths: number): Ticks {
	return roundToTicks(sixteenths * TICKS_PER_SIXTEENTH);
}

export function ticksToSixteenths(ticks: number): number {
	return ticks / TICKS_PER_SIXTEENTH;
}

/** Seconds are a derived view: they depend on tempo and are never stored. */
export function ticksToSeconds(ticks: number, bpm: number): number {
	assertTempo(bpm);
	return (ticks / TICKS_PER_QUARTER) * (60 / bpm);
}

export function secondsToTicks(seconds: number, bpm: number): Ticks {
	assertTempo(bpm);
	return roundToTicks((seconds * bpm * TICKS_PER_QUARTER) / 60);
}

export function minutesToTicks(minutes: number, bpm: number): Ticks {
	return secondsToTicks(minutes * 60, bpm);
}

function assertTempo(bpm: number): void {
	if (!Number.isFinite(bpm) || bpm <= 0) {
		throw new TypeError(
			`Tempo must be a positive finite number, received ${bpm}`,
		);
	}
}

/**
 * Zero-based bars/beats/16ths, matching Tone.js's `bars:beats:sixteenths`
 * notation, plus any ticks left over inside the 16th.
 */
export interface BarsBeatsSixteenths {
	bars: number;
	beats: number;
	sixteenths: number;
	ticks: number;
}

export function ticksToBarsBeatsSixteenths(ticks: number): BarsBeatsSixteenths {
	const total = toTicks(ticks);
	const bars = Math.floor(total / TICKS_PER_BAR);
	const withinBar = total - bars * TICKS_PER_BAR;
	const beats = Math.floor(withinBar / TICKS_PER_QUARTER);
	const withinBeat = withinBar - beats * TICKS_PER_QUARTER;
	const sixteenths = Math.floor(withinBeat / TICKS_PER_SIXTEENTH);
	return {
		bars,
		beats,
		sixteenths,
		ticks: withinBeat - sixteenths * TICKS_PER_SIXTEENTH,
	};
}

export function barsBeatsSixteenthsToTicks(
	position: Partial<BarsBeatsSixteenths>,
): Ticks {
	const { bars = 0, beats = 0, sixteenths = 0, ticks = 0 } = position;
	return roundToTicks(
		bars * TICKS_PER_BAR +
			beats * TICKS_PER_QUARTER +
			sixteenths * TICKS_PER_SIXTEENTH +
			ticks,
	);
}

/** Formats ticks as Tone.js-style `bars:beats:sixteenths`. */
export function formatBarsBeatsSixteenths(ticks: number): string {
	const position = ticksToBarsBeatsSixteenths(ticks);
	const sixteenths = position.sixteenths + position.ticks / TICKS_PER_SIXTEENTH;
	return `${position.bars}:${position.beats}:${trimNumber(sixteenths)}`;
}

/** Parses Tone.js-style `bars:beats:sixteenths` back into ticks. */
export function parseBarsBeatsSixteenths(value: string): Ticks {
	const parts = value.split(":");
	if (parts.length !== 3) {
		throw new TypeError(
			`Expected "bars:beats:sixteenths", received "${value}"`,
		);
	}
	const [bars, beats, sixteenths] = parts.map((part) => {
		const parsed = Number(part);
		if (!Number.isFinite(parsed) || parsed < 0) {
			throw new TypeError(`Invalid musical position "${value}"`);
		}
		return parsed;
	});
	return roundToTicks(
		bars * TICKS_PER_BAR +
			beats * TICKS_PER_QUARTER +
			sixteenths * TICKS_PER_SIXTEENTH,
	);
}

function trimNumber(value: number): string {
	return Number.isInteger(value) ? `${value}` : `${Number(value.toFixed(6))}`;
}
