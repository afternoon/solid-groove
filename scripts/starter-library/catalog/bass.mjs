// Bass one-shots: 21 assets covering the section 6.2 required range — clean
// sine/sub, tuned long-decay bass, reese, distorted, short stab, and sustained.
//
// Roots are spread across the low register rather than all sitting on C, so a
// starter project can pick a key without every bass note needing transposition.

/** @type {import("./index.mjs").CatalogEntry[]} */
export const SUBS = [
	{
		name: "Clean Sine Sub C",
		voice: "sub",
		params: { note: "C1", decay: 0.9, click: 0.05 },
		genres: ["dubstep", "drum-and-bass", "techno"],
		characters: ["clean", "sub-heavy", "deep"],
		intensity: "low",
	},
	{
		name: "Clean Sine Sub F",
		voice: "sub",
		params: { note: "F1", decay: 0.9, click: 0.05 },
		genres: ["dubstep", "drum-and-bass", "techno"],
		characters: ["clean", "sub-heavy", "deep"],
		intensity: "low",
	},
	{
		name: "Clean Sine Sub A",
		voice: "sub",
		params: { note: "A0", decay: 1.1, click: 0.04 },
		genres: ["dubstep", "ambient", "techno"],
		characters: ["clean", "sub-heavy", "long"],
		intensity: "low",
	},
	{
		name: "Short Sub Blip",
		voice: "sub",
		params: { note: "D1", decay: 0.22, curve: 1.3, click: 0.2 },
		genres: ["uk-garage", "house", "drum-and-bass"],
		characters: ["short", "clean", "tight"],
		intensity: "low",
	},
	{
		name: "Plucked Sub",
		voice: "sub",
		params: { note: "G1", decay: 0.45, curve: 1.5, click: 0.35 },
		genres: ["house", "uk-garage", "electronic-pop"],
		characters: ["tight", "round", "punchy"],
		intensity: "medium",
	},
	{
		name: "Warm Saturated Sub",
		voice: "sub",
		params: { note: "E1", decay: 0.8, drive: 2.4, click: 0.12 },
		genres: ["dubstep", "hip-hop", "lofi"],
		characters: ["warm", "sub-heavy", "gritty"],
		intensity: "medium",
	},
	{
		name: "Driven Sub Growl",
		voice: "sub",
		params: { note: "C1", decay: 0.7, drive: 8, click: 0.1 },
		genres: ["dubstep", "drum-and-bass"],
		characters: ["distorted", "abrasive", "sub-heavy"],
		intensity: "extreme",
	},
	{
		name: "Long Sine Drop",
		voice: "sub",
		params: { note: "A#0", decay: 1.8, curve: 0.6, click: 0.03 },
		genres: ["ambient", "dubstep", "techno"],
		characters: ["long", "clean", "deep"],
		intensity: "low",
	},
];

/** @type {import("./index.mjs").CatalogEntry[]} */
export const SUSTAINED = [
	{
		name: "Tuned Long Bass F",
		voice: "tunedBass",
		params: { note: "F1", decay: 1.6, drive: 1.6 },
		genres: ["trap", "hip-hop", "dubstep"],
		characters: ["tuned", "long", "sub-heavy"],
		intensity: "medium",
	},
	{
		name: "Tuned Long Bass C",
		voice: "tunedBass",
		params: { note: "C1", decay: 2, drive: 1.4 },
		genres: ["trap", "hip-hop", "dubstep"],
		characters: ["tuned", "long", "deep"],
		intensity: "medium",
	},
	{
		name: "Glide Bass A",
		voice: "tunedBass",
		params: { note: "A1", decay: 1.2, glideRatio: 2.4, glideTau: 0.12 },
		genres: ["trap", "dubstep", "uk-garage"],
		characters: ["tuned", "experimental", "long"],
		intensity: "medium",
	},
	{
		name: "Distorted Long Bass",
		voice: "tunedBass",
		params: { note: "D1", decay: 1.5, drive: 6 },
		genres: ["trap", "dubstep", "drum-and-bass"],
		characters: ["distorted", "abrasive", "sub-heavy"],
		intensity: "extreme",
	},
	{
		name: "Soft Sustained Bass",
		voice: "tunedBass",
		params: {
			note: "G1",
			decay: 2.2,
			drive: 1.05,
			glideRatio: 1.15,
			glideTau: 0.1,
		},
		genres: ["ambient", "lofi", "electronic-pop"],
		characters: ["soft", "warm", "long"],
		intensity: "low",
	},
];

/** @type {import("./index.mjs").CatalogEntry[]} */
export const REESES = [
	{
		name: "Classic Reese Bass",
		voice: "reese",
		params: { note: "F1", decay: 1.4, voices: 3, detuneCents: 14, cutoff: 900 },
		genres: ["drum-and-bass", "jungle"],
		characters: ["gritty", "long", "dark"],
		intensity: "high",
	},
	{
		name: "Wide Detuned Reese",
		voice: "reese",
		params: {
			note: "D1",
			decay: 1.8,
			voices: 5,
			detuneCents: 26,
			cutoff: 700,
			q: 4,
		},
		genres: ["drum-and-bass", "dubstep"],
		characters: ["layered", "dark", "long"],
		intensity: "high",
	},
	{
		name: "Opening Reese Sweep",
		voice: "reese",
		params: {
			note: "A1",
			decay: 1.6,
			voices: 4,
			detuneCents: 18,
			cutoff: 500,
			sweep: 2.4,
			q: 5,
		},
		genres: ["drum-and-bass", "dubstep", "techno", "jungle"],
		characters: ["experimental", "resonant", "long"],
		intensity: "high",
	},
	{
		name: "Crushed Reese Growl",
		voice: "reese",
		params: {
			note: "C1",
			decay: 1.2,
			voices: 4,
			detuneCents: 34,
			cutoff: 1400,
			drive: 6,
		},
		genres: ["dubstep", "drum-and-bass"],
		characters: ["distorted", "abrasive", "experimental"],
		intensity: "extreme",
	},
];

/** @type {import("./index.mjs").CatalogEntry[]} */
export const BASS_STABS = [
	{
		name: "Acid Bass Stab",
		voice: "bassStab",
		params: { note: "A1", decay: 0.28, cutoff: 1600, q: 6 },
		genres: ["house", "techno"],
		characters: ["resonant", "gritty", "short"],
		intensity: "medium",
	},
	{
		name: "Square Bass Stab",
		voice: "bassStab",
		params: { note: "E1", decay: 0.22, waveform: "square", cutoff: 1200, q: 3 },
		genres: ["uk-garage", "house", "electronic-pop"],
		characters: ["round", "tight", "warm"],
		intensity: "medium",
	},
	{
		name: "Hard Mid Bass Stab",
		voice: "bassStab",
		params: { note: "G1", decay: 0.3, cutoff: 2600, q: 5, drive: 4 },
		genres: ["drum-and-bass", "dubstep"],
		characters: ["distorted", "punchy", "bright"],
		intensity: "high",
	},
	{
		name: "Soft Rubber Bass Stab",
		voice: "bassStab",
		params: {
			note: "C2",
			decay: 0.35,
			waveform: "triangle",
			cutoff: 900,
			q: 2,
			drive: 1.2,
		},
		genres: ["lofi", "ambient", "electronic-pop"],
		characters: ["soft", "warm", "round"],
		intensity: "low",
	},
];
