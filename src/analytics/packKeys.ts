// Pack identity as an analytics value (PRD `OPS-02`).
//
// "Which packs are most popular?" needs an event that names *which* pack was
// added, not only what sort of pack it was. That is safe to log, but only for
// one specific class of pack: a **published factory pack** is library content
// we ship and already describe publicly, so its identity is a product fact,
// not a user's. A user-authored or third-party pack is the opposite — its ID
// or name is user content — and this module makes that distinction structural
// rather than a rule a call site has to remember: anything not in the pinned
// factory table below reports the shared `"other"` key.
//
// The keys are the library's stable pack *slugs* (`scripts/starter-library/
// packs.mjs`), not their `pak_` IDs, so a GA4 report reads as
// `core-electronic-drums` rather than an opaque token, and so a pack rename
// cannot rewrite analytics history — the slug is frozen alongside the ID.
//
// Pinned here rather than read from the library for the same reason
// `COMMAND_IDS` and the `project_created.genre` set are pinned: an analytics
// parameter's value set is a published contract that saved GA4 explorations
// depend on. `packKeys.test.ts` asserts this table matches the library's
// published packs exactly, so a pack added to the library fails the suite
// until it has been given an analytics decision.

/** The analytics key for each published factory pack, plus the catch-all. */
export const LIBRARY_PACK_KEYS = [
	"core-electronic-drums",
	"foundation-bass",
	"tonal-elements",
	"ambient-textures",
	"transitions-fx",
	"cc0-community",
	/** Any pack that is not a published factory pack. Never its ID or name. */
	"other",
] as const;
export type LibraryPackKey = (typeof LIBRARY_PACK_KEYS)[number];

/**
 * What sort of pack was added. `unknown` is the honest answer when a pack is
 * identified only by the `PackDependency` a `pack.add` command carries: that
 * is an ID and a version, and nothing in project state says whether an
 * unrecognized pack is the user's own or a third party's.
 */
export const PACK_KINDS = [
	"factory",
	"user",
	"third_party",
	"unknown",
] as const;
export type PackKind = (typeof PACK_KINDS)[number];

/**
 * Published factory pack IDs, frozen in the library pipeline (`packs.mjs` —
 * "a pack's id is permanent and never derived from its renameable name or
 * slug"), mapped onto their analytics key.
 */
// A `Map`, not an object literal: the lookup key is an arbitrary runtime
// string, and an object would answer `"toString"` with an inherited function.
const FACTORY_PACK_KEY_BY_ID = new Map<string, LibraryPackKey>([
	["pak_SdlN_OazweXrwury0j27Y", "core-electronic-drums"],
	["pak_FH8gyASzYiWGCrtpKZ-Ho", "foundation-bass"],
	["pak_RznkYK7KIIo7BOZQZ_i0O", "tonal-elements"],
	["pak_gUou3hBgXF47EwgR-9gZ1", "ambient-textures"],
	["pak_PrUvdIGkCE3uRGYeKOGRg", "transitions-fx"],
	["pak_5o6qI8YY27cYVyqstlJyG", "cc0-community"],
]);

/** Every factory pack ID this table knows, for the library drift test. */
export function knownFactoryPackIds(): readonly string[] {
	return [...FACTORY_PACK_KEY_BY_ID.keys()];
}

/**
 * The `library_pack_added` parameters for one pack, by ID alone.
 *
 * An unrecognized ID — a user pack, a third-party pack, or a factory pack
 * published after this table was last updated — degrades to
 * `{ pack_key: "other", pack_kind: "unknown" }`. It is never echoed back.
 */
export function libraryPackAnalytics(packId: string): {
	pack_key: LibraryPackKey;
	pack_kind: PackKind;
} {
	const key = FACTORY_PACK_KEY_BY_ID.get(packId);
	return key
		? { pack_key: key, pack_kind: "factory" }
		: { pack_key: "other", pack_kind: "unknown" };
}
