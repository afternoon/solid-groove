/**
 * Content fingerprints for change detection (PRD section 9.3: "The projection
 * exposes revision counters at song, track, clip, asset, and automation
 * granularity so unrelated edits do not invalidate all cached geometry").
 *
 * Schema-v1 (`src/domain`) has one project-wide revision counter
 * (`metadata.revision`) and deliberately no per-track/per-clip counters —
 * adding those would be a domain-schema change, which is FND-002's contract,
 * not incidental work for this task. A deterministic content fingerprint
 * gives every projection the same guarantee (unrelated edits produce the same
 * fingerprint; any relevant edit produces a different one) without touching
 * the stored schema: two calls fingerprinting the same relevant fields always
 * agree, so a projection builder can compare a fingerprint against the
 * previous build and reuse the previous object when they match.
 */

/**
 * Stable JSON text for a plain value: object keys are written in sorted
 * order at every nesting depth regardless of insertion order, so two
 * structurally-equal values always produce byte-identical text. Arrays are
 * written in the given order — a caller with an order-insensitive collection
 * (e.g. a device chain that should be compared by an `order` field rather
 * than array position) must sort it before calling this.
 */
export function stableStringify(value: unknown): string {
	return JSON.stringify(value, sortObjectKeys);
}

function sortObjectKeys(_key: string, value: unknown): unknown {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		return value;
	}
	const sorted: Record<string, unknown> = {};
	for (const key of Object.keys(value as Record<string, unknown>).sort()) {
		sorted[key] = (value as Record<string, unknown>)[key];
	}
	return sorted;
}

/** FNV-1a, 32-bit. Not cryptographic — only used to shorten a fingerprint key. */
function fnv1a(text: string): number {
	let hash = 0x811c9dc5;
	for (let index = 0; index < text.length; index += 1) {
		hash ^= text.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

/**
 * A short, deterministic fingerprint for `value`. Equal relevant fields
 * always produce an equal fingerprint; this is the "revision/change
 * information" every projection in this module exposes.
 */
export function fingerprintOf(value: unknown): string {
	return fnv1a(stableStringify(value)).toString(36);
}
