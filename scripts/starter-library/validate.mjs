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

import { gzipSync } from "node:zlib";
import { licenseRejectionReason } from "./acquire/sources.mjs";
import { packBySlug } from "./packs.mjs";
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
const ASSET_ID = /^sg-one-shot-[a-z]+-[a-z-]+-\d{4}$/;
const PACK_ID = /^pak_[A-Za-z0-9_-]{21}$/;

/**
 * Validate one pack's manifest: its header, every asset in it (the section 9
 * per-asset rules plus the section 5.1/9 pack rules), and its section 12
 * payload budget.
 *
 * @returns {{ errors: string[], warnings: string[], stats: object }}
 */
export function validatePackManifest(packManifest, { serialized } = {}) {
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
		validateAsset(asset, { errors, seenIds, seenNames, seenHashes, pack });
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
	if (!Number.isInteger(pack.version) || pack.version < 1) {
		errors.push("pack.version must be a positive integer");
	}
	if (!["factory", "user", "third-party"].includes(pack.kind)) {
		errors.push(
			`pack.kind must be factory, user, or third-party, not "${pack.kind}"`,
		);
	}
	if (!pack.publisher) errors.push("pack.publisher is required");
	if (!pack.description) errors.push("pack.description is required");

	const license = pack.license;
	if (!license?.id) {
		errors.push("pack.license.id is required");
	} else {
		const rejection = licenseRejectionReason(license.id);
		if (rejection) errors.push(`pack license: ${rejection}`);
	}
	if (license && license.rawRedistributionAllowed !== true) {
		errors.push("pack license: raw redistribution is not approved");
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

function validateAsset(
	asset,
	{ errors, seenIds, seenNames, seenHashes, pack },
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
		if (asset.license && pack.license && asset.license.id !== pack.license.id) {
			errors.push(
				`${where}: license "${asset.license.id}" exceeds pack "${pack.slug}"'s rights position ("${pack.license.id}")`,
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
				`  ${pack.slug.padEnd(24)} v${pack.version}  ${String(pack.assetCount).padStart(4)} assets  ${pack.license.id}`,
		),
	].join("\n");
}
