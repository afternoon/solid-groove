import type { Timestamp } from "firebase/firestore";

/**
 * Prototype project types — superseded by the canonical schema-v1 domain model
 * in `src/domain`.
 *
 * These index-based types (a pattern's sequence index implies a track) are not
 * schema v1 and are not persisted by it. They remain only because the current
 * editor, player, and Firestore service still read them; the `FND-009` slice
 * migrates those consumers onto `src/domain` and deletes this file. Do not add
 * new fields or new consumers here.
 */

export type Note = string | null;

export interface Envelope {
	attack: number; // in seconds
	decay: number; // in seconds
	sustain: number; // 0-1 level
	release: number; // in seconds
}

export interface FilterConfig {
	type: "lowpass" | "highpass" | "bandpass" | "notch";
	cutoff: number; // in Hz
	resonance: number; // Q factor
}

export interface ClipInstrument {
	type: "clip";
	sampleUrl: string;
	sampleTempo: number; // in BPM
}

export interface SynthInstrument {
	type: "synth";
	oscillatorType: "sine" | "square" | "sawtooth" | "triangle";
	envelope: Envelope;
	filter: FilterConfig;
}

export interface SamplerInstrument {
	type: "sampler";
	sampleUrl: string;
	envelope: Envelope;
	filter: FilterConfig;
}

export type Instrument = ClipInstrument | SynthInstrument | SamplerInstrument;

// TODO reuse data model from Tone sequences here if possible
export interface Sequence {
	steps: Note[]; // e.g. ["C3", null, null, null, "C3", null, null, null, "C3", null, null, null, "C3", null, null, null];
}

export interface Pattern {
	sequences: Sequence[]; // one per track
}

export interface Track {
	name: string;
	volume: number;
	isMuted: boolean;
	isSolo: boolean;
	instrument: Instrument;
}

export interface Song {
	tempo: number;
	tracks: Track[];
	patterns: Pattern[];
}

export interface Project {
	id: string;
	name?: string;
	ownerId: string;
	createdAt: Timestamp;
	isPublic: boolean;
	latestSnapshot: {
		song: Song;
	};
}
