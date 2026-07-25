// Manifest validation.
//
// docs/sample-library.md section 9: "Manifest validation fails CI when an asset
// is missing its checksum, rights evidence, creator/source, required audio
// metadata, or raw-redistribution approval." Section 6.4 adds collection-level
// balance rules, and section 12 adds a payload budget. All of it is checked
// here so the same rules run in the build, in the unit suite, and in CI.

import { gzipSync } from "node:zlib";
import { licenseRejectionReason } from "./acquire/sources.mjs";
import {
	CHARACTERS,
	DRY_CHARACTERS,
	EXPERIMENTAL_CHARACTERS,
	GENRES,
	INTENSITIES,
	isKnownRole,
	SOURCE_TYPES,
	TAXONOMY,
} from "./taxonomy.mjs";
import { storageKeyFor } from "./wav.mjs";

/** Section 12: "Library metadata payload below 1 MiB compressed". */
export const MAX_MANIFEST_GZIP_BYTES = 1024 * 1024;

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
const ASSET_ID = /^sg-one-shot-[a-z]+-[a-z-]+-\d{4}$/;

/**
 * @returns {{ errors: string[], warnings: string[], stats: object }}
 */
export function validateManifest(manifest, { serialized } = {}) {
	const errors = [];
	const warnings = [];

	if (manifest?.schemaVersion !== 1)
		errors.push("manifest.schemaVersion must be 1");
	if (!manifest?.libraryId) errors.push("manifest.libraryId is required");
	if (!Number.isInteger(manifest?.libraryVersion)) {
		errors.push("manifest.libraryVersion must be an integer");
	}
	const assets = Array.isArray(manifest?.assets) ? manifest.assets : [];
	if (assets.length === 0) {
		return {
			errors: [...errors, "manifest.assets is empty"],
			warnings,
			stats: emptyStats(),
		};
	}
	if (manifest.assetCount !== assets.length) {
		errors.push(
			`manifest.assetCount (${manifest.assetCount}) does not match assets.length (${assets.length})`,
		);
	}

	const seenIds = new Set();
	const seenNames = new Set();
	const seenHashes = new Map();
	for (const asset of assets) {
		validateAsset(asset, { errors, seenIds, seenNames, seenHashes });
	}

	const stats = computeStats(assets);
	checkBalance(stats, assets.length, { errors, warnings });
	checkCoverage(stats, { errors });

	if (serialized !== undefined) {
		const compressed = gzipSync(Buffer.from(serialized)).length;
		stats.manifestGzipBytes = compressed;
		if (compressed > MAX_MANIFEST_GZIP_BYTES) {
			errors.push(
				`manifest is ${compressed} bytes gzipped, over the ${MAX_MANIFEST_GZIP_BYTES}-byte budget`,
			);
		}
	}

	return { errors, warnings, stats };
}

function validateAsset(asset, { errors, seenIds, seenNames, seenHashes }) {
	const where = asset?.id ?? "<asset with no id>";

	if (!asset?.id || !ASSET_ID.test(asset.id))
		errors.push(`${where}: malformed asset id`);
	if (seenIds.has(asset?.id)) errors.push(`${where}: duplicate asset id`);
	seenIds.add(asset?.id);

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

	if (!isKnownRole(asset?.family, asset?.role)) {
		errors.push(
			`${where}: unknown family/role ${asset?.family}/${asset?.role}`,
		);
	}
	if (asset?.type !== "one-shot")
		errors.push(`${where}: unexpected type ${asset?.type}`);

	// --- files and checksums -------------------------------------------------
	const master = asset?.files?.master;
	if (!master) {
		errors.push(`${where}: files.master is required`);
	} else {
		if (!HEX_64.test(master.sha256 ?? ""))
			errors.push(`${where}: files.master.sha256 is not a SHA-256`);
		if (!(master.bytes > 0))
			errors.push(`${where}: files.master.bytes must be positive`);
		if (master.format !== "wav")
			errors.push(`${where}: unexpected format ${master.format}`);
		if (
			HEX_64.test(master.sha256 ?? "") &&
			master.storageKey !== storageKeyFor(master.sha256)
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
	if (!audio) {
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
	}

	const waveform = asset?.waveform;
	if (!waveform || waveform.peaks?.length !== waveform.buckets * 2) {
		errors.push(
			`${where}: waveform peaks do not match the declared bucket count`,
		);
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
		if (!license.evidencePath)
			errors.push(`${where}: license.evidencePath is required`);
		if (!license.retrievedAt)
			errors.push(`${where}: license.retrievedAt is required`);
		if (license.rawRedistributionAllowed !== true) {
			errors.push(`${where}: raw redistribution is not approved`);
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
		if (!provenance.reviewState)
			errors.push(`${where}: provenance.reviewState is required`);
		if (provenance.sourceType === "synthesized") {
			// Section 14 item 6: keep the generation recipe. Without it a
			// synthesized asset cannot be reproduced or audited.
			if (!provenance.recipe?.voice) {
				errors.push(
					`${where}: synthesized asset is missing its generation recipe`,
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
