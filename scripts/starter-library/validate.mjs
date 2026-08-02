// Manifest validation.
//
// docs/sample-library.md section 9: "Manifest validation fails CI when an asset
// is missing its checksum, rights evidence, creator/source, required audio
// metadata, or raw-redistribution approval." Section 5.1 and 9 add the pack
// rules `CNT-000b` introduces: exactly one pack per asset, no asset licence
// exceeding its pack's rights position, no undefined pack referenced, and every
// pack delivering the roles and genres its coverage claim advertises. Section
// 6.4 adds collection-level balance rules (measured across the whole library,
// not per pack — section 6.5), and section 12 adds payload budgets for a pack
// manifest and for the pack index. All of it is checked here so the same rules
// run in the build, in the unit suite, and in CI.

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { licenseRejectionReason } from "./acquire/sources.mjs";
import { isDeliverable, isKnownIntakeState } from "./intake.mjs";
import { SEAM_CYCLES } from "./loops.mjs";
import { noteToMidi } from "./music.mjs";
import { packBySlug } from "./packs.mjs";
import {
	ASSET_TYPES,
	CHARACTERS,
	DERIVATIONS,
	DRY_CHARACTERS,
	EXPERIMENTAL_CHARACTERS,
	GENRES,
	INTENSITIES,
	isKnownRoleForType,
	PRESET_KINDS,
	SOURCE_TYPES,
	TAXONOMY,
	TIME_SIGNATURES,
} from "./taxonomy.mjs";
import { storageKeyFor } from "./wav.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Section 12: "any single pack manifest below 1 MiB compressed". */
export const MAX_MANIFEST_GZIP_BYTES = 1024 * 1024;

/** Section 12: "Pack index below 32 KiB compressed". */
export const MAX_PACK_INDEX_GZIP_BYTES = 32 * 1024;

/** Section 6.4 collection-level floors and ceilings. */
export const BALANCE = {
	minExperimentalShare: 0.15,
	minDryShare: 0.3,
	maxSingleRoleShare: 0.2,
	minAssetsPerGenre: 10,
	minRecordedShare: 0.2,
};

/**
 * Product names that must not appear in a user-facing asset name.
 *
 * Section 3.5: cleared content uses descriptive names rather than third-party
 * product branding, and an existing filename is not evidence of anything. This
 * list is deliberately blunt — a false positive is renamed in seconds.
 */
const BRAND_TOKENS = [
	"808",
	"909",
	"707",
	"606",
	"303",
	"ableton",
	"roland",
	"korg",
	"moog",
	"juno",
	"linndrum",
	"splice",
	"serum",
	"massive",
	"amen",
];

const HEX_64 = /^[0-9a-f]{64}$/;
/**
 * `sg-<type>-<family>-<role>-NNNN`. The type is part of the ID so the four
 * ranges `CNT-001` introduces cannot collide however each grows, and so a
 * stored project reference states what kind of thing it points at.
 */
const ASSET_ID = new RegExp(
	`^sg-(${ASSET_TYPES.join("|")})-[a-z]+-[a-z-]+-\\d{4}$`,
);
const PACK_ID = /^pak_[A-Za-z0-9_-]{21}$/;

/** Section 10: a loop's boundaries must land on integer sample positions. */
export const MAX_LOOP_GRID_ERROR_SAMPLES = 0;
/** `FND-002b`'s `packVersionSchema`: a branded `major.minor.patch` string. */
const PACK_VERSION = /^\d+\.\d+\.\d+$/;

/**
 * Validate one pack's manifest: its header, every asset in it (the section 9
 * per-asset rules plus the section 5.1/9 pack rules), and its section 12
 * payload budget.
 *
 * @returns {{ errors: string[], warnings: string[], stats: object }}
 */
export function validatePackManifest(
	packManifest,
	{ serialized, pathExists = repoPathExists } = {},
) {
	const errors = [];
	const warnings = [];

	if (packManifest?.schemaVersion !== 1)
		errors.push("manifest.schemaVersion must be 1");

	const pack = packManifest?.pack;
	validatePackHeader(pack, errors);

	const assets = Array.isArray(packManifest?.assets) ? packManifest.assets : [];
	if (assets.length === 0) {
		return {
			errors: [...errors, "pack.assets is empty"],
			warnings,
			stats: emptyStats(),
		};
	}
	if (pack?.assetCount !== assets.length) {
		errors.push(
			`pack.assetCount (${pack?.assetCount}) does not match assets.length (${assets.length})`,
		);
	}

	const seenIds = new Set();
	const seenNames = new Set();
	const seenHashes = new Map();
	for (const asset of assets) {
		validateAsset(asset, {
			errors,
			seenIds,
			seenNames,
			seenHashes,
			pack,
			pathExists,
		});
	}

	if (pack?.coverage) checkPackCoverage(pack, assets, errors);

	const stats = computeStats(assets);

	if (serialized !== undefined) {
		const compressed = gzipSync(Buffer.from(serialized)).length;
		stats.manifestGzipBytes = compressed;
		if (compressed > MAX_MANIFEST_GZIP_BYTES) {
			errors.push(
				`pack manifest is ${compressed} bytes gzipped, over the ${MAX_MANIFEST_GZIP_BYTES}-byte budget`,
			);
		}
	}

	return { errors, warnings, stats };
}

/**
 * The pack header itself has to name a pack this build actually registered
 * (`packs.mjs`) — "no undefined pack referenced" applies to the manifest's own
 * header, not only to the assets inside it, so a manifest cannot claim to be a
 * pack that was never declared.
 */
function validatePackHeader(pack, errors) {
	if (!pack) {
		errors.push("manifest.pack is required");
		return;
	}
	if (!pack.slug) errors.push("pack.slug is required");
	const registered = pack.slug ? packBySlug(pack.slug) : null;
	if (pack.slug && !registered) {
		errors.push(`pack "${pack.slug}" is not a registered pack (packs.mjs)`);
	} else if (registered && pack.id !== registered.id) {
		errors.push(`pack.id does not match the registered id for "${pack.slug}"`);
	}
	if (!pack.id || !PACK_ID.test(pack.id)) errors.push("pack.id is malformed");
	if (!pack.name) errors.push("pack.name is required");
	if (typeof pack.version !== "string" || !PACK_VERSION.test(pack.version)) {
		errors.push("pack.version must be a major.minor.patch string");
	}
	if (!["factory", "user", "third-party"].includes(pack.kind)) {
		errors.push(
			`pack.kind must be factory, user, or third-party, not "${pack.kind}"`,
		);
	}
	if (!pack.publisher) errors.push("pack.publisher is required");
	if (!pack.description) errors.push("pack.description is required");

	const rights = pack.rights;
	if (!rights?.licence) {
		errors.push("pack.rights.licence is required");
	} else {
		const rejection = licenseRejectionReason(rights.licence);
		if (rejection) errors.push(`pack rights: ${rejection}`);
	}
	if (rights && rights.rawRedistribution !== true) {
		errors.push("pack rights: raw redistribution is not approved");
	}
	if (rights && typeof rights.attributionRequired !== "boolean") {
		errors.push("pack.rights.attributionRequired must be a boolean");
	}

	if (pack.coverage) {
		if (!pack.coverage.roles?.length)
			errors.push("pack.coverage.roles must name at least one role");
		if (!pack.coverage.genres?.length)
			errors.push("pack.coverage.genres must name at least one genre");
		for (const genre of pack.coverage.genres ?? []) {
			if (!GENRES.includes(genre))
				errors.push(`pack.coverage.genres names unknown genre "${genre}"`);
		}
	}
}

/**
 * Section 5.1: "every role it claims in its coverage claim must be genuinely
 * present" and the CNT-000b rule that a pack must deliver the roles and
 * genres its coverage claim advertises. One direction only — a pack is free to
 * contain less-common tags it does not claim; it must not claim ones it lacks.
 */
function checkPackCoverage(pack, assets, errors) {
	for (const role of pack.coverage.roles) {
		if (!assets.some((asset) => asset.role === role)) {
			errors.push(
				`pack "${pack.slug}" claims role "${role}" but no asset in it delivers that role`,
			);
		}
	}
	for (const genre of pack.coverage.genres) {
		if (!assets.some((asset) => asset.tags?.genres?.includes(genre))) {
			errors.push(
				`pack "${pack.slug}" claims genre "${genre}" but no asset in it is tagged with it`,
			);
		}
	}
}

/**
 * Does a committed rights-evidence path exist? Repo-relative, because that is
 * what an evidence path is: a file a reviewer can open from a checkout.
 * Injectable so the validator's own tests do not need one on disk.
 */
export function repoPathExists(candidate) {
	return existsSync(resolve(REPO_ROOT, candidate));
}

function validateAsset(
	asset,
	{ errors, seenIds, seenNames, seenHashes, pack, pathExists = repoPathExists },
) {
	const where = asset?.id ?? "<asset with no id>";

	if (!asset?.id || !ASSET_ID.test(asset.id))
		errors.push(`${where}: malformed asset id`);
	if (seenIds.has(asset?.id)) errors.push(`${where}: duplicate asset id`);
	seenIds.add(asset?.id);

	// --- pack qualification (section 5.1, 9) ---------------------------------
	if (!asset?.pack?.id) {
		errors.push(`${where}: pack is required (exactly one pack per asset)`);
	} else if (pack) {
		if (asset.pack.id !== pack.id) {
			errors.push(
				`${where}: pack.id ${asset.pack.id} does not match the manifest it appears in (${pack.id})`,
			);
		}
		if (asset.pack.version !== pack.version) {
			errors.push(
				`${where}: pack.version ${asset.pack.version} does not match the manifest's pack version (${pack.version})`,
			);
		}
		if (
			asset.license &&
			pack.rights &&
			asset.license.id !== pack.rights.licence
		) {
			errors.push(
				`${where}: license "${asset.license.id}" exceeds pack "${pack.slug}"'s rights position ("${pack.rights.licence}")`,
			);
		}
	}

	if (!asset?.name) {
		errors.push(`${where}: name is required`);
	} else {
		if (seenNames.has(asset.name))
			errors.push(`${where}: duplicate name "${asset.name}"`);
		seenNames.add(asset.name);
		const lowered = asset.name.toLowerCase();
		const brand = BRAND_TOKENS.find((token) => lowered.includes(token));
		if (brand)
			errors.push(`${where}: name contains third-party branding "${brand}"`);
	}

	if (!ASSET_TYPES.includes(asset?.type)) {
		errors.push(`${where}: unexpected type ${asset?.type}`);
	} else if (!isKnownRoleForType(asset.type, asset.family, asset.role)) {
		errors.push(
			`${where}: unknown ${asset.type} family/role ${asset.family}/${asset.role}`,
		);
	}
	// The ID states the type, so the two must agree — otherwise a loop numbered
	// into the one-shot range is invisible to every type-aware check below.
	if (
		ASSET_ID.test(asset?.id ?? "") &&
		!asset.id.startsWith(`sg-${asset.type}-`)
	) {
		errors.push(`${where}: id does not match type "${asset.type}"`);
	}

	// --- files and checksums -------------------------------------------------
	const master = asset?.files?.master;
	// Only a preset is delivered as JSON; everything else is a WAV master.
	const expectedFormat = asset?.type === "preset" ? "json" : "wav";
	if (!master) {
		errors.push(`${where}: files.master is required`);
	} else {
		if (!HEX_64.test(master.sha256 ?? ""))
			errors.push(`${where}: files.master.sha256 is not a SHA-256`);
		if (!(master.bytes > 0))
			errors.push(`${where}: files.master.bytes must be positive`);
		if (master.format !== expectedFormat) {
			errors.push(
				`${where}: unexpected format ${master.format} for a ${asset?.type}`,
			);
		}
		if (
			HEX_64.test(master.sha256 ?? "") &&
			master.storageKey !== storageKeyFor(master.sha256, master.format)
		) {
			// Identity is the content hash. A key that does not derive from it
			// would let two different sounds share a delivery path.
			errors.push(`${where}: storageKey does not derive from sha256`);
		}
		const previous = seenHashes.get(master.sha256);
		if (previous) errors.push(`${where}: byte-identical to ${previous}`);
		seenHashes.set(master.sha256, asset?.id);
	}

	// --- audio metadata ------------------------------------------------------
	const audio = asset?.audio;
	if (asset?.type === "preset") {
		// A preset references audio, it never contains any. Claiming an audio or
		// waveform block would make it look playable to the browser and the
		// audio graph.
		if (audio) errors.push(`${where}: a preset must not carry audio metadata`);
		if (asset.waveform)
			errors.push(`${where}: a preset must not carry a waveform`);
		validatePreset(asset, where, errors);
	} else if (!audio) {
		errors.push(`${where}: audio metadata is required`);
	} else {
		if (audio.sampleRate !== 48000)
			errors.push(`${where}: sampleRate must be 48000`);
		if (audio.bitDepth !== 24) errors.push(`${where}: bitDepth must be 24`);
		// Mono or stereo. Section 10 allows stereo "only when spatial information
		// is musically meaningful", which the ingest path enforces by collapsing
		// dual-mono; anything wider is not something the alpha's audio graph or
		// payload budget is built for.
		if (![1, 2].includes(audio.channels)) {
			errors.push(`${where}: channels must be 1 or 2, not ${audio.channels}`);
		}
		if (!(audio.durationSeconds > 0))
			errors.push(`${where}: durationSeconds must be positive`);
		if (!Number.isFinite(audio.peakDbfs)) {
			errors.push(`${where}: peakDbfs must be finite (asset is silent)`);
		} else if (audio.peakDbfs > -0.1) {
			errors.push(`${where}: peakDbfs ${audio.peakDbfs} leaves no headroom`);
		}
		if (audio.rootNote !== null && typeof audio.tuningCents !== "number") {
			errors.push(`${where}: tonal asset is missing tuningCents`);
		}
		if (audio.loopable && (!(audio.bpm > 0) || !(audio.bars > 0))) {
			errors.push(`${where}: loopable asset is missing bpm/bars`);
		}
		if (asset.type === "loop") validateLoopAudio(audio, where, errors);
	}

	if (asset?.type === "derived") validateDerived(asset, where, errors);

	if (asset?.type !== "preset") {
		const waveform = asset?.waveform;
		if (!waveform || waveform.peaks?.length !== waveform.buckets * 2) {
			errors.push(
				`${where}: waveform peaks do not match the declared bucket count`,
			);
		}
	}

	// --- tags ----------------------------------------------------------------
	const tags = asset?.tags;
	if (!tags?.genres?.length)
		errors.push(`${where}: at least one genre tag is required`);
	if (!tags?.characters?.length)
		errors.push(`${where}: at least one character tag is required`);
	for (const genre of tags?.genres ?? []) {
		if (!GENRES.includes(genre))
			errors.push(`${where}: unknown genre "${genre}"`);
	}
	for (const character of tags?.characters ?? []) {
		if (!CHARACTERS.includes(character))
			errors.push(`${where}: unknown character "${character}"`);
	}
	if (!INTENSITIES.includes(tags?.intensity))
		errors.push(`${where}: unknown intensity "${tags?.intensity}"`);
	for (const source of tags?.sourceTypes ?? []) {
		if (!SOURCE_TYPES.includes(source))
			errors.push(`${where}: unknown source type "${source}"`);
	}
	if (!tags?.sourceTypes?.length)
		errors.push(`${where}: at least one source type is required`);

	// --- rights (section 3.4) ------------------------------------------------
	const license = asset?.license;
	if (!license) {
		errors.push(`${where}: license is required`);
	} else {
		if (!license.id) errors.push(`${where}: license.id is required`);
		if (!license.creator) errors.push(`${where}: license.creator is required`);
		if (!license.evidencePath) {
			errors.push(`${where}: license.evidencePath is required`);
		} else if (!pathExists(license.evidencePath)) {
			// A rights record that points at nothing is worse than no record: it
			// reads as evidence in every report while the file it names is gone.
			errors.push(
				`${where}: license.evidencePath "${license.evidencePath}" does not exist`,
			);
		}
		if (!license.retrievedAt)
			errors.push(`${where}: license.retrievedAt is required`);
		if (license.rawRedistributionAllowed !== true) {
			errors.push(`${where}: raw redistribution is not approved`);
		}
		// Section 9: "an asset's licence terms must not exceed its pack's". The
		// licence *identifier* matching is checked above; this is the obligation
		// the identifier implies — a pack whose rights position says no
		// attribution is required cannot hold a file that requires it, because
		// the pack's position is what the export policy is answered from.
		if (license.attributionRequired === true && pack?.rights) {
			if (pack.rights.attributionRequired !== true) {
				errors.push(
					`${where}: requires attribution, which pack "${pack.slug}"'s rights position does not carry`,
				);
			}
		}
		if (
			license.rawRedistributionAllowed === true &&
			pack?.rights &&
			pack.rights.rawRedistribution !== true
		) {
			errors.push(
				`${where}: claims raw redistribution, which pack "${pack.slug}" does not approve`,
			);
		}
		// The section 3.2 allowlist, enforced at the last point before delivery.
		// CC-BY and friends may be perfectly legal to use in a track and still
		// be unbundleable here, so "it's an open licence" is not the test.
		const rejection = license.id ? licenseRejectionReason(license.id) : null;
		if (rejection) errors.push(`${where}: ${rejection}`);
	}

	const provenance = asset?.provenance;
	if (!provenance) {
		errors.push(`${where}: provenance is required`);
	} else {
		if (!provenance.sourceType)
			errors.push(`${where}: provenance.sourceType is required`);
		if (!Array.isArray(provenance.modifications)) {
			errors.push(`${where}: provenance.modifications must be an array`);
		}
		if (!provenance.reviewState) {
			errors.push(`${where}: provenance.reviewState is required`);
		} else if (!isKnownIntakeState(provenance.reviewState)) {
			errors.push(
				`${where}: unknown intake state "${provenance.reviewState}" (section 11)`,
			);
		} else if (!isDeliverable(provenance.reviewState)) {
			// The build isolates these before it gets here (`partitionByIntake`).
			// Reaching the validator means something bypassed that partition, which
			// is exactly the "isolated from production manifests" rule failing.
			errors.push(
				`${where}: intake state "${provenance.reviewState}" is not deliverable but the asset is in a published manifest`,
			);
		}
		if (provenance.sourceType === "synthesized" && asset?.type === "preset") {
			// A preset's recipe is which kind of preset it is; it has no voice.
			if (!provenance.recipe?.preset) {
				errors.push(`${where}: preset is missing its provenance recipe`);
			}
		} else if (provenance.sourceType === "synthesized") {
			// Section 14 item 6: keep the generation recipe. Without it a
			// synthesized asset cannot be reproduced or audited.
			if (!provenance.recipe?.voice) {
				errors.push(
					`${where}: synthesized asset is missing its generation recipe`,
				);
			}
		} else if (asset?.type === "derived") {
			// Checked in full by `validateDerived`: a derived master's provenance
			// is its source and transform, not a download record.
			if (provenance.sourceType !== "processed") {
				errors.push(
					`${where}: derived master must declare sourceType "processed", not "${provenance.sourceType}"`,
				);
			}
		} else {
			// Acquired audio cannot be regenerated, so its provenance has to
			// stand on the record instead: where it came from, what arrived, and
			// who checked it (section 3.4).
			for (const field of [
				"sourceId",
				"downloadUrl",
				"originalFilename",
				"originalSha256",
			]) {
				if (!provenance[field]) {
					errors.push(
						`${where}: acquired asset is missing provenance.${field}`,
					);
				}
			}
			if (
				provenance.originalSha256 &&
				!HEX_64.test(provenance.originalSha256)
			) {
				errors.push(`${where}: provenance.originalSha256 is not a SHA-256`);
			}
			if (!provenance.reviewer) {
				errors.push(`${where}: acquired asset has no named reviewer`);
			}
			if (!license?.sourceUrl) {
				errors.push(`${where}: acquired asset is missing license.sourceUrl`);
			}
		}
	}
}

/**
 * Section 10, "Loops": the BPM must be verified against the bar grid, the exact
 * bar count and time signature recorded, boundaries aligned to integer sample
 * positions, and the file tested over at least 32 repeated cycles.
 *
 * Every one of those is a *measurement* the pipeline wrote into `audio.grid`
 * and `audio.seam`, so the rules below check measurements rather than claims —
 * which is what lets them reject an acquired loop whose filename lied.
 */
function validateLoopAudio(audio, where, errors) {
	if (audio.loopable !== true)
		errors.push(`${where}: a loop must declare loopable: true`);
	if (!TIME_SIGNATURES.includes(audio.timeSignature)) {
		errors.push(`${where}: unknown time signature "${audio.timeSignature}"`);
	}

	const grid = audio.grid;
	if (!grid) {
		errors.push(`${where}: loop is missing its verified bar grid`);
	} else {
		if (grid.bpm !== audio.bpm || grid.bars !== audio.bars) {
			errors.push(`${where}: grid bpm/bars disagree with the audio block`);
		}
		if (grid.sampleAligned !== true) {
			errors.push(
				`${where}: ${audio.bars} bar(s) at ${audio.bpm} BPM is not a whole number of samples`,
			);
		}
		if (Math.abs(grid.errorSamples ?? Infinity) > MAX_LOOP_GRID_ERROR_SAMPLES) {
			errors.push(
				`${where}: loop is ${grid.errorSamples} samples off the ${audio.bpm} BPM bar grid`,
			);
		}
	}

	const seam = audio.seam;
	if (!seam) {
		errors.push(`${where}: loop is missing its seam measurement`);
		return;
	}
	if ((seam.cyclesVerified ?? 0) < SEAM_CYCLES) {
		errors.push(
			`${where}: seam was tested over ${seam.cyclesVerified} cycles, below the ${SEAM_CYCLES} minimum`,
		);
	}
	if (seam.seamless !== true) {
		errors.push(
			`${where}: loop point clicks — a ${seam.wrapStepDbfs} dBFS step against a ${seam.interiorStepDbfs} dBFS interior maximum`,
		);
	}
}

/**
 * A derived master names the asset it came from, the transform, and the
 * untouched source's checksum (section 10, "Master files"). The reference
 * itself is resolved library-wide by `validateLibraryReferences`; this checks
 * the record is well formed.
 */
function validateDerived(asset, where, errors) {
	const derivedFrom = asset.derivedFrom;
	if (!derivedFrom) {
		errors.push(`${where}: derived master is missing derivedFrom`);
		return;
	}
	if (!derivedFrom.assetId)
		errors.push(`${where}: derivedFrom.assetId is required`);
	if (!DERIVATIONS.includes(derivedFrom.transform)) {
		errors.push(`${where}: unknown transform "${derivedFrom.transform}"`);
	}
	if (!HEX_64.test(derivedFrom.sourceSha256 ?? "")) {
		errors.push(
			`${where}: derivedFrom.sourceSha256 must be the untouched source's SHA-256`,
		);
	}
	if (!asset.provenance?.modifications?.includes(derivedFrom.transform)) {
		errors.push(
			`${where}: provenance.modifications does not record the "${derivedFrom.transform}" transform`,
		);
	}
}

/**
 * A preset's body. Section 9's controlled vocabulary: "Instrument, kit, and
 * recipe definitions reference pack-qualified asset IDs, never filenames or
 * URLs" — so a reference that is not an asset ID is rejected here, and one that
 * is an asset ID but resolves to nothing is rejected library-wide.
 */
function validatePreset(asset, where, errors) {
	const preset = asset.preset;
	if (!preset) {
		errors.push(`${where}: preset body is required`);
		return;
	}
	if (!PRESET_KINDS.includes(preset.kind)) {
		errors.push(`${where}: unknown preset kind "${preset.kind}"`);
		return;
	}
	if (preset.kind !== asset.role) {
		errors.push(
			`${where}: preset kind "${preset.kind}" disagrees with its role`,
		);
	}

	if (preset.kind === "drum-kit") {
		const pads = preset.pads ?? [];
		if (pads.length === 0) errors.push(`${where}: drum kit has no pads`);
		const seen = new Set();
		for (const pad of pads) {
			if (seen.has(pad.pad)) errors.push(`${where}: duplicate pad ${pad.pad}`);
			seen.add(pad.pad);
			if (!pad.assetId)
				errors.push(`${where}: pad ${pad.pad} references no asset`);
			if (/[/.]/.test(pad.assetId ?? "")) {
				errors.push(
					`${where}: pad ${pad.pad} references a path, not an asset ID`,
				);
			}
		}
		return;
	}

	if (preset.kind === "instrument")
		validateInstrumentZones(preset, where, errors);
}

/**
 * Section 10, "Sampled instruments": "Validate root keys, zone boundaries,
 * velocity layers, loop points, gain consistency, and release behavior." The
 * mechanical half of that — roots, boundaries, and coverage — is checked here;
 * the listening half is the section 11 musical review.
 */
function validateInstrumentZones(preset, where, errors) {
	const zones = preset.zones ?? [];
	if (zones.length === 0) {
		errors.push(`${where}: instrument has no zones`);
		return;
	}
	const sorted = [...zones].sort((a, b) => a.lowNote - b.lowNote);
	let previousHigh = null;
	for (const zone of sorted) {
		if (!zone.assetId) errors.push(`${where}: a zone references no asset`);
		let root = null;
		try {
			root = noteToMidi(zone.rootNote);
		} catch {
			errors.push(`${where}: zone root "${zone.rootNote}" is not a note name`);
		}
		if (!(zone.lowNote <= zone.highNote)) {
			errors.push(
				`${where}: zone ${zone.lowNote}-${zone.highNote} has an inverted range`,
			);
		}
		if (root !== null && (root < zone.lowNote || root > zone.highNote)) {
			errors.push(
				`${where}: zone root ${zone.rootNote} lies outside its own ${zone.lowNote}-${zone.highNote} range`,
			);
		}
		if (previousHigh !== null) {
			if (zone.lowNote <= previousHigh) {
				errors.push(`${where}: zones overlap at note ${zone.lowNote}`);
			} else if (zone.lowNote !== previousHigh + 1) {
				errors.push(
					`${where}: zones leave a gap between ${previousHigh} and ${zone.lowNote}`,
				);
			}
		}
		previousHigh = zone.highNote;
	}
}

/**
 * Cross-pack rules — the ones that cannot be decided from one manifest.
 *
 * Asset IDs are unique across the whole library, not just within a pack, and
 * every preset pad, instrument zone, and derived master must resolve to an
 * asset that is actually delivered. A reference into a quarantined or withheld
 * asset is a broken path with a plausible-looking ID, which is precisely the
 * failure the section 11 isolation rule creates if nothing checks for it.
 *
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function validateLibraryReferences(packManifests) {
	const errors = [];
	const warnings = [];
	const assets = packManifests.flatMap((pm) => pm.assets);

	const byId = new Map();
	for (const asset of assets) {
		if (byId.has(asset.id)) {
			errors.push(
				`asset id ${asset.id} appears in more than one pack (${byId.get(asset.id).pack?.id} and ${asset.pack?.id})`,
			);
			continue;
		}
		byId.set(asset.id, asset);
	}

	const check = (asset, reference, what) => {
		const target = byId.get(reference);
		if (!target) {
			errors.push(
				`${asset.id}: ${what} references ${reference}, which the library does not deliver`,
			);
			return;
		}
		if (target.pack?.id !== asset.pack?.id) {
			// A cross-pack reference would make one pack silently undeliverable
			// without the other, which section 5.1's "self-contained" rule forbids.
			errors.push(
				`${asset.id}: ${what} references ${reference} in a different pack`,
			);
		}
	};

	for (const asset of assets) {
		if (asset.type === "preset") {
			for (const pad of asset.preset?.pads ?? []) {
				check(asset, pad.assetId, `pad ${pad.pad}`);
			}
			for (const zone of asset.preset?.zones ?? []) {
				check(asset, zone.assetId, `zone ${zone.lowNote}-${zone.highNote}`);
			}
		}
		if (asset.type === "derived" && asset.derivedFrom?.assetId) {
			check(asset, asset.derivedFrom.assetId, "derivedFrom");
			const source = byId.get(asset.derivedFrom.assetId);
			if (
				source &&
				source.files?.master?.sha256 !== asset.derivedFrom.sourceSha256
			) {
				errors.push(
					`${asset.id}: derivedFrom.sourceSha256 does not match ${asset.derivedFrom.assetId}'s master checksum`,
				);
			}
		}
	}

	return { errors, warnings };
}

function emptyStats() {
	return {
		total: 0,
		byFamily: {},
		byRole: {},
		byGenre: {},
		byIntensity: {},
		bySourceType: {},
		experimentalShare: 0,
		dryShare: 0,
		recordedShare: 0,
		totalAudioBytes: 0,
		longestSeconds: 0,
	};
}

function computeStats(assets) {
	const stats = emptyStats();
	stats.total = assets.length;
	let experimental = 0;
	let dry = 0;
	for (const asset of assets) {
		bump(stats.byFamily, asset.family);
		bump(stats.byRole, `${asset.family}/${asset.role}`);
		bump(stats.byIntensity, asset.tags?.intensity);
		for (const genre of asset.tags?.genres ?? []) bump(stats.byGenre, genre);
		for (const source of asset.tags?.sourceTypes ?? [])
			bump(stats.bySourceType, source);
		const characters = asset.tags?.characters ?? [];
		if (characters.some((c) => EXPERIMENTAL_CHARACTERS.includes(c)))
			experimental++;
		if (characters.some((c) => DRY_CHARACTERS.includes(c))) dry++;
		stats.totalAudioBytes += asset.files?.master?.bytes ?? 0;
		stats.longestSeconds = Math.max(
			stats.longestSeconds,
			asset.audio?.durationSeconds ?? 0,
		);
	}
	stats.experimentalShare = experimental / assets.length;
	stats.dryShare = dry / assets.length;
	return stats;
}

function bump(counter, key) {
	if (key === undefined || key === null) return;
	counter[key] = (counter[key] ?? 0) + 1;
}

/**
 * Section 6.5: "The section 6.1 milestone counts and the section 6.4 character
 * balances are measured across the whole approved library, not per pack." This
 * runs once, over every pack's assets concatenated, rather than per pack.
 *
 * @returns {{ errors: string[], warnings: string[], stats: object }}
 */
export function validateLibraryBalance(assets) {
	const errors = [];
	const warnings = [];
	if (assets.length === 0) {
		return {
			errors: ["the library has no assets"],
			warnings,
			stats: emptyStats(),
		};
	}
	const stats = computeStats(assets);
	checkBalance(stats, assets.length, { errors, warnings });
	checkCoverage(stats, { errors });
	return { errors, warnings, stats };
}

function checkBalance(stats, total, { errors, warnings }) {
	if (stats.experimentalShare < BALANCE.minExperimentalShare) {
		errors.push(
			`only ${percent(stats.experimentalShare)} of assets are experimental or abrasive; section 6.4 requires ${percent(BALANCE.minExperimentalShare)}`,
		);
	}
	if (stats.dryShare < BALANCE.minDryShare) {
		errors.push(
			`only ${percent(stats.dryShare)} of assets are dry or lightly processed; section 6.4 requires ${percent(BALANCE.minDryShare)}`,
		);
	}
	for (const [role, count] of Object.entries(stats.byRole)) {
		if (count / total > BALANCE.maxSingleRoleShare) {
			errors.push(
				`${role} is ${percent(count / total)} of the library, over the ${percent(BALANCE.maxSingleRoleShare)} single-family ceiling`,
			);
		}
	}
	for (const genre of GENRES) {
		const count = stats.byGenre[genre] ?? 0;
		if (count < BALANCE.minAssetsPerGenre) {
			errors.push(
				`genre "${genre}" has ${count} tagged assets, below the ${BALANCE.minAssetsPerGenre} minimum (PRD LIB-02)`,
			);
		}
	}

	// Section 6.4 also wants at least 20% organic, recorded, or non-instrument
	// derived material. Synthesis cannot satisfy that by construction, so it is
	// reported as an open gap rather than quietly dropped or satisfied by
	// relabelling. It closes as `library:acquire` brings in CC0 recordings and
	// field recordings; a warning here means the balance is not there yet.
	const recorded =
		(stats.bySourceType.recorded ?? 0) +
		(stats.bySourceType["field-recording"] ?? 0);
	stats.recordedShare = recorded / total;
	if (stats.recordedShare < BALANCE.minRecordedShare) {
		warnings.push(
			`${percent(stats.recordedShare)} of assets are recorded or field-recorded, below the ${percent(BALANCE.minRecordedShare)} section 6.4 target; synthesis cannot close this — run \`bun run library:acquire\` with pinned CC0 selections`,
		);
	}
}

function checkCoverage(stats, { errors }) {
	for (const [family, roles] of Object.entries(TAXONOMY)) {
		for (const role of roles) {
			if (!stats.byRole[`${family}/${role}`]) {
				errors.push(`no assets cover ${family}/${role}`);
			}
		}
	}
}

/**
 * Section 15.8: the pack index must name exactly the packs this build actually
 * produced — nothing dangling, nothing missing — and stay inside its own
 * section 12 payload budget.
 *
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function validatePackIndex(index, packManifests, { serialized } = {}) {
	const errors = [];
	const warnings = [];
	if (index?.schemaVersion !== 1) errors.push("index.schemaVersion must be 1");

	const entries = Array.isArray(index?.packs) ? index.packs : [];
	const known = new Map(packManifests.map((pm) => [pm.pack.id, pm.pack]));

	const seenIds = new Set();
	for (const entry of entries) {
		if (seenIds.has(entry.id)) {
			errors.push(`pack index lists ${entry.id} more than once`);
		}
		seenIds.add(entry.id);
		const pack = known.get(entry.id);
		if (!pack) {
			errors.push(
				`pack index references ${entry.id} (${entry.slug}), which no built pack manifest matches`,
			);
			continue;
		}
		if (entry.version !== pack.version) {
			errors.push(
				`pack index version for ${entry.slug} (${entry.version}) does not match its manifest (${pack.version})`,
			);
		}
		if (entry.manifestPath !== packManifestStorageKeyOf(pack)) {
			errors.push(`pack index manifestPath for ${entry.slug} is wrong`);
		}
	}
	for (const pack of known.values()) {
		if (!seenIds.has(pack.id)) {
			errors.push(
				`pack "${pack.slug}" was built but is missing from the pack index`,
			);
		}
	}

	if (serialized !== undefined) {
		const compressed = gzipSync(Buffer.from(serialized)).length;
		if (compressed > MAX_PACK_INDEX_GZIP_BYTES) {
			errors.push(
				`pack index is ${compressed} bytes gzipped, over the ${MAX_PACK_INDEX_GZIP_BYTES}-byte budget`,
			);
		}
	}

	return { errors, warnings };
}

function packManifestStorageKeyOf(pack) {
	return `packs/${pack.slug}/v${pack.version}.json`;
}

function percent(share) {
	return `${(share * 100).toFixed(1)}%`;
}

export function formatReport(stats, warnings) {
	const lines = [
		`assets:              ${stats.total}`,
		`audio payload:       ${(stats.totalAudioBytes / 1024 / 1024).toFixed(1)} MiB`,
		`longest asset:       ${stats.longestSeconds.toFixed(2)}s`,
	];
	if (stats.manifestGzipBytes) {
		lines.push(
			`manifest (gzipped):  ${(stats.manifestGzipBytes / 1024).toFixed(1)} KiB`,
		);
	}
	lines.push(
		`experimental share:  ${percent(stats.experimentalShare)}`,
		`dry share:           ${percent(stats.dryShare)}`,
		"",
		"by family:",
		...Object.entries(stats.byFamily)
			.sort()
			.map(([family, count]) => `  ${family.padEnd(10)} ${count}`),
		"",
		"by genre:",
		...Object.entries(stats.byGenre)
			.sort()
			.map(([genre, count]) => `  ${genre.padEnd(16)} ${count}`),
	);
	for (const warning of warnings ?? []) lines.push("", `warning: ${warning}`);
	return lines.join("\n");
}

/** One line per pack: what `library:build`/`library:upload` report before the detail. */
export function formatPackSummary(packManifests) {
	return [
		"packs:",
		...packManifests.map(
			({ pack }) =>
				`  ${pack.slug.padEnd(24)} v${pack.version}  ${String(pack.assetCount).padStart(4)} assets  ${pack.rights.licence}`,
		),
	].join("\n");
}
