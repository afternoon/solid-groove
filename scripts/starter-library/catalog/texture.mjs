// Texture one-shots: 19 assets.
//
// Section 7.6 makes this family load-bearing — Ambient has to prove a starter
// works with no kick and no fixed tempo — and section 6.4 wants material that
// is hard to categorise. These are the longest assets in the starter set, so
// they are also what exercises the streaming and caching budgets in section 12.

/** @type {import("./index.mjs").CatalogEntry[]} */
export const NOISE = [
	{
		name: "Pulsed Noise Band",
		voice: "noiseTexture",
		params: { duration: 2.5, bandHz: 900, q: 2.5, rate: 8, depth: 0.85 },
		genres: ["techno", "dubstep", "drum-and-bass"],
		characters: ["noisy", "gritty", "long"],
		intensity: "medium",
	},
	{
		name: "Fast Gated Noise",
		voice: "noiseTexture",
		params: { duration: 2, bandHz: 2600, q: 4, rate: 16, depth: 1 },
		genres: ["techno", "drum-and-bass", "dubstep"],
		characters: ["noisy", "bright", "experimental"],
		intensity: "high",
	},
	{
		name: "Soft Air Noise",
		voice: "noiseTexture",
		params: {
			duration: 3.5,
			bandHz: 4200,
			q: 0.8,
			rate: 0.6,
			depth: 0.35,
			kind: "pink",
		},
		genres: ["ambient", "lofi", "electronic-pop"],
		characters: ["soft", "warm", "long"],
		intensity: "low",
	},
	{
		name: "Crushed Machine Noise",
		voice: "noiseTexture",
		params: {
			duration: 2.2,
			bandHz: 1400,
			q: 3,
			rate: 11,
			depth: 0.9,
			crush: 6,
			drive: 4,
		},
		genres: ["techno", "dubstep"],
		characters: ["abrasive", "distorted", "experimental"],
		intensity: "extreme",
	},
	{
		name: "Low Rumble Noise",
		voice: "noiseTexture",
		params: {
			duration: 4,
			bandHz: 120,
			q: 1.4,
			rate: 0.4,
			depth: 0.5,
			kind: "pink",
		},
		genres: ["dubstep", "techno", "ambient", "trap"],
		characters: ["dark", "deep", "long"],
		intensity: "medium",
	},
];

/** @type {import("./index.mjs").CatalogEntry[]} */
export const AMBIENCES = [
	{
		name: "Wide Room Ambience",
		voice: "ambience",
		params: { duration: 8, cutoff: 2400, density: 0.35 },
		genres: ["ambient", "lofi", "electronic-pop"],
		characters: ["roomy", "soft", "long"],
		intensity: "low",
	},
	{
		name: "Dark Cavern Ambience",
		voice: "ambience",
		params: {
			duration: 10,
			cutoff: 1200,
			lowCut: 60,
			density: 0.2,
			room: 0.75,
		},
		genres: ["ambient", "dubstep", "techno"],
		characters: ["dark", "long", "roomy"],
		intensity: "low",
	},
	{
		name: "Bright Open Ambience",
		voice: "ambience",
		params: { duration: 8, cutoff: 5200, lowCut: 180, density: 0.5, room: 0.5 },
		genres: ["ambient", "trance", "electronic-pop"],
		characters: ["bright", "clean", "long"],
		intensity: "low",
	},
	{
		name: "Restless Event Ambience",
		voice: "ambience",
		params: { duration: 9, cutoff: 3200, density: 1.1, room: 0.65 },
		genres: ["ambient", "techno", "dubstep"],
		characters: ["experimental", "resonant", "long"],
		intensity: "medium",
	},
];

/** @type {import("./index.mjs").CatalogEntry[]} */
export const DRONES = [
	{
		name: "Warm Low Drone",
		voice: "drone",
		params: { note: "C2", duration: 8, partials: 6, cutoff: 1600 },
		genres: ["ambient", "techno", "dubstep"],
		characters: ["warm", "deep", "long"],
		intensity: "low",
	},
	{
		name: "Dark Detuned Drone",
		voice: "drone",
		params: {
			note: "F1",
			duration: 10,
			partials: 8,
			detuneCents: 18,
			cutoff: 900,
			noise: 0.2,
		},
		genres: ["ambient", "dubstep", "techno"],
		characters: ["dark", "long", "layered"],
		intensity: "medium",
	},
	{
		name: "Shifting Harmonic Drone",
		voice: "drone",
		params: {
			note: "A2",
			duration: 9,
			partials: 10,
			movement: 0.7,
			cutoff: 3200,
		},
		genres: ["ambient", "trance", "electronic-pop"],
		characters: ["resonant", "long", "experimental"],
		intensity: "low",
	},
	{
		name: "Noisy Machine Drone",
		voice: "drone",
		params: {
			note: "D2",
			duration: 8,
			partials: 5,
			noise: 0.7,
			cutoff: 2400,
			movement: 0.5,
		},
		genres: ["techno", "dubstep", "ambient"],
		characters: ["noisy", "gritty", "experimental"],
		intensity: "medium",
	},
];

/** @type {import("./index.mjs").CatalogEntry[]} */
export const MECHANICAL = [
	{
		name: "Motor Loop Texture",
		voice: "noiseTexture",
		params: { duration: 3, bandHz: 640, q: 6, rate: 24, depth: 0.95, crush: 3 },
		genres: ["techno", "dubstep", "ambient"],
		characters: ["experimental", "gritty", "long"],
		intensity: "medium",
	},
	{
		name: "Failing Circuit Texture",
		voice: "glitch",
		params: {
			duration: 1.6,
			slices: 26,
			bits: 4,
			downsample: 9,
			bandHz: 2600,
			fold: 1.4,
		},
		genres: ["techno", "dubstep", "drum-and-bass"],
		characters: ["experimental", "abrasive", "distorted"],
		intensity: "extreme",
	},
	{
		name: "Ratcheting Metal Texture",
		voice: "noiseTexture",
		params: {
			duration: 2.4,
			bandHz: 3800,
			q: 8,
			rate: 33,
			depth: 1,
			crush: 2,
			drive: 2.6,
		},
		genres: ["techno", "drum-and-bass", "dubstep"],
		characters: ["metallic", "abrasive", "experimental"],
		intensity: "high",
	},
];

/** @type {import("./index.mjs").CatalogEntry[]} */
export const ORGANIC = [
	{
		name: "Close Object Ambience",
		voice: "ambience",
		params: {
			duration: 6,
			cutoff: 6000,
			lowCut: 220,
			density: 1.6,
			room: 0.28,
		},
		genres: ["ambient", "lofi", "hip-hop"],
		characters: ["organic", "resonant", "soft"],
		intensity: "low",
	},
	{
		name: "Resonant Wood Body",
		voice: "drone",
		params: {
			note: "G2",
			duration: 6,
			partials: 4,
			noise: 0.45,
			cutoff: 1400,
			movement: 0.6,
		},
		genres: ["ambient", "lofi", "electronic-pop"],
		characters: ["wooden", "organic", "warm"],
		intensity: "low",
	},
	{
		name: "Breathing Surface Texture",
		voice: "noiseTexture",
		params: {
			duration: 5,
			bandHz: 1800,
			q: 1.2,
			rate: 0.9,
			depth: 0.75,
			kind: "pink",
		},
		genres: ["ambient", "lofi", "electronic-pop"],
		characters: ["organic", "soft", "long"],
		intensity: "low",
	},
];
