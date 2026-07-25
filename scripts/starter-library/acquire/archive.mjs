// Archive extraction.
//
// The tier-1 sources ship packs, not loose files, so ingestion has to reach
// inside one. Only the member named by a lockfile selection is extracted —
// there is no "extract everything and see what we got", because that is how a
// vocal or an unlicensed file ends up in a manifest nobody meant to put it in.

import { unzipSync } from "fflate";

/** Extensions we can open. Anything else fails with an actionable message. */
export const SUPPORTED_ARCHIVES = [".zip"];

export function isArchive(filename) {
	return SUPPORTED_ARCHIVES.some((extension) =>
		filename.toLowerCase().endsWith(extension),
	);
}

/**
 * Some sources distribute `.tar.bz2`. Node ships zlib (gzip/deflate) but no
 * bzip2, so rather than pull in a decompressor for a format we may never need,
 * this says so plainly and the selection can point at the zip mirror instead.
 */
export function unsupportedArchiveReason(filename) {
	const lowered = filename.toLowerCase();
	if (isArchive(lowered)) return null;
	if (/\.(tar\.bz2|tbz2|bz2)$/.test(lowered)) {
		return "bzip2 archives are not supported (Node has no bzip2); pin the .zip distribution instead";
	}
	if (/\.(tar\.gz|tgz|tar|7z|rar)$/.test(lowered)) {
		return `${lowered.split(".").pop()} archives are not supported; pin the .zip distribution instead`;
	}
	return null;
}

/**
 * List the members of a zip, so `--pin` can show a reviewer what is inside a
 * pack without extracting or ingesting any of it.
 */
export function listArchiveMembers(bytes) {
	const entries = unzipSync(new Uint8Array(bytes));
	return Object.entries(entries)
		.filter(([name]) => !name.endsWith("/"))
		.map(([name, content]) => ({ name, bytes: content.length }))
		.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Extract exactly one member.
 *
 * The member path is matched literally. Zip entries can contain `..` and
 * absolute paths, and a fuzzy match would let an archive decide which file it
 * hands back; a literal match against a pinned name cannot.
 */
export function extractMember(bytes, memberPath) {
	const entries = unzipSync(new Uint8Array(bytes));
	const content = entries[memberPath];
	if (!content) {
		const available = Object.keys(entries).filter(
			(name) => !name.endsWith("/"),
		);
		const hint =
			available.length > 20
				? `${available.slice(0, 20).join(", ")}, ... (${available.length} total)`
				: available.join(", ");
		throw new Error(
			`archive has no member "${memberPath}". Available: ${hint}`,
		);
	}
	return Buffer.from(content);
}
