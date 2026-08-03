import type { LibraryAsset, LibraryAssetType } from "./manifest";

/**
 * Local search and filtering over already-loaded library assets (PRD LIB-01,
 * LIB-02; sample-library section 12: "The library manifest can be searched
 * locally after a compact metadata fetch; search must not enumerate Cloud
 * Storage objects").
 *
 * Every function here is pure over an asset array, so it is cheap to memoize in
 * the UI and trivial to benchmark: the section 12 target is a filter response
 * below 50 ms for 1,000 assets, and a pure array pass over pre-normalized text
 * is what keeps that true. The filters are independent facets — a text query, a
 * pack, and any number of genre/role/character/type values — combined with AND
 * across facets and OR within a facet, which is the behavior the AC pins:
 * clearing the pack facet never removes an asset the other facets still admit,
 * and clearing the genre facet exposes everything again.
 */

export interface LibraryFilter {
	/** Free-text query, matched case-insensitively against name/role/family/pack. */
	readonly query: string;
	/** Restrict to one pack by slug, or `null` for every available pack. */
	readonly packSlug: string | null;
	readonly genres: readonly string[];
	readonly roles: readonly string[];
	readonly characters: readonly string[];
	readonly types: readonly LibraryAssetType[];
}

export const EMPTY_FILTER: LibraryFilter = {
	query: "",
	packSlug: null,
	genres: [],
	roles: [],
	characters: [],
	types: [],
};

/** True when no facet is active — the browser is showing everything. */
export function isEmptyFilter(filter: LibraryFilter): boolean {
	return (
		filter.query.trim() === "" &&
		filter.packSlug === null &&
		filter.genres.length === 0 &&
		filter.roles.length === 0 &&
		filter.characters.length === 0 &&
		filter.types.length === 0
	);
}

/** Does the filter constrain by genre? Drives `library_audition.had_genre_filter`. */
export function hasGenreFilter(filter: LibraryFilter): boolean {
	return filter.genres.length > 0;
}

function matchesQuery(asset: LibraryAsset, needle: string): boolean {
	if (needle === "") return true;
	// A single lowered haystack per asset, matched by substring. Cheap enough for
	// the section 12 target; a name/role/family/pack hit is all a producer needs
	// to find a sound without knowing the taxonomy.
	return (
		asset.name.toLowerCase().includes(needle) ||
		asset.role.toLowerCase().includes(needle) ||
		asset.family.toLowerCase().includes(needle) ||
		asset.packName.toLowerCase().includes(needle)
	);
}

function matchesAny(
	values: readonly string[],
	have: readonly string[],
): boolean {
	if (values.length === 0) return true;
	return values.some((value) => have.includes(value));
}

/**
 * The assets that satisfy every active facet.
 *
 * Facets combine with AND; values within a facet with OR. A `packSlug` of
 * `null` admits every pack, so clearing the pack filter can only widen the
 * result — it never hides an asset the remaining facets still match (LIB-05).
 */
export function filterAssets(
	assets: readonly LibraryAsset[],
	filter: LibraryFilter,
): LibraryAsset[] {
	const needle = filter.query.trim().toLowerCase();
	return assets.filter(
		(asset) =>
			(filter.packSlug === null || asset.packSlug === filter.packSlug) &&
			(filter.types.length === 0 || filter.types.includes(asset.type)) &&
			matchesAny(filter.roles, [asset.role]) &&
			matchesAny(filter.genres, asset.genres) &&
			matchesAny(filter.characters, asset.characters) &&
			matchesQuery(asset, needle),
	);
}

/** The sorted, deduplicated set of a facet's values across the given assets. */
function collect(
	assets: readonly LibraryAsset[],
	pick: (asset: LibraryAsset) => readonly string[],
): string[] {
	const seen = new Set<string>();
	for (const asset of assets) for (const value of pick(asset)) seen.add(value);
	return [...seen].sort();
}

/**
 * The facet values worth offering, computed from the assets actually present.
 *
 * Offering only the genres/roles/characters that some loaded asset carries
 * keeps a filter control from listing a value that would return nothing, and
 * means the control set grows naturally as more packs load.
 */
export interface FacetValues {
	readonly genres: string[];
	readonly roles: string[];
	readonly characters: string[];
	readonly types: LibraryAssetType[];
}

export function facetValues(assets: readonly LibraryAsset[]): FacetValues {
	return {
		genres: collect(assets, (asset) => asset.genres),
		roles: collect(assets, (asset) => [asset.role]),
		characters: collect(assets, (asset) => asset.characters),
		types: collect(assets, (asset) => [asset.type]) as LibraryAssetType[],
	};
}
