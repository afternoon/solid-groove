import type { JsonValue } from "../domain/serialize";

/**
 * Firestore document size accounting and the schema-v1 size budgets.
 *
 * Firestore rejects any document over 1 MiB, and it measures a document with
 * its own rules rather than by the length of its JSON encoding. This module
 * reimplements those documented rules so a budget assertion means what it
 * says, instead of comparing against a proxy that drifts from the real limit:
 *
 * - document size = document-name size + every field name and value + 32 bytes
 * - name segment  = UTF-8 bytes of the segment + 1, plus 16 bytes for the name
 * - string        = UTF-8 bytes + 1
 * - number        = 8 bytes (Firestore stores every JS number as a 64-bit value)
 * - boolean       = 1 byte
 * - null          = 1 byte
 * - array         = the sum of its values
 * - map           = the sum of each key (UTF-8 bytes + 1) and its value
 *
 * See https://firebase.google.com/docs/firestore/storage-size.
 */

/** Firestore's hard per-document limit. A larger write is always rejected. */
export const FIRESTORE_DOCUMENT_LIMIT_BYTES = 1_048_576;

/**
 * The schema-v1 song-document budget (`FND-004` owns this number).
 *
 * 256 KiB is a quarter of Firestore's hard limit. The headroom is deliberate:
 * the song document holds the structural state a project keeps growing (tracks,
 * device chains, sections, return buses), so a budget close to the hard limit
 * would leave a project one arrangement edit away from an unwritable document.
 * Exceeding this budget is not an error — it is the trigger for moving
 * per-track arrangement content into `arrangement/{trackId}` chunks.
 */
export const SONG_DOCUMENT_BUDGET_BYTES = 262_144;

/**
 * The budget for one `arrangement/{trackId}` chunk. Same number as the song
 * budget: a chunk holds one track's placements and automation, which is the
 * smallest unit this schema can split, so the budget exists to detect a track
 * that has outgrown the layout rather than to trigger a further split.
 */
export const ARRANGEMENT_CHUNK_BUDGET_BYTES = 262_144;

/** The budget for one `clips/{clipId}` document — the highest-frequency write. */
export const CLIP_DOCUMENT_BUDGET_BYTES = 262_144;

const utf8 = new TextEncoder();

function utf8Bytes(value: string): number {
	return utf8.encode(value).length;
}

/** Size of one Firestore field value, in Firestore's own accounting. */
export function estimateFirestoreValueBytes(value: JsonValue): number {
	if (value === null) return 1;
	if (typeof value === "boolean") return 1;
	if (typeof value === "number") return 8;
	if (typeof value === "string") return utf8Bytes(value) + 1;
	if (Array.isArray(value)) {
		return value.reduce<number>(
			(total, entry) => total + estimateFirestoreValueBytes(entry),
			0,
		);
	}
	return Object.entries(value).reduce(
		(total, [key, entry]) =>
			total + utf8Bytes(key) + 1 + estimateFirestoreValueBytes(entry),
		0,
	);
}

/** Size of a document name (its full path), in Firestore's own accounting. */
export function estimateDocumentNameBytes(path: string): number {
	return (
		path
			.split("/")
			.filter((segment) => segment.length > 0)
			.reduce((total, segment) => total + utf8Bytes(segment) + 1, 0) + 16
	);
}

/** Total stored size of one document: name, fields, and per-document overhead. */
export function estimateDocumentBytes(
	path: string,
	data: Readonly<Record<string, JsonValue>>,
): number {
	return (
		estimateDocumentNameBytes(path) + estimateFirestoreValueBytes(data) + 32
	);
}
