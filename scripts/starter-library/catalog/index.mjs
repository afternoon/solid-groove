// Assembles the 200-entry starter catalogue and assigns its stable asset IDs.
//
// The catalogue is data. It says what the library contains and how each asset
// is tagged; `voices.mjs` says what it sounds like; `manifest.mjs` says how it
// is described to the app. Nothing here touches the filesystem or the network.

import { isKnownLoopRole, isKnownRole, PRESET_KINDS } from "../taxonomy.mjs";
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
import {
	ATMOSPHERE_LOOPS,
	BASSLINE_LOOPS,
	CHORD_LOOPS,
	DRUM_FULL_LOOPS,
	DRUM_TOP_LOOPS,
	MELODIC_LOOPS,
	PERCUSSION_LOOPS,
} from "./loops.mjs";
import { DERIVED, DEVICE_CHAINS, DRUM_KITS, INSTRUMENTS } from "./presets.mjs";
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

/**
 * Loop groups, in ID-assignment order. Append-only, exactly like `GROUPS`.
 */
const LOOP_GROUPS = [
	{ family: "drums", role: "full-loop", entries: DRUM_FULL_LOOPS },
	{ family: "drums", role: "top-loop", entries: DRUM_TOP_LOOPS },
	{ family: "drums", role: "percussion-loop", entries: PERCUSSION_LOOPS },
	{ family: "bass", role: "bassline", entries: BASSLINE_LOOPS },
	{ family: "tonal", role: "chord-loop", entries: CHORD_LOOPS },
	{ family: "tonal", role: "melodic-loop", entries: MELODIC_LOOPS },
	{ family: "texture", role: "atmosphere-loop", entries: ATMOSPHERE_LOOPS },
];

/** Preset groups, in ID-assignment order. Append-only. */
const PRESET_GROUPS = [
	{ kind: "drum-kit", entries: DRUM_KITS },
	{ kind: "instrument", entries: INSTRUMENTS },
	{ kind: "device-chain", entries: DEVICE_CHAINS },
];

/**
 * Stable prefixed IDs for the non-one-shot types.
 *
 * Same `sg-<type>-<family>-<role>-NNNN` shape as the one-shots, with the type
 * in the ID, so the four ranges can never collide however each one grows and a
 * saved project reference states what it is pointing at.
 */
function typedId(type, family, role, index) {
	return `sg-${type}-${family}-${role}-${String(index + 1).padStart(4, "0")}`;
}

function buildLoopCatalog() {
	const loops = [];
	for (const group of LOOP_GROUPS) {
		if (!isKnownLoopRole(group.family, group.role)) {
			throw new Error(
				`loop group uses an unknown role: ${group.family}/${group.role}`,
			);
		}
		group.entries.forEach((entry, index) => {
			loops.push({
				...entry,
				id: typedId("loop", group.family, group.role, index),
				family: group.family,
				role: group.role,
				rootNote: entry.rootNote ?? null,
				peakDbfs: entry.peakDbfs ?? -1.5,
			});
		});
	}
	return loops;
}

function buildPresetCatalog() {
	const presets = [];
	for (const group of PRESET_GROUPS) {
		if (!PRESET_KINDS.includes(group.kind)) {
			throw new Error(`preset group uses an unknown kind: ${group.kind}`);
		}
		// Numbering is per (family, kind), so adding a tonal instrument never
		// renumbers a drum kit.
		const counts = {};
		group.entries.forEach((entry) => {
			const key = `${entry.family}/${group.kind}`;
			const index = counts[key] ?? 0;
			counts[key] = index + 1;
			presets.push({
				...entry,
				id: typedId("preset", entry.family, group.kind, index),
				// A preset's "role" in the manifest is its kind: that is what a user
				// filters by, and it keeps one role field across every asset type.
				role: group.kind,
			});
		});
	}
	return presets;
}

function buildDerivedCatalog() {
	const byId = new Map(CATALOG.map((entry) => [entry.id, entry]));
	const counts = {};
	return DERIVED.map((entry) => {
		const source = byId.get(entry.sourceId);
		if (!source) {
			throw new Error(
				`derived entry "${entry.name}" names unknown source ${entry.sourceId}`,
			);
		}
		const key = `${source.family}/${source.role}`;
		const index = counts[key] ?? 0;
		counts[key] = index + 1;
		return {
			...entry,
			id: typedId("derived", source.family, source.role, index),
			family: source.family,
			role: source.role,
			rootNote: entry.transform === "reverse" ? source.rootNote : null,
		};
	});
}

/** The loop catalogue, in ID order. */
export const LOOP_CATALOG = buildLoopCatalog();

/** The preset catalogue, in ID order. */
export const PRESET_CATALOG = buildPresetCatalog();

/** The derived-master catalogue, in ID order. */
export const DERIVED_CATALOG = buildDerivedCatalog();

/** Per-(family, role) counts, used by the coverage report and its tests. */
export function catalogCounts() {
	const counts = {};
	for (const asset of CATALOG) {
		const key = `${asset.family}/${asset.role}`;
		counts[key] = (counts[key] ?? 0) + 1;
	}
	return counts;
}
