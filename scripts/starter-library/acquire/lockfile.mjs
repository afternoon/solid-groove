// The acquisition lockfile: which exact bytes we agreed to ship.
//
// `sources.mjs` says which sources are approved and what may be taken from
// them. This says which individual files were selected, what their SHA-256 was
// at review time, and how each one is tagged. Both are checked in, and the
// fetcher will not ingest a file that is not pinned here.
//
// The separation matters for the same reason a dependency lockfile does: the
// declaration is a human decision, and the pin is what makes a later download
// verifiable. A source that silently re-encodes a file, or an operator pointed
// at a hostile mirror, changes the hash and fails the fetch instead of quietly
// putting different audio in front of users.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findSource, licenseRejectionReason } from "./sources.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const LOCKFILE_PATH = resolve(join(HERE, "..", "sources.lock.json"));

export const LOCKFILE_VERSION = 1;

/**
 * @typedef {object} Selection
 * @property {string} id             Selection ID, unique within the lockfile.
 * @property {string} sourceId       A source from `sources.mjs`.
 * @property {string} downloadUrl    Direct download for the file or archive.
 * @property {string} sourcePageUrl  The page a reviewer read (section 3.4).
 * @property {string} creator        Credited creator or uploader.
 * @property {string} originalFilename
 * @property {string} sha256         Of the downloaded bytes, exactly as served.
 * @property {number} bytes
 * @property {string} [archiveMember] Path inside the archive, when the download is one.
 * @property {string} [memberSha256]  Of the extracted member.
 * @property {string} retrievedAt    ISO date the pin was recorded.
 * @property {string} reviewer       Who reviewed provenance.
 * @property {object} asset          family, role, name, genres, characters, intensity, sourceType, rootNote.
 */

export function emptyLockfile() {
	return { version: LOCKFILE_VERSION, updatedAt: null, selections: [] };
}

export function readLockfile(path = LOCKFILE_PATH) {
	if (!existsSync(path)) return emptyLockfile();
	const parsed = JSON.parse(readFileSync(path, "utf8"));
	if (parsed.version !== LOCKFILE_VERSION) {
		throw new Error(
			`${path} is version ${parsed.version}; this tool writes version ${LOCKFILE_VERSION}`,
		);
	}
	return parsed;
}

/** Sorted by ID so the file is stable and diffs stay readable. */
export function writeLockfile(
	lockfile,
	{ path = LOCKFILE_PATH, updatedAt } = {},
) {
	const sorted = {
		version: LOCKFILE_VERSION,
		updatedAt: updatedAt ?? lockfile.updatedAt ?? null,
		selections: [...lockfile.selections].sort((a, b) =>
			a.id.localeCompare(b.id),
		),
	};
	writeFileSync(path, `${JSON.stringify(sorted, null, "\t")}\n`);
	return sorted;
}

const HEX_64 = /^[0-9a-f]{64}$/;
const SELECTION_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Validate the lockfile against the source registry and the section 3 rights
 * policy. Runs in CI, so an unreviewed or wrongly-licensed selection cannot sit
 * in the repository waiting for someone to run the fetcher.
 *
 * @returns {string[]} errors; empty means the lockfile is shippable
 */
export function validateLockfile(lockfile) {
	const errors = [];
	if (lockfile.version !== LOCKFILE_VERSION) {
		errors.push(`lockfile version must be ${LOCKFILE_VERSION}`);
	}
	if (!Array.isArray(lockfile.selections)) {
		return [...errors, "lockfile.selections must be an array"];
	}

	const seenIds = new Set();
	const seenHashes = new Map();
	const perSource = {};

	for (const selection of lockfile.selections) {
		const where = selection?.id ?? "<selection with no id>";

		if (!selection?.id || !SELECTION_ID.test(selection.id)) {
			errors.push(`${where}: selection id must be kebab-case`);
		}
		if (seenIds.has(selection?.id))
			errors.push(`${where}: duplicate selection id`);
		seenIds.add(selection?.id);

		const source = findSource(selection?.sourceId);
		if (!source) {
			errors.push(
				`${where}: unknown source "${selection?.sourceId}" — add it to sources.mjs first`,
			);
			continue;
		}
		perSource[source.id] = (perSource[source.id] ?? 0) + 1;

		// Rights first: this is the check that keeps unbundleable audio out.
		const rejection = licenseRejectionReason(source.licenseId);
		if (rejection) errors.push(`${where}: source ${source.id} ${rejection}`);

		for (const field of [
			"downloadUrl",
			"sourcePageUrl",
			"creator",
			"originalFilename",
			"retrievedAt",
			"reviewer",
		]) {
			if (!selection?.[field])
				errors.push(`${where}: ${field} is required (section 3.4)`);
		}
		if (!HEX_64.test(selection?.sha256 ?? "")) {
			errors.push(
				`${where}: sha256 must be the SHA-256 of the downloaded bytes`,
			);
		}
		if (!(selection?.bytes > 0))
			errors.push(`${where}: bytes must be positive`);
		if (
			selection?.archiveMember &&
			!HEX_64.test(selection?.memberSha256 ?? "")
		) {
			errors.push(`${where}: an archive selection must pin memberSha256 too`);
		}

		// A pin is a record that a person looked at the file. Without a named
		// reviewer the lockfile is just a download list.
		if (selection?.reviewer === "unreviewed") {
			errors.push(`${where}: reviewer is still "unreviewed"`);
		}

		const identity = selection?.memberSha256 ?? selection?.sha256;
		if (identity && seenHashes.has(identity)) {
			errors.push(`${where}: byte-identical to ${seenHashes.get(identity)}`);
		}
		if (identity) seenHashes.set(identity, selection.id);

		const asset = selection?.asset;
		if (!asset) {
			errors.push(`${where}: asset mapping is required`);
		} else {
			for (const field of [
				"family",
				"role",
				"name",
				"intensity",
				"sourceType",
			]) {
				if (!asset[field]) errors.push(`${where}: asset.${field} is required`);
			}
			if (!asset.genres?.length)
				errors.push(`${where}: at least one genre tag is required`);
			if (!asset.characters?.length)
				errors.push(`${where}: at least one character tag is required`);
			// Acquired audio is never `synthesized` — that value is what
			// distinguishes the generated library in the manifest and in the
			// section 6.4 organic-source measurement.
			if (asset.sourceType === "synthesized") {
				errors.push(
					`${where}: acquired audio cannot claim sourceType "synthesized"`,
				);
			}
		}
	}

	for (const [sourceId, count] of Object.entries(perSource)) {
		const source = findSource(sourceId);
		if (source && count > source.maxSelections) {
			errors.push(
				`source ${sourceId} has ${count} selections, over its ${source.maxSelections} ceiling (section 14)`,
			);
		}
	}

	return errors;
}

export function selectionsBySource(lockfile) {
	const grouped = {};
	for (const selection of lockfile.selections) {
		if (!grouped[selection.sourceId]) grouped[selection.sourceId] = [];
		grouped[selection.sourceId].push(selection);
	}
	return grouped;
}
