import type { LibraryAsset } from "./manifest";
import { matchesLibraryQuery } from "./search";

/**
 * The pack -> group -> asset tree the library *panel* renders (LOOP-013).
 *
 * The panel is a narrow, always-available column beside the workspace, so it
 * shows the packs a project has added rather than the whole catalogue, and it
 * shows each pack's own structure rather than a flat list: a pack's assets
 * already carry the `family`/`role` taxonomy the generator authored them with
 * (`scripts/starter-library/taxonomy.mjs`), so "kicks / claps / closed hats" is
 * derivable here instead of needing new manifest metadata.
 *
 * One group level, not two. Family and role are two levels in the taxonomy, but
 * a pack is family-scoped in practice (Core Electronic Drums is all `drums`),
 * so a family level would be a single node wrapping everything. Instead the
 * group *is* the role, and the family only appears as a prefix when a pack
 * actually spans more than one — which keeps the tree three levels deep at the
 * most and readable at ~250px.
 *
 * Everything here is pure over already-loaded assets, so the panel's search is
 * a memo rather than a fetch, and the shape is unit-tested without a DOM.
 */

/** One role group inside a pack, e.g. "Kicks" with its 12 assets. */
export interface LibraryTreeGroup {
	/** Stable across renders and unique across packs — the expansion key. */
	readonly key: string;
	readonly label: string;
	readonly family: string;
	readonly role: string;
	readonly assets: readonly LibraryAsset[];
}

/** One pack node: the top level of the panel tree. */
export interface LibraryTreePack {
	readonly packId: string;
	readonly slug: string;
	readonly name: string;
	/**
	 * What the pack index claims the pack holds. Shown before the manifest is
	 * fetched, so a collapsed pack still says how big it is without loading it.
	 */
	readonly assetCount: number;
	/** True once this pack's manifest has been fetched. */
	readonly loaded: boolean;
	/** True when this pack's manifest failed to load (LIB-05 isolation). */
	readonly failed: boolean;
	/** Assets matching the current query, grouped by role. */
	readonly groups: readonly LibraryTreeGroup[];
	/** How many assets matched the query — the count the node badges. */
	readonly matchCount: number;
}

/** The pack facts the tree needs, satisfied by a `LibraryPackSummary`. */
export interface TreePackInput {
	readonly id: string;
	readonly slug: string;
	readonly name: string;
	readonly assetCount: number;
}

export interface BuildLibraryTreeOptions {
	/** Packs to show, in the order they should appear. */
	readonly packs: readonly TreePackInput[];
	/** Assets already loaded, keyed by pack slug. A missing key means "not loaded". */
	readonly assetsByPack: ReadonlyMap<string, readonly LibraryAsset[]>;
	/** Slugs whose manifest failed to load. */
	readonly failedSlugs?: readonly string[];
	/** Free-text filter applied to every loaded asset. */
	readonly query?: string;
}

/**
 * Build the panel tree.
 *
 * A pack with no loaded manifest still appears — collapsed, with the index's
 * asset count — so the tree lists what the project depends on before any
 * network work happens and expanding is what triggers the fetch (LIB-05's lazy
 * load order). A pack whose manifest failed appears too, marked `failed`, so a
 * broken pack is visible and retryable rather than silently absent.
 */
export function buildLibraryTree(
	options: BuildLibraryTreeOptions,
): LibraryTreePack[] {
	const failed = new Set(options.failedSlugs ?? []);
	const needle = (options.query ?? "").trim().toLowerCase();
	return options.packs.map((pack) => {
		const loadedAssets = options.assetsByPack.get(pack.slug);
		const matched = (loadedAssets ?? []).filter((asset) =>
			matchesLibraryQuery(asset, needle),
		);
		return {
			packId: pack.id,
			slug: pack.slug,
			name: pack.name,
			assetCount: pack.assetCount,
			loaded: loadedAssets !== undefined,
			failed: failed.has(pack.slug),
			groups: groupByRole(pack.slug, matched),
			matchCount: matched.length,
		};
	});
}

/** Group a pack's assets by role, prefixing the family when the pack spans several. */
function groupByRole(
	packSlug: string,
	assets: readonly LibraryAsset[],
): LibraryTreeGroup[] {
	const families = new Set(assets.map((asset) => asset.family));
	const multiFamily = families.size > 1;
	const byKey = new Map<string, LibraryAsset[]>();
	for (const asset of assets) {
		const key = `${asset.family}/${asset.role}`;
		const group = byKey.get(key);
		if (group) group.push(asset);
		else byKey.set(key, [asset]);
	}
	return [...byKey.entries()]
		.map(([key, groupAssets]) => {
			const [family, role] = key.split("/");
			return {
				key: `${packSlug}:${key}`,
				label: groupLabel(family, role, multiFamily),
				family,
				role,
				assets: [...groupAssets].sort((a, b) => a.name.localeCompare(b.name)),
			};
		})
		.sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Words the plural rule must leave alone. A role is a controlled vocabulary
 * term, so this stays a short, explicit list rather than a general pluralizer:
 * "percussion" is already a mass noun and "Percussions" reads as a mistake.
 */
const UNCOUNTABLE_ROLES = new Set(["percussion", "bass", "ambience"]);

/** "closed-hat" -> "Closed hats"; with a family prefix when the pack spans several. */
export function groupLabel(
	family: string,
	role: string,
	multiFamily: boolean,
): string {
	const label = pluralize(humanize(role));
	return multiFamily ? `${humanize(family)} · ${label}` : label;
}

function humanize(value: string): string {
	const words = value.split("-").join(" ");
	return words.charAt(0).toUpperCase() + words.slice(1);
}

function pluralize(label: string): string {
	const lastWord = label.split(" ").at(-1)?.toLowerCase() ?? "";
	if (lastWord.endsWith("s") || UNCOUNTABLE_ROLES.has(lastWord)) return label;
	return `${label}s`;
}
