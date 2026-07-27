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
 * Deterministic `pak_`-prefixed id generator (PRD section 9.4's shape,
 * matching the `Pack` entity `FND-002b` adds to the domain schema). Seeded
 * from a slug with the same mulberry32-driven generator `src/domain/ids.ts`
 * uses for its seeded test factory, reimplemented here because this pipeline
 * runs under plain `node`, not the TypeScript domain layer.
 *
 * This is a one-shot authoring tool, not a runtime derivation: `docs/sample-
 * library.md` section 5.1/9's controlled vocabulary is explicit that a pack
 * id is "stable, opaque, and permanent" and "never derived from the name" —
 * a slug is a URL-friendly convenience, never identity, so renaming a pack
 * must never change its id. `PACKS` below therefore pins each pack's id as a
 * literal string, generated once with this function and pasted in; nothing
 * calls `packId` at load time. Keep it for the next new pack that needs a
 * fresh id, and for the "differs across slugs" / "matches the id shape"
 * properties `packs.test.mjs` still exercises directly.
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

/**
 * The pack rights position every synthesized pack shares — `FND-002b`'s
 * `packRightsSchema` shape (`src/domain/entities.ts`): `licence`,
 * `rawRedistribution`, `attributionRequired`. Distinct from an individual
 * asset's own `license` block in `manifest.mjs`, which records per-file
 * provenance (creator, source URL, retrieval date) and is not part of the
 * domain `Pack` entity.
 */
const SOLID_GROOVE_OWNED = {
	licence: "solid-groove-owned",
	rawRedistribution: true,
	attributionRequired: false,
};

/** The rights position every acquired-content pack shares. */
const CC0 = {
	licence: "CC0-1.0",
	rawRedistribution: true,
	attributionRequired: false,
};

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
 * content. `id` is frozen: a `pak_`-prefixed literal, generated once with
 * `packId(slug)` and pasted in, never recomputed at load time — the section
 * 5.1/9 controlled vocabulary requires a pack's id to be permanent and never
 * derived from its (renameable) name or slug (`packs.test.mjs` pins each one).
 * `version` is a `major.minor.patch` string (`FND-002b`'s `packVersionSchema`)
 * bumped by hand whenever a pack's asset set changes — same convention
 * `manifest.mjs`'s old `LIBRARY_VERSION` used — and the bump is what changes a
 * pack's delivery path (`packs/<slug>/v<major.minor.patch>.json`), which is
 * how a client can cache a version forever and a repack still becomes visible.
 */
export const PACKS = [
	{
		id: "pak_SdlN_OazweXrwury0j27Y",
		slug: "core-electronic-drums",
		family: "drums",
		name: "Core Electronic Drums",
		version: "1.0.0",
		publisher: "Solid Groove",
		kind: "factory",
		description:
			"The role-complete, lightly processed drum foundation the other synthesized packs build on: kicks, snares, claps, rims, closed and open hats, cymbals, toms, and percussion across every featured genre. Contains no bass, tonal, texture, or FX material.",
		rights: SOLID_GROOVE_OWNED,
		coverage: coverage("drums", [...GENRES].sort(), ALL_INTENSITIES),
	},
	{
		id: "pak_FH8gyASzYiWGCrtpKZ-Ho",
		slug: "foundation-bass",
		family: "bass",
		name: "Foundation Bass",
		version: "1.0.0",
		publisher: "Solid Groove",
		kind: "factory",
		description:
			"Sub, sustained, reese, and stab bass one-shots for dubstep, drum & bass, techno, and beyond. Contains no drums, tonal, texture, or FX material.",
		rights: SOLID_GROOVE_OWNED,
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
		id: "pak_RznkYK7KIIo7BOZQZ_i0O",
		slug: "tonal-elements",
		family: "tonal",
		name: "Tonal Elements",
		version: "1.0.0",
		publisher: "Solid Groove",
		kind: "factory",
		description:
			"Chords, stabs, plucks, keys, mallets, and bells for melodic and harmonic material. Contains no drums, bass, texture, or FX material.",
		rights: SOLID_GROOVE_OWNED,
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
		id: "pak_gUou3hBgXF47EwgR-9gZ1",
		slug: "ambient-textures",
		family: "texture",
		name: "Ambient Textures",
		version: "1.0.0",
		publisher: "Solid Groove",
		kind: "factory",
		description:
			"Noise, ambience, drones, mechanical, and organic textures for atmosphere and sound design. Contains no drums, bass, tonal, or FX material.",
		rights: SOLID_GROOVE_OWNED,
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
		id: "pak_PrUvdIGkCE3uRGYeKOGRg",
		slug: "transitions-fx",
		family: "fx",
		name: "Transitions & FX",
		version: "1.0.0",
		publisher: "Solid Groove",
		kind: "factory",
		description:
			"Impacts, risers, downers, sweeps, reverses, and glitches for transitions and drops. Contains no drums, bass, tonal, or texture material.",
		rights: SOLID_GROOVE_OWNED,
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
		id: "pak_5o6qI8YY27cYVyqstlJyG",
		slug: "cc0-community",
		family: null,
		name: "CC0 Community Content",
		version: "1.0.0",
		publisher: "Solid Groove",
		kind: "factory",
		description:
			"Reserved destination for acquired CC0 content (`library:acquire`, `library:vcsl`). Not yet published — nothing is pinned in sources.lock.json. Splits into focused packs once enough reviewed content exists to meet a coverage claim on its own (docs/sample-library.md section 15.8).",
		rights: CC0,
		coverage: null,
	},
];

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
	return PACKS.filter((pack) => pack.rights.licence === "CC0-1.0");
}

/** `{ id, version }` — the pack-qualified reference an asset record carries. */
export function packRef(pack) {
	return { id: pack.id, version: pack.version };
}
