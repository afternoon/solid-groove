// The pack registry (docs/sample-library.md section 5.1, 15.8).
//
// `CNT-000` shipped the starter library as one flat manifest. `CNT-000b` moves
// it onto packs: every asset belongs to exactly one pack, and a pack is a
// named, versioned, self-contained collection with its own rights position and
// coverage claim. This file is the one place that decision is made — the
// catalogue and the acquisition pipeline both read it rather than each
// deciding pack membership their own way.
//
// The synthesized 200 split along the lines they already carry: their family
// (docs/sample-library.md section 15.2) and the genre tags each family
// actually has usable material in. Splitting any finer would ship a pack that
// cannot build a basic idea in its own genre on its own; splitting any
// coarser would erase the one distinction a producer actually chooses by
// (drums vs. bass vs. tonal vs. texture vs. FX). Five packs is the small
// number section 5.1 and the CNT-000b backlog block call for.
//
// A sixth, reserved pack exists for acquired CC0 content
// (`library:acquire`, `library:vcsl`). Nothing is pinned yet (`sources.lock.json`
// is empty), so it carries no coverage claim and `buildAllPacks` never emits a
// manifest for it — an empty pack is the thinnest possible pack, and section
// 5.1's rule is that a pack that would ship thin is merged or not published,
// not shipped anyway. It exists in the registry so the lockfile and the
// curator tool have a real destination to record now, before there is
// anything to split further.

import { customRandom, urlAlphabet } from "nanoid";
import { GENRES, TAXONOMY } from "./taxonomy.mjs";

const ID_SUFFIX_LENGTH = 21;

/**
 * Deterministic `pak_`-prefixed id (PRD section 9.4's shape, matching the
 * `Pack` entity `FND-002b` adds to the domain schema). Seeded from the pack's
 * slug with the same mulberry32-driven generator `src/domain/ids.ts` uses for
 * its seeded test factory, reimplemented here because this pipeline runs under
 * plain `node`, not the TypeScript domain layer. A pack's id is therefore
 * stable across every machine and every run — required for "identical
 * manifests ... across runs and machines" (section 5, CNT-000b) — without
 * being hand-typed nanoid noise that nobody could review.
 */
export function packId(slug) {
	const random = seededBytes(hashSeed(`pack:${slug}`));
	const generate = customRandom(urlAlphabet, ID_SUFFIX_LENGTH, random);
	return `pak_${generate()}`;
}

function hashSeed(seed) {
	let hash = 0x811c9dc5;
	for (let index = 0; index < seed.length; index += 1) {
		hash ^= seed.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash === 0 ? 0x9e3779b9 : hash;
}

function seededBytes(seed) {
	let state = seed >>> 0;
	return (byteCount) => {
		const bytes = new Uint8Array(byteCount);
		for (let index = 0; index < byteCount; index += 1) {
			state = (state + 0x6d2b79f5) >>> 0;
			let next = state;
			next = Math.imul(next ^ (next >>> 15), next | 1);
			next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
			bytes[index] = ((next ^ (next >>> 14)) >>> 0) & 0xff;
		}
		return bytes;
	};
}

/** The rights position every synthesized pack shares (manifest.mjs's asset license). */
const SOLID_GROOVE_OWNED = {
	id: "solid-groove-owned",
	rawRedistributionAllowed: true,
};

/** The rights position every acquired-content pack shares. */
const CC0 = { id: "CC0-1.0", rawRedistributionAllowed: true };

/**
 * `docs/sample-library.md` section 9's `coverage` block: what a pack claims to
 * serve, checked by `validate.mjs`'s `validatePackManifest` against what its
 * assets actually deliver. One-shots carry no tempo (section 15.2), so
 * `bpmRange` is `null` for every pack here; a future loop-carrying pack would
 * set it. `intensity` is the set of intensities the family's catalogue entries
 * actually use — `tonal` has none rated `extreme`, so it is not claimed.
 */
function coverage(family, genres, intensity) {
	return { roles: [...TAXONOMY[family]], genres, bpmRange: null, intensity };
}

const ALL_INTENSITIES = ["low", "medium", "high", "extreme"];

/**
 * The five synthesized family packs, plus one reserved pack for acquired
 * content. `version` is bumped by hand whenever a pack's asset set changes —
 * same convention `manifest.mjs`'s old `LIBRARY_VERSION` used — and the bump is
 * what changes a pack's delivery path (`packs/<slug>/v<n>.json`), which is how
 * a client can cache a version forever and a repack still becomes visible.
 */
export const PACKS = [
	{
		slug: "core-electronic-drums",
		family: "drums",
		name: "Core Electronic Drums",
		version: 1,
		publisher: "Solid Groove",
		kind: "factory",
		description:
			"The role-complete, lightly processed drum foundation the other synthesized packs build on: kicks, snares, claps, rims, closed and open hats, cymbals, toms, and percussion across every featured genre. Contains no bass, tonal, texture, or FX material.",
		license: SOLID_GROOVE_OWNED,
		coverage: coverage("drums", [...GENRES].sort(), ALL_INTENSITIES),
	},
	{
		slug: "foundation-bass",
		family: "bass",
		name: "Foundation Bass",
		version: 1,
		publisher: "Solid Groove",
		kind: "factory",
		description:
			"Sub, sustained, reese, and stab bass one-shots for dubstep, drum & bass, techno, and beyond. Contains no drums, tonal, texture, or FX material.",
		license: SOLID_GROOVE_OWNED,
		coverage: coverage(
			"bass",
			[
				"ambient",
				"drum-and-bass",
				"dubstep",
				"electronic-pop",
				"hip-hop",
				"house",
				"lofi",
				"techno",
				"trap",
				"uk-garage",
			],
			ALL_INTENSITIES,
		),
	},
	{
		slug: "tonal-elements",
		family: "tonal",
		name: "Tonal Elements",
		version: 1,
		publisher: "Solid Groove",
		kind: "factory",
		description:
			"Chords, stabs, plucks, keys, mallets, and bells for melodic and harmonic material. Contains no drums, bass, texture, or FX material.",
		license: SOLID_GROOVE_OWNED,
		coverage: coverage(
			"tonal",
			[
				"ambient",
				"drum-and-bass",
				"dubstep",
				"electronic-pop",
				"house",
				"lofi",
				"techno",
				"trance",
				"trap",
				"uk-garage",
			],
			["low", "medium", "high"],
		),
	},
	{
		slug: "ambient-textures",
		family: "texture",
		name: "Ambient Textures",
		version: 1,
		publisher: "Solid Groove",
		kind: "factory",
		description:
			"Noise, ambience, drones, mechanical, and organic textures for atmosphere and sound design. Contains no drums, bass, tonal, or FX material.",
		license: SOLID_GROOVE_OWNED,
		coverage: coverage(
			"texture",
			[
				"ambient",
				"drum-and-bass",
				"dubstep",
				"electronic-pop",
				"lofi",
				"techno",
			],
			ALL_INTENSITIES,
		),
	},
	{
		slug: "transitions-fx",
		family: "fx",
		name: "Transitions & FX",
		version: 1,
		publisher: "Solid Groove",
		kind: "factory",
		description:
			"Impacts, risers, downers, sweeps, reverses, and glitches for transitions and drops. Contains no drums, bass, tonal, or texture material.",
		license: SOLID_GROOVE_OWNED,
		coverage: coverage(
			"fx",
			[
				"ambient",
				"breakbeat",
				"drum-and-bass",
				"dubstep",
				"electronic-pop",
				"house",
				"techno",
				"trance",
				"trap",
			],
			ALL_INTENSITIES,
		),
	},
	{
		slug: "cc0-community",
		family: null,
		name: "CC0 Community Content",
		version: 1,
		publisher: "Solid Groove",
		kind: "factory",
		description:
			"Reserved destination for acquired CC0 content (`library:acquire`, `library:vcsl`). Not yet published — nothing is pinned in sources.lock.json. Splits into focused packs once enough reviewed content exists to meet a coverage claim on its own (docs/sample-library.md section 15.8).",
		license: CC0,
		coverage: null,
	},
].map((pack) => ({ ...pack, id: packId(pack.slug) }));

/** The one reserved pack acquisition currently targets. */
export const RESERVED_CC0_PACK_SLUG = "cc0-community";

export function packBySlug(slug) {
	return PACKS.find((pack) => pack.slug === slug) ?? null;
}

export function packById(id) {
	return PACKS.find((pack) => pack.id === id) ?? null;
}

/** The one pack a synthesized catalogue entry belongs to, by its family. */
export function packForFamily(family) {
	const pack = PACKS.find((candidate) => candidate.family === family);
	if (!pack) {
		throw new Error(`no pack claims the "${family}" family`);
	}
	return pack;
}

/** Packs an acquired selection may target: whichever share the CC0 rights position. */
export function acquirablePacks() {
	return PACKS.filter((pack) => pack.license.id === "CC0-1.0");
}

/** `{ id, version }` — the pack-qualified reference an asset record carries. */
export function packRef(pack) {
	return { id: pack.id, version: pack.version };
}
