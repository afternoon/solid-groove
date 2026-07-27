// Builds the delivery manifest described in docs/sample-library.md section 9.
//
// The manifest is the library's identity: the app resolves assets through it,
// never through a filename or a source URL (principle 10, section 12). It is
// deterministic — same catalogue in, byte-identical JSON out — so a rebuild
// that changes nothing produces no diff and no re-upload.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CATALOG } from "./catalog/index.mjs";
import { createRng, seedFromString } from "./dsp.mjs";
import { PACKS, packForFamily, packRef } from "./packs.mjs";
import { renderVoice } from "./voices.mjs";
import {
	analyze,
	encodeWav,
	sha256,
	storageKeyFor,
	waveformPeaks,
} from "./wav.mjs";

export const SCHEMA_VERSION = 1;

/**
 * Pinned rather than read from the clock, because the manifest has to be
 * reproducible: a build on a different day must not produce a different file.
 * Bump it when a pack's own `version` in `packs.mjs` bumps.
 */
export const RELEASED_AT = "2026-07-25";

export const GENERATOR = {
	name: "solid-groove/starter-library",
	version: "1.0.0",
};

/**
 * Licence position for this library.
 *
 * Every asset is synthesized by this repository's own code from first
 * principles — no third-party sample, preset, recording, or model is involved —
 * so it satisfies docs/sample-library.md section 3.2's second route: content
 * Solid Groove created entirely from sources it owns. Raw redistribution is
 * therefore unrestricted, and there is no attribution, share-alike, or export
 * obligation to carry into stems or an Ableton package.
 */
const LICENSE = {
	id: "solid-groove-owned",
	creator: "Solid Groove",
	sourceUrl: null,
	retrievedAt: RELEASED_AT,
	evidencePath: "docs/licenses/starter-library-v1.md",
	rawRedistributionAllowed: true,
	agreementId: null,
};

/**
 * The conditioning every asset goes through in `renderVoice`, recorded so the
 * manifest states what was done to the audio rather than implying it is raw.
 */
const MODIFICATIONS = [
	"dc-offset-removal",
	"tail-trim",
	"peak-normalize",
	"edge-fades",
];

/**
 * Intake state (section 11).
 *
 * Rights review and audio preparation are complete and machine-checkable.
 * Human musical review is not — nothing here has been auditioned in two real
 * project contexts by a person. These assets are therefore delivered as a
 * testing library and are deliberately **not** marked `approved` factory
 * content; `CNT-002` promotes what survives review.
 */
const REVIEW_STATE = "metadata-review";

/** Render one catalogue asset and describe it. Pure given the catalogue. */
export function buildAsset(entry) {
	const rng = createRng(seedFromString(entry.id));
	const samples = renderVoice(entry, rng);
	const bytes = encodeWav(samples);
	const hash = sha256(bytes);

	return {
		bytes,
		asset: {
			id: entry.id,
			version: 1,
			pack: packRef(packForFamily(entry.family)),
			name: entry.name,
			type: "one-shot",
			family: entry.family,
			role: entry.role,
			files: {
				master: {
					storageKey: storageKeyFor(hash),
					sha256: hash,
					bytes: bytes.length,
					format: "wav",
				},
			},
			audio: {
				...analyze(samples),
				// Synthesized at an exact frequency, so the root note is known
				// rather than detected and there is nothing to correct.
				rootNote: entry.rootNote,
				tuningCents: entry.rootNote ? 0 : null,
				// One-shots carry no tempo. Loops (a `CNT-002` concern) populate
				// these; the fields exist so the shape does not change later.
				bpm: null,
				bars: null,
				loopable: false,
				chokeGroup: entry.choke ? `${entry.family}-hat` : null,
				chokeRole: entry.choke,
			},
			waveform: { buckets: 64, peaks: waveformPeaks(samples, 64) },
			tags: {
				genres: [...entry.genres].sort(),
				characters: [...entry.characters].sort(),
				intensity: entry.intensity,
				sourceTypes: ["synthesized"],
			},
			license: { ...LICENSE },
			provenance: {
				sourceType: "synthesized",
				// The recipe *is* the source. Recording it means an asset can be
				// regenerated bit-for-bit without keeping the WAV around.
				recipe: {
					voice: entry.voice,
					params: entry.params,
					seed: seedFromString(entry.id),
				},
				generator: GENERATOR,
				originalFilename: null,
				originalSha256: null,
				modifications: MODIFICATIONS,
				reviewState: REVIEW_STATE,
				reviewer: null,
				reviewedAt: null,
			},
		},
	};
}

/**
 * Where `bun run library:acquire` leaves prepared CC0 masters. Gitignored:
 * third-party audio is fetched and verified, never committed.
 */
export const ACQUIRED_DIR = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
	"public",
	"samples",
	"acquired-library",
);

/**
 * Read one acquired bundle: an `entries.json` and its `audio/` beside it.
 * A bundle is written by an ingest path (the lockfile ingest, or the VCSL bulk
 * ingest) into its own directory so the two never overwrite each other.
 */
function loadAcquiredBundle(dir) {
	const entriesPath = join(dir, "entries.json");
	if (!existsSync(entriesPath)) return [];
	const assets = JSON.parse(readFileSync(entriesPath, "utf8"));
	return assets.map((asset) => {
		const path = join(dir, "audio", asset.files.master.storageKey);
		if (!existsSync(path)) {
			throw new Error(
				`${asset.id} is listed in ${entriesPath} but its audio is missing at ${path}. ` +
					"Re-run `bun run library:acquire`.",
			);
		}
		return { asset, bytes: readFileSync(path) };
	});
}

/**
 * Load everything the acquire pipeline has ingested, across all sources.
 *
 * Acquired content is optional by design: it needs network access and reviewed
 * or trusted-bulk sources, while the synthesized library must always build. With
 * nothing acquired this returns nothing and the library is exactly the generated
 * catalogue — which is why `library:build` never requires a network.
 *
 * Each ingest path writes its own bundle directory (`<source>/entries.json` +
 * `<source>/audio/`), and they are merged here. The legacy flat layout (an
 * `entries.json` directly under the root) is still read, so an older acquired
 * directory keeps working.
 */
export function loadAcquiredAssets(dir = ACQUIRED_DIR) {
	if (!existsSync(dir)) return [];
	const merged = [...loadAcquiredBundle(dir)]; // legacy flat layout
	for (const name of readdirSync(dir)) {
		const child = join(dir, name);
		if (existsSync(join(child, "entries.json"))) {
			merged.push(...loadAcquiredBundle(child));
		}
	}
	return merged;
}

/**
 * Render the whole catalogue, merge anything acquired, and split the result
 * into one manifest per pack (docs/sample-library.md section 15.8) — every
 * asset already carries the `pack` it belongs to, from `buildAsset` or from
 * the ingest path that produced it, so this is a group-by, not a decision.
 *
 * A pack with zero assets — the reserved acquired-content pack today — is
 * simply absent from `packManifests`: the thinnest possible pack is one
 * nobody has put anything in yet, and section 5.1 says a pack that would ship
 * thin is not published.
 *
 * `files` is deduplicated by storage key across every pack: identity is the
 * SHA-256 of the bytes (section 15.4), so identical audio reachable from two
 * packs is one object and a repack re-uploads no audio.
 */
export function buildAllPacks(catalog = CATALOG, { acquired } = {}) {
	const built = [
		...catalog.map(buildAsset),
		...(acquired ?? loadAcquiredAssets()),
	];

	const files = new Map();
	for (const { asset, bytes } of built) {
		files.set(asset.files.master.storageKey, bytes);
	}

	const byPackId = new Map();
	for (const { asset } of built) {
		const group = byPackId.get(asset.pack.id) ?? [];
		group.push(asset);
		byPackId.set(asset.pack.id, group);
	}

	const packManifests = PACKS.filter((pack) => byPackId.has(pack.id)).map(
		(pack) => {
			const assets = byPackId.get(pack.id);
			return {
				schemaVersion: SCHEMA_VERSION,
				pack: {
					id: pack.id,
					slug: pack.slug,
					name: pack.name,
					version: pack.version,
					publisher: pack.publisher,
					kind: pack.kind,
					description: pack.description,
					coverage: pack.coverage,
					rights: pack.rights,
					releasedAt: RELEASED_AT,
					assetCount: assets.length,
				},
				assets,
			};
		},
	);

	return {
		files: [...files].map(([storageKey, bytes]) => ({ storageKey, bytes })),
		packManifests,
	};
}

/** Delivery path for one pack manifest version. Immutable once published. */
export function packManifestStorageKey(slug, version) {
	return `packs/${slug}/v${version}.json`;
}

/** Mutable pointer at a pack's current manifest version. */
export function packPointerKey(slug) {
	return `packs/${slug}/latest.json`;
}

/** Mutable pointer list of every published pack (section 15.8 delivery layout). */
export const PACK_INDEX_KEY = "packs/index.json";

/**
 * The compact index a client fetches before any pack manifest — section 12:
 * "A client fetches a small index of available packs, then the manifest of a
 * pack it opens or a project needs."
 */
export function buildPackIndex(packManifests) {
	return {
		schemaVersion: SCHEMA_VERSION,
		generatedAt: RELEASED_AT,
		packs: packManifests.map(({ pack }) => ({
			id: pack.id,
			slug: pack.slug,
			name: pack.name,
			version: pack.version,
			publisher: pack.publisher,
			kind: pack.kind,
			description: pack.description,
			assetCount: pack.assetCount,
			manifestPath: packManifestStorageKey(pack.slug, pack.version),
		})),
	};
}

/**
 * Deterministic JSON: object keys sorted, no incidental whitespace. Two
 * identical catalogues must produce identical bytes or every rebuild looks like
 * a change.
 */
export function serialize(value) {
	return JSON.stringify(sortKeys(value));
}

function sortKeys(value) {
	if (Array.isArray(value)) return value.map(sortKeys);
	if (value === null || typeof value !== "object") return value;
	const sorted = {};
	for (const key of Object.keys(value).sort())
		sorted[key] = sortKeys(value[key]);
	return sorted;
}
