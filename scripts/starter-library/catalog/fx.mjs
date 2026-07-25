// Transition and effect one-shots: 24 assets.
//
// Section 6.2 asks for "short/long transitions, noise movement, drop impacts,
// fills, and unexpected effects", and section 2 principle 5 makes these a
// requirement rather than a nicety: without them a starter can build a loop but
// not a track.
//
// Risers and downers share one renderer with a flipped direction, so a build
// and its mirrored fall genuinely match.

/** @type {import("./index.mjs").CatalogEntry[]} */
export const IMPACTS = [
	{
		name: "Deep Drop Impact",
		voice: "impact",
		params: { decay: 1.8, lowHz: 42, boom: 1.2, crackle: 0.3, room: 0.45 },
		genres: ["dubstep", "drum-and-bass", "trance"],
		characters: ["deep", "long", "roomy"],
		intensity: "high",
	},
	{
		name: "Short Slam Impact",
		voice: "impact",
		params: { decay: 0.7, lowHz: 55, boom: 1, crackle: 0.5, room: 0.2 },
		genres: ["techno", "hip-hop", "breakbeat", "trap"],
		characters: ["short", "punchy", "dry"],
		intensity: "high",
	},
	{
		name: "Cinematic Boom Impact",
		voice: "impact",
		params: {
			decay: 3,
			lowHz: 34,
			boom: 1.5,
			crackle: 0.2,
			room: 0.7,
			drive: 1.3,
		},
		genres: ["ambient", "dubstep", "trance"],
		characters: ["deep", "long", "roomy"],
		intensity: "extreme",
	},
	{
		name: "Metal Crash Impact",
		voice: "impact",
		params: {
			decay: 1.4,
			lowHz: 70,
			boom: 0.5,
			crackle: 1.4,
			room: 0.4,
			drive: 3,
		},
		genres: ["techno", "dubstep", "drum-and-bass"],
		characters: ["metallic", "abrasive", "experimental"],
		intensity: "extreme",
	},
	{
		name: "Soft Swell Impact",
		voice: "impact",
		params: {
			decay: 2.2,
			lowHz: 48,
			boom: 0.8,
			crackle: 0.12,
			room: 0.6,
			drive: 1.05,
		},
		genres: ["ambient", "lofi", "electronic-pop"],
		characters: ["soft", "roomy", "long"],
		intensity: "low",
	},
	{
		name: "Distorted Sub Impact",
		voice: "impact",
		params: {
			decay: 1.6,
			lowHz: 38,
			boom: 1.6,
			crackle: 0.6,
			room: 0.3,
			drive: 7,
		},
		genres: ["dubstep", "drum-and-bass", "techno", "trap"],
		characters: ["distorted", "sub-heavy", "abrasive"],
		intensity: "extreme",
	},
];

/** @type {import("./index.mjs").CatalogEntry[]} */
export const RISERS = [
	{
		name: "One Bar Noise Riser",
		voice: "sweepFx",
		params: { duration: 2, direction: "up", startHz: 200, endHz: 9000, q: 3 },
		genres: ["trance", "house", "electronic-pop"],
		characters: ["noisy", "bright", "clean"],
		intensity: "medium",
	},
	{
		name: "Long Build Riser",
		voice: "sweepFx",
		params: {
			duration: 6,
			direction: "up",
			startHz: 150,
			endHz: 11000,
			q: 4,
			room: 0.3,
		},
		genres: ["trance", "house", "electronic-pop", "drum-and-bass"],
		characters: ["long", "bright", "clean"],
		intensity: "high",
	},
	{
		name: "Tonal Rising Sweep",
		voice: "sweepFx",
		params: {
			duration: 4,
			direction: "up",
			startHz: 300,
			endHz: 7000,
			tone: 0.5,
			toneStart: 110,
			toneEnd: 1600,
		},
		genres: ["trance", "dubstep", "drum-and-bass"],
		characters: ["resonant", "long", "bright"],
		intensity: "high",
	},
	{
		name: "Short Snap Riser",
		voice: "sweepFx",
		params: {
			duration: 0.9,
			direction: "up",
			startHz: 400,
			endHz: 12000,
			q: 5,
			room: 0.1,
		},
		genres: ["uk-garage", "breakbeat", "house", "trap"],
		characters: ["short", "bright", "tight"],
		intensity: "medium",
	},
	{
		name: "Dark Pressure Riser",
		voice: "sweepFx",
		params: {
			duration: 5,
			direction: "up",
			startHz: 80,
			endHz: 2400,
			q: 6,
			noiseKind: "pink",
			drive: 3,
			room: 0.4,
		},
		genres: ["dubstep", "techno", "drum-and-bass"],
		characters: ["dark", "abrasive", "experimental"],
		intensity: "extreme",
	},
];

/** @type {import("./index.mjs").CatalogEntry[]} */
export const DOWNERS = [
	{
		name: "One Bar Noise Downer",
		voice: "sweepFx",
		params: { duration: 2, direction: "down", startHz: 200, endHz: 9000, q: 3 },
		genres: ["trance", "house", "electronic-pop"],
		characters: ["noisy", "dark", "clean"],
		intensity: "medium",
	},
	{
		name: "Long Fall Downer",
		voice: "sweepFx",
		params: {
			duration: 5,
			direction: "down",
			startHz: 120,
			endHz: 10000,
			q: 4,
			room: 0.35,
		},
		genres: ["trance", "dubstep", "drum-and-bass"],
		characters: ["long", "dark", "clean"],
		intensity: "medium",
	},
	{
		name: "Tonal Falling Sweep",
		voice: "sweepFx",
		params: {
			duration: 3,
			direction: "down",
			startHz: 250,
			endHz: 6000,
			tone: 0.55,
			toneStart: 90,
			toneEnd: 1400,
		},
		genres: ["dubstep", "drum-and-bass", "techno"],
		characters: ["resonant", "dark", "experimental"],
		intensity: "high",
	},
	{
		name: "Crushed Drop Downer",
		voice: "sweepFx",
		params: {
			duration: 2.4,
			direction: "down",
			startHz: 100,
			endHz: 8000,
			q: 7,
			drive: 5,
			room: 0.25,
		},
		genres: ["dubstep", "techno"],
		characters: ["distorted", "abrasive", "dark"],
		intensity: "extreme",
	},
];

/** @type {import("./index.mjs").CatalogEntry[]} */
export const SWEEPS = [
	{
		name: "Mid Filter Sweep",
		voice: "sweepFx",
		params: {
			duration: 3,
			direction: "up",
			startHz: 600,
			endHz: 4200,
			q: 8,
			room: 0.15,
		},
		genres: ["house", "techno", "trance"],
		characters: ["resonant", "clean", "long"],
		intensity: "medium",
	},
	{
		name: "Wide Air Sweep",
		voice: "sweepFx",
		params: {
			duration: 4,
			direction: "down",
			startHz: 3000,
			endHz: 14000,
			q: 1.2,
			noiseKind: "pink",
			room: 0.45,
		},
		genres: ["ambient", "trance", "electronic-pop"],
		characters: ["soft", "bright", "long"],
		intensity: "low",
	},
	{
		name: "Resonant Zap Sweep",
		voice: "sweepFx",
		params: {
			duration: 1.2,
			direction: "up",
			startHz: 150,
			endHz: 6000,
			q: 14,
			drive: 2,
			room: 0.2,
		},
		genres: ["techno", "dubstep", "drum-and-bass"],
		characters: ["resonant", "experimental", "short"],
		intensity: "high",
	},
];

/** @type {import("./index.mjs").CatalogEntry[]} */
export const REVERSES = [
	{
		name: "Reverse Cymbal Swell",
		voice: "reverseFx",
		params: {
			source: "cymbal",
			duration: 2.2,
			params: { fundamental: 40, shimmer: 0.7, room: 0.3 },
		},
		genres: ["house", "trance", "electronic-pop"],
		characters: ["bright", "long", "clean"],
		intensity: "medium",
	},
	{
		name: "Reverse Impact Pull",
		voice: "reverseFx",
		params: {
			source: "impact",
			duration: 1.8,
			params: { lowHz: 45, boom: 1.1, room: 0.5 },
		},
		genres: ["dubstep", "drum-and-bass", "trance"],
		characters: ["deep", "roomy", "long"],
		intensity: "high",
	},
	{
		name: "Reverse Chord Rise",
		voice: "reverseFx",
		params: {
			source: "chord",
			duration: 2,
			params: { root: "A2", quality: "minor7", cutoff: 3000 },
		},
		genres: ["ambient", "lofi", "electronic-pop"],
		characters: ["soft", "warm", "long"],
		intensity: "low",
	},
];

/** @type {import("./index.mjs").CatalogEntry[]} */
export const GLITCHES = [
	{
		name: "Short Buffer Glitch",
		voice: "glitch",
		params: { duration: 0.35, slices: 8, bits: 5, downsample: 6, bandHz: 2400 },
		genres: ["drum-and-bass", "techno", "dubstep"],
		characters: ["experimental", "short", "gritty"],
		intensity: "medium",
	},
	{
		name: "Stuttering Fill Glitch",
		voice: "glitch",
		params: { duration: 1, slices: 18, bits: 6, downsample: 4, bandHz: 3600 },
		genres: ["drum-and-bass", "breakbeat", "uk-garage", "jungle"],
		characters: ["experimental", "bright", "noisy"],
		intensity: "high",
	},
	{
		name: "Folded Data Glitch",
		voice: "glitch",
		params: {
			duration: 0.7,
			slices: 14,
			bits: 3,
			downsample: 12,
			bandHz: 1500,
			fold: 2.2,
		},
		genres: ["techno", "dubstep"],
		characters: ["abrasive", "distorted", "experimental"],
		intensity: "extreme",
	},
];
