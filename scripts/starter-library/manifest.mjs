// Builds the delivery manifest described in docs/sample-library.md section 9.
//
// The manifest is the library's identity: the app resolves assets through it,
// never through a filename or a source URL (principle 10, section 12). It is
// deterministic — same catalogue in, byte-identical JSON out — so a rebuild
// that changes nothing produces no diff and no re-upload.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	CATALOG,
	DERIVED_CATALOG,
	LOOP_CATALOG,
	PRESET_CATALOG,
} from "./catalog/index.mjs";
import {
	createRng,
	normalizePeak,
	reverse as reverseBuffer,
	SAMPLE_RATE,
	seedFromString,
} from "./dsp.mjs";
import { partitionByIntake } from "./intake.mjs";
import { analyzeSeam, renderLoop, verifyGrid } from "./loops.mjs";
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
 * Render one catalogue one-shot's samples, memoized.
 *
 * Loops and derived masters are both built *from* one-shots, and several of
 * them reuse the same source, so a render cache keeps a build that produces
 * four asset types from costing four passes over the voice renderers. Keyed by
 * catalogue ID, which is what makes it safe: the render is a pure function of
 * the entry and its ID-derived seed.
 */
function createSourceRenderer(catalog) {
	const byId = new Map(catalog.map((entry) => [entry.id, entry]));
	const cache = new Map();
	return (id) => {
		const cached = cache.get(id);
		if (cached) return cached;
		const entry = byId.get(id);
		if (!entry) throw new Error(`unknown source asset ${id}`);
		const samples = renderVoice(entry, createRng(seedFromString(entry.id)));
		cache.set(id, samples);
		return samples;
	};
}

/**
 * The searchable metadata block every asset type shares, whatever its type.
 *
 * Factored out because `CNT-001`'s first acceptance criterion is that one-shots,
 * loops, presets, and derived files all carry it — a per-type copy would be
 * four places for a tag to go missing.
 */
function commonFields(entry, type, pack) {
	return {
		id: entry.id,
		version: 1,
		pack: packRef(pack),
		name: entry.name,
		type,
		family: entry.family,
		role: entry.role,
		tags: {
			genres: [...entry.genres].sort(),
			characters: [...entry.characters].sort(),
			intensity: entry.intensity,
			sourceTypes: ["synthesized"],
		},
		license: { ...LICENSE },
	};
}

/** The `files.master` block for a set of bytes, and its content-addressed key. */
function masterFile(bytes, format) {
	const hash = sha256(bytes);
	return {
		storageKey: storageKeyFor(hash, format),
		sha256: hash,
		bytes: bytes.length,
		format,
	};
}

/**
 * Build one loop: render the pattern, then *measure* the tempo grid and the
 * seam rather than repeating what the entry claimed (section 10, "Verify BPM by
 * listening and bar-grid alignment; never trust filenames alone").
 */
export function buildLoop(entry, renderSource) {
	const samples = normalizePeak(
		renderLoop(entry, renderSource),
		entry.peakDbfs,
	);
	const bytes = encodeWav(samples);
	const pack = packForFamily(entry.family);

	return {
		bytes,
		asset: {
			...commonFields(entry, "loop", pack),
			files: { master: masterFile(bytes, "wav") },
			audio: {
				...analyze(samples),
				rootNote: entry.rootNote,
				tuningCents: entry.rootNote ? 0 : null,
				bpm: entry.bpm,
				bars: entry.bars,
				timeSignature: entry.timeSignature,
				loopable: true,
				chokeGroup: null,
				chokeRole: null,
				grid: verifyGrid(samples, entry, SAMPLE_RATE),
				seam: analyzeSeam(samples),
			},
			waveform: { buckets: 64, peaks: waveformPeaks(samples, 64) },
			provenance: {
				sourceType: "synthesized",
				recipe: {
					voice: "loop-sequencer",
					params: {
						bpm: entry.bpm,
						bars: entry.bars,
						timeSignature: entry.timeSignature,
						pattern: entry.pattern,
					},
					seed: seedFromString(entry.id),
				},
				generator: GENERATOR,
				originalFilename: null,
				originalSha256: null,
				modifications: [...MODIFICATIONS, "bar-grid-render"],
				reviewState: REVIEW_STATE,
				reviewer: null,
				reviewedAt: null,
			},
		},
	};
}

/**
 * Build one preset. Its master is the deterministic JSON of its definition, so
 * it is content-addressed, deduplicated, cached, and uploaded by exactly the
 * same code paths as a WAV.
 */
export function buildPreset(entry) {
	const pack = packForFamily(entry.family);
	const definition = { kind: entry.kind, ...entry.definition };
	const bytes = Buffer.from(serialize(definition), "utf8");

	return {
		bytes,
		asset: {
			...commonFields(entry, "preset", pack),
			files: { master: masterFile(bytes, "json") },
			// A preset has no audio of its own — every sound it makes belongs to the
			// assets it references — so it carries no audio or waveform block, and
			// the validator checks that it does not pretend to.
			audio: null,
			waveform: null,
			preset: definition,
			provenance: {
				sourceType: "synthesized",
				recipe: { preset: entry.kind, seed: seedFromString(entry.id) },
				generator: GENERATOR,
				originalFilename: null,
				originalSha256: null,
				modifications: [],
				reviewState: REVIEW_STATE,
				reviewer: null,
				reviewedAt: null,
			},
		},
	};
}

const DERIVATION_TRANSFORMS = {
	reverse: (samples) => reverseBuffer(samples),
	"half-speed": (samples) => resample(samples, 2),
	"octave-down": (samples) => resample(samples, 2),
};

/** Whole-number-factor resampling: deterministic, and no filter design needed. */
function resample(samples, factor) {
	const out = new Float32Array(samples.length * factor);
	for (let index = 0; index < out.length; index++) {
		const position = index / factor;
		const low = Math.floor(position);
		const high = Math.min(low + 1, samples.length - 1);
		const fraction = position - low;
		out[index] = samples[low] * (1 - fraction) + samples[high] * fraction;
	}
	return out;
}

/**
 * Build one derived master. Section 10: "Keep a checksum of the untouched
 * source and treat processed masters as derived assets." Both halves are
 * recorded — the source asset ID and its checksum — so the derivation is
 * auditable and reproducible without keeping the intermediate around.
 */
export function buildDerived(entry, renderSource, sourceHashes) {
	const transform = DERIVATION_TRANSFORMS[entry.transform];
	if (!transform) {
		throw new Error(`${entry.id}: unknown transform "${entry.transform}"`);
	}
	const samples = normalizePeak(transform(renderSource(entry.sourceId)), -1.5);
	const bytes = encodeWav(samples);
	const pack = packForFamily(entry.family);

	const common = commonFields(entry, "derived", pack);

	return {
		bytes,
		asset: {
			...common,
			tags: { ...common.tags, sourceTypes: ["synthesized", "processed"] },
			files: { master: masterFile(bytes, "wav") },
			audio: {
				...analyze(samples),
				rootNote: entry.rootNote,
				tuningCents: entry.rootNote ? 0 : null,
				bpm: null,
				bars: null,
				loopable: false,
				chokeGroup: null,
				chokeRole: null,
			},
			waveform: { buckets: 64, peaks: waveformPeaks(samples, 64) },
			derivedFrom: {
				assetId: entry.sourceId,
				transform: entry.transform,
				sourceSha256: sourceHashes.get(entry.sourceId) ?? null,
			},
			provenance: {
				sourceType: "processed",
				recipe: {
					voice: "derivation",
					params: { from: entry.sourceId, transform: entry.transform },
					seed: seedFromString(entry.id),
				},
				generator: GENERATOR,
				originalFilename: null,
				originalSha256: sourceHashes.get(entry.sourceId) ?? null,
				modifications: [entry.transform, "peak-normalize"],
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
export function buildAllPacks(
	catalog = CATALOG,
	{
		acquired,
		loops = LOOP_CATALOG,
		presets = PRESET_CATALOG,
		derived = DERIVED_CATALOG,
	} = {},
) {
	const renderSource = createSourceRenderer(catalog);
	const oneShots = catalog.map(buildAsset);
	// Derived masters record the checksum of the untouched source, so the
	// one-shots have to be hashed before anything is derived from them.
	const sourceHashes = new Map(
		oneShots.map(({ asset }) => [asset.id, asset.files.master.sha256]),
	);

	const produced = [
		...oneShots,
		...loops.map((entry) => buildLoop(entry, renderSource)),
		...presets.map(buildPreset),
		...derived.map((entry) => buildDerived(entry, renderSource, sourceHashes)),
		...(acquired ?? loadAcquiredAssets()),
	];

	// Section 11 state 3: quarantined material is isolated from production
	// manifests. Withheld assets are reported, not delivered, and never fail the
	// build — the rest of the library still ships.
	const { delivered: built, withheld } = partitionByIntake(produced);

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
		withheld,
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
