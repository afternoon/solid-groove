// Tonal one-shots: 25 assets covering chords, stabs, plucks, keys, mallets, and
// bells.
//
// Section 6.2 asks for "major/minor/neutral material" and section 2 principle 7
// prefers foundations over recognisable phrases, so these are single voiced
// hits the user arranges themselves — not premade melodic figures.

/** @type {import("./index.mjs").CatalogEntry[]} */
export const CHORDS = [
	{
		name: "Warm Minor Seventh Chord",
		voice: "chord",
		params: { root: "C3", quality: "minor7", decay: 1.2, cutoff: 2400 },
		genres: ["house", "lofi", "electronic-pop"],
		characters: ["warm", "clean", "long"],
		intensity: "low",
	},
	{
		name: "Bright Major Seventh Chord",
		voice: "chord",
		params: {
			root: "F3",
			quality: "major7",
			decay: 1.3,
			cutoff: 3600,
			waveform: "triangle",
		},
		genres: ["house", "electronic-pop", "ambient"],
		characters: ["bright", "soft", "clean"],
		intensity: "low",
	},
	{
		name: "Neutral Fifth Pad Hit",
		voice: "chord",
		params: {
			root: "A2",
			quality: "fifth",
			decay: 1.8,
			cutoff: 1800,
			attack: 0.05,
		},
		genres: ["techno", "ambient", "trance", "dubstep"],
		characters: ["dark", "long", "clean"],
		intensity: "low",
	},
	{
		name: "Suspended Fourth Chord",
		voice: "chord",
		params: { root: "D3", quality: "sus4", decay: 1.4, cutoff: 2800 },
		genres: ["trance", "ambient", "electronic-pop"],
		characters: ["clean", "bright", "long"],
		intensity: "low",
	},
	{
		name: "Deep Minor Ninth Chord",
		voice: "chord",
		params: {
			root: "G2",
			quality: "minor9",
			decay: 1.6,
			cutoff: 1600,
			detuneCents: 10,
		},
		genres: ["house", "lofi", "drum-and-bass", "trap"],
		characters: ["dark", "warm", "layered"],
		intensity: "medium",
	},
	{
		name: "Organ Major Chord",
		voice: "organ",
		params: { root: "C3", quality: "major", decay: 0.9 },
		genres: ["house", "uk-garage", "electronic-pop"],
		characters: ["warm", "clean", "resonant"],
		intensity: "medium",
	},
	{
		name: "Organ Minor Chord",
		voice: "organ",
		params: {
			root: "A2",
			quality: "minor",
			decay: 1.1,
			drawbars: [1, 0.7, 0.5, 0.35],
			drive: 2,
		},
		genres: ["house", "uk-garage", "lofi"],
		characters: ["warm", "gritty", "resonant"],
		intensity: "medium",
	},
];

/** @type {import("./index.mjs").CatalogEntry[]} */
export const TONAL_STABS = [
	{
		name: "Filtered Minor Stab",
		voice: "stab",
		params: { root: "C3", quality: "minor7", decay: 0.35 },
		genres: ["house", "techno", "uk-garage"],
		characters: ["resonant", "short", "punchy"],
		intensity: "medium",
	},
	{
		name: "Dominant Seventh Stab",
		voice: "stab",
		params: {
			root: "F3",
			quality: "dominant7",
			decay: 0.28,
			cutoff: 3800,
			q: 4,
		},
		genres: ["house", "uk-garage", "electronic-pop"],
		characters: ["bright", "short", "clean"],
		intensity: "medium",
	},
	{
		name: "Atonal Fifth Stab",
		voice: "stab",
		params: {
			root: "D2",
			quality: "fifth",
			decay: 0.2,
			cutoff: 2200,
			q: 7,
			drive: 3,
		},
		genres: ["techno", "dubstep"],
		characters: ["dark", "abrasive", "short"],
		intensity: "high",
	},
	{
		name: "Rave Chord Stab",
		voice: "stab",
		params: {
			root: "A2",
			quality: "minor",
			decay: 0.45,
			cutoff: 4200,
			q: 3,
			drive: 2.4,
		},
		genres: ["drum-and-bass", "breakbeat", "trance", "jungle"],
		characters: ["bright", "gritty", "punchy"],
		intensity: "high",
	},
];

/** @type {import("./index.mjs").CatalogEntry[]} */
export const PLUCKS = [
	{
		name: "Nylon Pluck",
		voice: "pluck",
		params: { note: "C4", decay: 0.9, damping: 0.4 },
		genres: ["lofi", "ambient", "electronic-pop"],
		characters: ["organic", "soft", "warm"],
		intensity: "low",
	},
	{
		name: "Bright Synth Pluck",
		voice: "pluck",
		params: { note: "G4", decay: 0.6, damping: 0.2, brightness: 7000 },
		genres: ["trance", "house", "electronic-pop"],
		characters: ["bright", "clean", "short"],
		intensity: "medium",
	},
	{
		name: "Dark Muted Pluck",
		voice: "pluck",
		params: { note: "E3", decay: 0.45, damping: 0.65, brightness: 1800 },
		genres: ["lofi", "hip-hop", "drum-and-bass", "trap"],
		characters: ["dark", "soft", "warm"],
		intensity: "low",
	},
	{
		name: "Detuned Noise Pluck",
		voice: "pluck",
		params: {
			note: "A3",
			decay: 0.7,
			damping: 0.3,
			blend: 0.72,
			brightness: 5000,
		},
		genres: ["ambient", "techno", "dubstep"],
		characters: ["experimental", "noisy", "resonant"],
		intensity: "medium",
	},
];

/** @type {import("./index.mjs").CatalogEntry[]} */
export const KEYS = [
	{
		name: "Tine Electric Key",
		voice: "key",
		params: { note: "C3", decay: 1.5, ratio: 3, index: 3.2 },
		genres: ["lofi", "house", "hip-hop"],
		characters: ["warm", "clean", "long"],
		intensity: "low",
	},
	{
		name: "Soft Chorused Key",
		voice: "key",
		params: { note: "F3", decay: 1.8, ratio: 2, index: 2.2, chorus: 0.35 },
		genres: ["lofi", "ambient", "electronic-pop"],
		characters: ["soft", "warm", "long"],
		intensity: "low",
	},
	{
		name: "Bright Bell Key",
		voice: "key",
		params: { note: "A3", decay: 1.2, ratio: 7, index: 4.5, tine: 0.5 },
		genres: ["electronic-pop", "trance", "ambient"],
		characters: ["bright", "metallic", "clean"],
		intensity: "medium",
	},
	{
		name: "Detuned Toy Key",
		voice: "key",
		params: { note: "D4", decay: 0.8, ratio: 3.41, index: 6, tine: 0.6 },
		genres: ["lofi", "ambient", "electronic-pop"],
		characters: ["experimental", "bright", "gritty"],
		intensity: "medium",
	},
];

/** @type {import("./index.mjs").CatalogEntry[]} */
export const MALLETS = [
	{
		name: "Wooden Marimba Mallet",
		voice: "struck",
		params: { material: "wood", note: "C4", decay: 0.55, noise: 0.5 },
		genres: ["lofi", "ambient", "electronic-pop"],
		characters: ["wooden", "warm", "organic"],
		intensity: "low",
	},
	{
		name: "Metal Vibraphone Mallet",
		voice: "struck",
		params: {
			material: "metal",
			note: "F4",
			decay: 1.4,
			noise: 0.3,
			brightness: 0.8,
		},
		genres: ["ambient", "lofi", "house"],
		characters: ["metallic", "resonant", "long"],
		intensity: "low",
	},
	{
		name: "Glass Mallet Ring",
		voice: "struck",
		params: { material: "glass", note: "A4", decay: 1.1, noise: 0.25 },
		genres: ["ambient", "trance", "electronic-pop"],
		characters: ["glassy", "bright", "resonant"],
		intensity: "low",
	},
];

/** @type {import("./index.mjs").CatalogEntry[]} */
export const BELLS = [
	{
		name: "Clean Struck Bell",
		voice: "bell",
		params: { note: "A5", decay: 2.2, index: 5, ratio: 1.41 },
		genres: ["ambient", "trance", "electronic-pop"],
		characters: ["metallic", "long", "clean"],
		intensity: "low",
	},
	{
		name: "Dark Temple Bell",
		voice: "bell",
		params: { note: "D3", decay: 3.4, index: 3.2, ratio: 1.73, strike: 0.5 },
		genres: ["ambient", "techno", "dubstep", "trap"],
		characters: ["dark", "long", "resonant"],
		intensity: "low",
	},
	{
		name: "Clangorous Bell",
		voice: "bell",
		params: { note: "F4", decay: 1.8, index: 11, ratio: 2.61, strike: 0.6 },
		genres: ["techno", "dubstep", "ambient"],
		characters: ["abrasive", "metallic", "experimental"],
		intensity: "high",
	},
];
