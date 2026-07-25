// Note names, frequencies, and chord shapes shared by the voices and the
// catalogue. Tonal assets record a root note in the manifest, so the name and
// the rendered pitch have to come from one place.

const SEMITONES = {
	C: 0,
	"C#": 1,
	Db: 1,
	D: 2,
	"D#": 3,
	Eb: 3,
	E: 4,
	F: 5,
	"F#": 6,
	Gb: 6,
	G: 7,
	"G#": 8,
	Ab: 8,
	A: 9,
	"A#": 10,
	Bb: 10,
	B: 11,
};

/** Scientific pitch notation to MIDI number: "A4" is 69, "C1" is 24. */
export function noteToMidi(note) {
	const match = /^([A-G][#b]?)(-?\d+)$/.exec(note);
	if (!match) throw new Error(`unrecognized note: ${note}`);
	const [, pitch, octave] = match;
	return SEMITONES[pitch] + (Number(octave) + 1) * 12;
}

export function midiToFrequency(midi) {
	return 440 * 2 ** ((midi - 69) / 12);
}

export function noteToFrequency(note) {
	return midiToFrequency(noteToMidi(note));
}

/** Semitone offsets from the root for the chord voicings the catalogue uses. */
export const CHORD_INTERVALS = {
	minor: [0, 3, 7],
	major: [0, 4, 7],
	minor7: [0, 3, 7, 10],
	major7: [0, 4, 7, 11],
	dominant7: [0, 4, 7, 10],
	minor9: [0, 3, 7, 10, 14],
	sus2: [0, 2, 7],
	sus4: [0, 5, 7],
	// Deliberately ambiguous: a root and a fifth belong to no mode, so it fits
	// anywhere the user takes the project (library principle 3).
	fifth: [0, 7],
};

export function chordFrequencies(root, quality) {
	const intervals = CHORD_INTERVALS[quality];
	if (!intervals) throw new Error(`unknown chord quality: ${quality}`);
	const midi = noteToMidi(root);
	return intervals.map((interval) => midiToFrequency(midi + interval));
}
