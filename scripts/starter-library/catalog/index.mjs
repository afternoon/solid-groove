// Assembles the 200-entry starter catalogue and assigns its stable asset IDs.
//
// The catalogue is data. It says what the library contains and how each asset
// is tagged; `voices.mjs` says what it sounds like; `manifest.mjs` says how it
// is described to the app. Nothing here touches the filesystem or the network.

import { isKnownRole } from "../taxonomy.mjs";
import { BASS_STABS, REESES, SUBS, SUSTAINED } from "./bass.mjs";
import {
	CLAPS,
	CLOSED_HATS,
	CYMBALS,
	KICKS,
	OPEN_HATS,
	PERCUSSION,
	RIMS,
	SNARES,
	TOMS,
} from "./drums.mjs";
import { DOWNERS, GLITCHES, IMPACTS, REVERSES, RISERS, SWEEPS } from "./fx.mjs";
import { AMBIENCES, DRONES, MECHANICAL, NOISE, ORGANIC } from "./texture.mjs";
import { BELLS, CHORDS, KEYS, MALLETS, PLUCKS, TONAL_STABS } from "./tonal.mjs";

/**
 * @typedef {object} CatalogEntry
 * @property {string} name             User-facing name.
 * @property {string} [voice]          Voice renderer; defaults to the group's voice.
 * @property {object} [params]         Voice parameters.
 * @property {string[]} genres         Genre IDs from the controlled vocabulary.
 * @property {string[]} characters     Character tags from the controlled vocabulary.
 * @property {string} intensity        low | medium | high | extreme.
 * @property {"open"|"closed"} [choke] Choke group membership for hat pairs.
 * @property {number} [peakDbfs]       Audition peak target; defaults to -1.5.
 */

/**
 * Role groups in ID-assignment order.
 *
 * Each group's entries are **append-only**: inserting, reordering, or removing
 * an entry renumbers every later asset in that group, which changes IDs that
 * saved projects reference. `catalog.test.mjs` pins the full ID list so an
 * accidental reshuffle fails CI rather than silently breaking stored projects.
 */
const GROUPS = [
	{ family: "drums", role: "kick", voice: "kick", entries: KICKS },
	{ family: "drums", role: "snare", voice: "snare", entries: SNARES },
	{ family: "drums", role: "clap", voice: "clap", entries: CLAPS },
	{ family: "drums", role: "rim", voice: "rim", entries: RIMS },
	{ family: "drums", role: "closed-hat", voice: "hat", entries: CLOSED_HATS },
	{ family: "drums", role: "open-hat", voice: "hat", entries: OPEN_HATS },
	{ family: "drums", role: "cymbal", voice: "cymbal", entries: CYMBALS },
	{ family: "drums", role: "tom", voice: "tom", entries: TOMS },
	{ family: "drums", role: "percussion", voice: "struck", entries: PERCUSSION },
	{ family: "bass", role: "sub", voice: "sub", entries: SUBS },
	{ family: "bass", role: "sustained", voice: "tunedBass", entries: SUSTAINED },
	{ family: "bass", role: "reese", voice: "reese", entries: REESES },
	{ family: "bass", role: "stab", voice: "bassStab", entries: BASS_STABS },
	{ family: "tonal", role: "chord", voice: "chord", entries: CHORDS },
	{ family: "tonal", role: "stab", voice: "stab", entries: TONAL_STABS },
	{ family: "tonal", role: "pluck", voice: "pluck", entries: PLUCKS },
	{ family: "tonal", role: "key", voice: "key", entries: KEYS },
	{ family: "tonal", role: "mallet", voice: "struck", entries: MALLETS },
	{ family: "tonal", role: "bell", voice: "bell", entries: BELLS },
	{ family: "texture", role: "noise", voice: "noiseTexture", entries: NOISE },
	{
		family: "texture",
		role: "ambience",
		voice: "ambience",
		entries: AMBIENCES,
	},
	{ family: "texture", role: "drone", voice: "drone", entries: DRONES },
	{
		family: "texture",
		role: "mechanical",
		voice: "noiseTexture",
		entries: MECHANICAL,
	},
	{ family: "texture", role: "organic", voice: "ambience", entries: ORGANIC },
	{ family: "fx", role: "impact", voice: "impact", entries: IMPACTS },
	{ family: "fx", role: "riser", voice: "sweepFx", entries: RISERS },
	{ family: "fx", role: "downer", voice: "sweepFx", entries: DOWNERS },
	{ family: "fx", role: "sweep", voice: "sweepFx", entries: SWEEPS },
	{ family: "fx", role: "reverse", voice: "reverseFx", entries: REVERSES },
	{ family: "fx", role: "glitch", voice: "glitch", entries: GLITCHES },
];

/**
 * Stable prefixed asset ID (PRD 9.4).
 *
 * `family` is part of the ID because `stab` is a legitimate role under both
 * `bass` and `tonal`, and appending to one family must not renumber the other.
 */
function assetId(family, role, index) {
	return `sg-one-shot-${family}-${role}-${String(index + 1).padStart(4, "0")}`;
}

/** Tonal material records the pitch it was rendered at, so the manifest can too. */
function rootNoteOf(entry) {
	return entry.params?.note ?? entry.params?.root ?? null;
}

function buildCatalog() {
	const assets = [];
	for (const group of GROUPS) {
		if (!isKnownRole(group.family, group.role)) {
			throw new Error(
				`catalog group uses an unknown role: ${group.family}/${group.role}`,
			);
		}
		group.entries.forEach((entry, index) => {
			assets.push({
				id: assetId(group.family, group.role, index),
				name: entry.name,
				family: group.family,
				role: group.role,
				voice: entry.voice ?? group.voice,
				params: entry.params ?? {},
				genres: entry.genres,
				characters: entry.characters,
				intensity: entry.intensity,
				rootNote: rootNoteOf(entry),
				choke: entry.choke ?? null,
				peakDbfs: entry.peakDbfs ?? -1.5,
			});
		});
	}
	return assets;
}

/** The full starter catalogue, in ID order. */
export const CATALOG = buildCatalog();

/** Per-(family, role) counts, used by the coverage report and its tests. */
export function catalogCounts() {
	const counts = {};
	for (const asset of CATALOG) {
		const key = `${asset.family}/${asset.role}`;
		counts[key] = (counts[key] ?? 0) + 1;
	}
	return counts;
}
