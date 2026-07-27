// Orchestrates acquisition: pinned selection -> verified bytes -> prepared
// audio -> a manifest entry in the same shape the synthesized library produces.
//
// The output of this module is deliberately identical in shape to
// `manifest.mjs`'s `buildAsset`, so downstream there is exactly one validator,
// one uploader, one delivery layout, and one thing for the app to read. An
// acquired kick and a generated kick differ in their provenance block and
// nowhere else.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { packBySlug, packRef } from "../packs.mjs";
import {
	analyze,
	encodeWav,
	sha256 as hashBytes,
	storageKeyFor,
	waveformPeaks,
} from "../wav.mjs";
import {
	extractMember,
	isArchive,
	unsupportedArchiveReason,
} from "./archive.mjs";
import { decodeToSamples, isSupportedAudio, prepareOneShot } from "./audio.mjs";
import { captureLicenseEvidence, fetchToQuarantine } from "./fetch.mjs";
import { findSource, licenseRejectionReason } from "./sources.mjs";

/**
 * Asset IDs for acquired content.
 *
 * Same `sg-one-shot-<family>-<role>-NNNN` scheme as the synthesized catalogue,
 * but numbered from a high base so the two ranges cannot collide as either side
 * grows. Numbering is by the selection's position in the sorted lockfile, which
 * is stable because the lockfile is sorted by selection ID.
 */
export const ACQUIRED_ID_BASE = 5000;

export function acquiredAssetId(family, role, index) {
	return `sg-one-shot-${family}-${role}-${String(ACQUIRED_ID_BASE + index + 1).padStart(4, "0")}`;
}

/**
 * The audio bytes a selection refers to: either the download itself, or one
 * named member of it.
 */
export function resolveSelectedBytes(selection, downloaded) {
	if (!selection.archiveMember) {
		if (!isSupportedAudio(selection.originalFilename)) {
			const reason = unsupportedArchiveReason(selection.originalFilename);
			throw new Error(
				reason ?? `${selection.originalFilename} is not a supported audio file`,
			);
		}
		return downloaded;
	}

	if (!isArchive(selection.originalFilename)) {
		const reason = unsupportedArchiveReason(selection.originalFilename);
		throw new Error(
			reason ?? `${selection.originalFilename} is not a supported archive`,
		);
	}
	const member = extractMember(downloaded, selection.archiveMember);
	const memberHash = hashBytes(member);
	if (selection.memberSha256 && memberHash !== selection.memberSha256) {
		throw new Error(
			`${selection.id} archive member checksum mismatch\n  expected ${selection.memberSha256}\n  received ${memberHash}`,
		);
	}
	return member;
}

/**
 * Fetch, verify, prepare, and describe one selection.
 *
 * Rights are re-checked here even though the lockfile validator already checked
 * them. This is the last point before bytes become a shippable asset, and the
 * cost of one array lookup is not worth the risk of a code path that skips it.
 */
export async function ingestSelection(selection, context) {
	const source = findSource(selection.sourceId);
	if (!source)
		throw new Error(`${selection.id}: unknown source ${selection.sourceId}`);
	const rejection = licenseRejectionReason(source.licenseId);
	if (rejection) throw new Error(`${selection.id}: ${rejection}`);

	const pack = packBySlug(selection.asset.pack);
	if (!pack) {
		throw new Error(
			`${selection.id}: asset.pack "${selection.asset.pack}" is not a registered pack`,
		);
	}
	if (pack.license.id !== source.licenseId) {
		throw new Error(
			`${selection.id}: source ${source.id} is licensed ${source.licenseId}, which exceeds pack "${pack.slug}"'s rights position ("${pack.license.id}")`,
		);
	}

	const downloaded = await fetchToQuarantine(selection, context);
	const audioBytes = resolveSelectedBytes(selection, downloaded.bytes);

	const decoded = await decodeToSamples(audioBytes);
	const prepared = prepareOneShot(decoded.channels, {
		peakDbfs: selection.asset.peakDbfs ?? -1.5,
	});
	const master = encodeWav(prepared);
	const hash = hashBytes(master);

	return {
		bytes: master,
		asset: {
			id: selection.assetId,
			version: 1,
			pack: packRef(pack),
			name: selection.asset.name,
			type: "one-shot",
			family: selection.asset.family,
			role: selection.asset.role,
			files: {
				master: {
					storageKey: storageKeyFor(hash),
					sha256: hash,
					bytes: master.length,
					format: "wav",
				},
			},
			audio: {
				...analyze(prepared),
				rootNote: selection.asset.rootNote ?? null,
				// Acquired tonal material is detected/reviewed rather than
				// generated at an exact pitch, so the reviewer records the
				// correction. Unlike synthesized assets it is not assumed to be 0.
				tuningCents: selection.asset.rootNote
					? (selection.asset.tuningCents ?? 0)
					: null,
				bpm: null,
				bars: null,
				loopable: false,
				chokeGroup: selection.asset.choke
					? `${selection.asset.family}-hat`
					: null,
				chokeRole: selection.asset.choke ?? null,
			},
			waveform: { buckets: 64, peaks: waveformPeaks(prepared, 64) },
			tags: {
				genres: [...selection.asset.genres].sort(),
				characters: [...selection.asset.characters].sort(),
				intensity: selection.asset.intensity,
				sourceTypes: [selection.asset.sourceType],
			},
			license: {
				id: source.licenseId,
				creator: selection.creator,
				sourceUrl: selection.sourcePageUrl,
				retrievedAt: selection.retrievedAt,
				evidencePath: context.evidencePathFor(source),
				rawRedistributionAllowed: true,
				agreementId: null,
			},
			provenance: {
				sourceType: selection.asset.sourceType,
				sourceId: source.id,
				downloadUrl: selection.downloadUrl,
				originalFilename: selection.originalFilename,
				originalSha256: downloaded.sha256,
				// Present only for an archive, where the download hash and the
				// audio hash are different things and both matter.
				archiveMember: selection.archiveMember ?? null,
				memberSha256: selection.memberSha256 ?? null,
				// The source rate is recorded as downloaded, not as converted:
				// section 10 asks for conversion to be stated honestly rather
				// than hidden behind a 48 kHz master.
				sourceSampleRate: decoded.sampleRate,
				sourceChannels: decoded.channels.length,
				modifications: [
					"decode",
					...(decoded.sampleRate === 48000 ? [] : ["resample-48000"]),
					...(decoded.channels.length > prepared.length
						? ["downmix-mono"]
						: []),
					"dc-offset-removal",
					"lead-trim",
					"tail-trim",
					"peak-normalize",
					"edge-fades",
				],
				reviewState: "metadata-review",
				reviewer: selection.reviewer,
				reviewedAt: selection.retrievedAt,
			},
		},
	};
}

/**
 * Ingest every pinned selection.
 *
 * Selections are processed in lockfile order and assigned IDs by position, so
 * two runs of the same lockfile produce the same asset IDs. A failure names the
 * selection and stops: a partially ingested library with silently missing
 * assets is worse than no ingest at all.
 */
export async function ingestAll(lockfile, context) {
	const perRole = {};
	const results = [];
	for (const selection of lockfile.selections) {
		const key = `${selection.asset.family}/${selection.asset.role}`;
		const index = perRole[key] ?? 0;
		perRole[key] = index + 1;
		const withId = {
			...selection,
			assetId: acquiredAssetId(
				selection.asset.family,
				selection.asset.role,
				index,
			),
		};
		try {
			results.push(await ingestSelection(withId, context));
		} catch (error) {
			throw new Error(
				`failed to ingest ${selection.id}: ${error instanceof Error ? error.message : error}`,
			);
		}
	}
	return results;
}

/**
 * Write one ingest bundle — its `entries.json` and `audio/` — into `dir`,
 * replacing whatever was there before. Both ingest paths (the lockfile ingest
 * and the VCSL bulk ingest) use this so the on-disk layout is identical and
 * `manifest.loadAcquiredAssets` can merge them by directory.
 */
export function writeAcquiredBundle(dir, ingested) {
	rmSync(dir, { recursive: true, force: true });
	for (const { asset, bytes } of ingested) {
		const path = join(dir, "audio", asset.files.master.storageKey);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, bytes);
	}
	const entriesPath = join(dir, "entries.json");
	mkdirSync(dirname(entriesPath), { recursive: true });
	writeFileSync(
		entriesPath,
		`${JSON.stringify(
			ingested.map((r) => r.asset),
			null,
			"\t",
		)}\n`,
	);
	return entriesPath;
}

/** Capture licence evidence once per source that the lockfile actually uses. */
export async function captureAllEvidence(
	lockfile,
	{ evidenceDir, fetchImpl, now },
) {
	const used = [
		...new Set(lockfile.selections.map((selection) => selection.sourceId)),
	];
	const captured = {};
	for (const sourceId of used) {
		const source = findSource(sourceId);
		if (!source) continue;
		captured[sourceId] = await captureLicenseEvidence(source, {
			evidenceDir,
			fetchImpl,
			now,
		});
	}
	return captured;
}
