// The CLP-03 "optional in-key pitch guide": a pure, view-only helper that says
// which of a note's twelve pitch classes belong to a chosen key.
//
// This is deliberately *not* domain state. A key is a way of shading the roll
// so a musician can see the scale; it is never written into a Project, never
// persisted, and never gates what note a user may create — the guide can be
// turned off and every pitch is still playable. Keeping it here, framework-free
// and pure, keeps that promise honest and makes the interval maths testable
// without a component.

/** The twelve chromatic pitch-class names, sharps, index 0 == C. */
export const PITCH_CLASS_NAMES = [
	"C",
	"C#",
	"D",
	"D#",
	"E",
	"F",
	"F#",
	"G",
	"G#",
	"A",
	"A#",
	"B",
] as const;

export type PitchClass = number; // 0..11

/** The scale modes the guide offers. */
export type ScaleMode = "major" | "minor";

/** Semitone offsets from the root for each supported mode. */
const SCALE_INTERVALS: Record<ScaleMode, readonly number[]> = {
	major: [0, 2, 4, 5, 7, 9, 11],
	minor: [0, 2, 3, 5, 7, 8, 10],
};

/** A chosen key: a root pitch class (0..11) and a mode. */
export interface KeyGuide {
	readonly root: PitchClass;
	readonly mode: ScaleMode;
}

/** The pitch class (0..11) of any MIDI pitch. Total for every integer. */
export function pitchClassOf(pitch: number): PitchClass {
	return ((Math.trunc(pitch) % 12) + 12) % 12;
}

/**
 * The set of pitch classes in a key. Precomputed rather than recomputed per
 * row: a roll has 128 rows and redraws on every scroll, so membership is a
 * `Set` lookup, not a scan.
 */
export function keyPitchClasses(guide: KeyGuide): ReadonlySet<PitchClass> {
	const root = pitchClassOf(guide.root);
	return new Set(
		SCALE_INTERVALS[guide.mode].map((interval) => (root + interval) % 12),
	);
}

/** Whether a MIDI pitch is in the key. */
export function isPitchInKey(guide: KeyGuide, pitch: number): boolean {
	return keyPitchClasses(guide).has(pitchClassOf(pitch));
}

/** Whether a pitch class is a black key on a piano — used to stripe the roll. */
export function isBlackKey(pitch: number): boolean {
	const pc = pitchClassOf(pitch);
	return pc === 1 || pc === 3 || pc === 6 || pc === 8 || pc === 10;
}

/** Human label for a MIDI pitch, e.g. 60 -> "C4" (middle C, scientific). */
export function pitchLabel(pitch: number): string {
	const pc = pitchClassOf(pitch);
	const octave = Math.floor(pitch / 12) - 1;
	return `${PITCH_CLASS_NAMES[pc]}${octave}`;
}
