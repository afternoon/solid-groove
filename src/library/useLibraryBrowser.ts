import {
	type Accessor,
	batch,
	createMemo,
	createSignal,
	onCleanup,
} from "solid-js";
import {
	type Analytics,
	analytics as defaultAnalytics,
} from "../analytics/analytics";
import { toErrorCode } from "../analytics/errorCodes";
import { packAnalyticsIdentity } from "../analytics/packIdentity";
import type { PreviewEngine } from "./audition";
import { AuditionController } from "./audition";
import {
	LibraryClient,
	type LibraryLoadReason,
	type PackLoadError,
} from "./libraryClient";
import type { LibraryAsset, LibraryPackSummary } from "./manifest";
import {
	EMPTY_FILTER,
	type FacetValues,
	facetValues,
	filterAssets,
	hasGenreFilter,
	type LibraryFilter,
} from "./search";
import { buildLibraryTree, type LibraryTreePack } from "./tree";

/**
 * The reactive brain of the library browser (PRD LIB-01, LIB-05; LOOP-013).
 *
 * It owns the lazy load order — the pack index first, then a pack's manifest on
 * demand — the filter facets, the search results, and the one-preview-at-a-time
 * audition, and it emits the LOOP-013 analytics. The `LibraryBrowser` component
 * is a thin view over this: the load/filter/audition *logic* lives here so it is
 * testable without a DOM, and the component only renders the state it exposes.
 *
 * Audition is disposed on cleanup, so leaving the browser (close, navigation, or
 * the owning component unmounting on project teardown) stops any preview and
 * releases its runtime scope — the AC's "stops on ... close, navigation, or
 * project teardown".
 */

/** A pack that failed to load, as the browser surfaces it. */
export interface PackErrorState {
	readonly packId: string;
	readonly packSlug: string;
	readonly reason: LibraryLoadReason;
}

export interface LibraryBrowserState {
	readonly packs: Accessor<readonly LibraryPackSummary[]>;
	readonly indexLoading: Accessor<boolean>;
	readonly indexError: Accessor<LibraryLoadReason | null>;
	/** The pack whose contents are shown, or `null` for "all available packs". */
	readonly selectedPackSlug: Accessor<string | null>;
	readonly assetsLoading: Accessor<boolean>;
	readonly assets: Accessor<readonly LibraryAsset[]>;
	readonly results: Accessor<readonly LibraryAsset[]>;
	readonly facets: Accessor<FacetValues>;
	readonly filter: Accessor<LibraryFilter>;
	/** Packs that failed to load, isolated from the ones that did. */
	readonly packErrors: Accessor<readonly PackErrorState[]>;
	/** The asset whose preview is currently audible, or `null`. */
	readonly auditioningId: Accessor<string | null>;
	/** Assets whose audition failed, keyed by id, for a per-row error badge. */
	readonly assetErrors: Accessor<ReadonlyMap<string, string>>;
	/** The panel tree: the project's packs, their role groups, their assets. */
	readonly tree: Accessor<readonly LibraryTreePack[]>;
	/** The panel tree's own free-text filter, independent of the modal's. */
	readonly treeQuery: Accessor<string>;
	/** Whether a tree node (pack slug or group key) is expanded. */
	readonly isExpanded: (key: string) => boolean;
	/** The packs the project has added, in index order. */
	readonly addedPacks: Accessor<readonly LibraryPackSummary[]>;
}

export interface LibraryBrowserControls extends LibraryBrowserState {
	/** Fetch the pack index (idempotent) — call when the browser opens. */
	open(): Promise<void>;
	/** Show one pack's contents, lazily loading its manifest. */
	selectPack(slug: string | null): Promise<void>;
	setQuery(query: string): void;
	toggleGenre(genre: string): void;
	toggleRole(role: string): void;
	toggleCharacter(character: string): void;
	toggleType(type: LibraryFilter["types"][number]): void;
	clearFilters(): void;
	/** Audition an asset (stops any current preview). */
	audition(asset: LibraryAsset): Promise<void>;
	/** Stop the current preview. */
	stopAudition(): void;
	setTreeQuery(query: string): void;
	/** Expand/collapse a pack node, lazily loading its manifest on first expand. */
	togglePackNode(slug: string): Promise<void>;
	/** Expand/collapse a role group inside a pack. */
	toggleGroupNode(key: string): void;
	/** Add a pack to the project and load its manifest (emits `library_pack_added`). */
	addPack(pack: LibraryPackSummary): Promise<void>;
	/** Retry a pack whose manifest failed to load. */
	retryPack(pack: LibraryPackSummary): Promise<void>;
}

export interface UseLibraryBrowserOptions {
	readonly client?: LibraryClient;
	/** The audio engine audition plays through. Omit only in a headless test. */
	readonly previewEngine?: PreviewEngine;
	readonly analytics?: Analytics;
	/**
	 * The packs the open project has added, as pack IDs — the panel tree's top
	 * level. Read reactively, so adding a pack in the pack browser re-renders the
	 * tree without this controller owning project state.
	 */
	readonly addedPackIds?: Accessor<readonly string[]>;
	/**
	 * Called when the user adds a pack in the pack browser. The *project's* record
	 * of its packs belongs to the editor (and, eventually, to a command); the
	 * browser only reports the choice, exactly as `onInsert` does for an asset.
	 */
	readonly onAddPack?: (pack: LibraryPackSummary) => void;
}

export function useLibraryBrowser(
	options: UseLibraryBrowserOptions = {},
): LibraryBrowserControls {
	const client = options.client ?? new LibraryClient();
	const analytics = options.analytics ?? defaultAnalytics;

	const [packs, setPacks] = createSignal<readonly LibraryPackSummary[]>([]);
	const [indexLoading, setIndexLoading] = createSignal(false);
	const [indexError, setIndexError] = createSignal<LibraryLoadReason | null>(
		null,
	);
	const [selectedPackSlug, setSelectedPackSlug] = createSignal<string | null>(
		null,
	);
	const [assetsLoading, setAssetsLoading] = createSignal(false);
	/** Every asset loaded so far, keyed by pack slug so a pack loads once. */
	const [loadedByPack, setLoadedByPack] = createSignal<
		ReadonlyMap<string, readonly LibraryAsset[]>
	>(new Map());
	const [packErrors, setPackErrors] = createSignal<readonly PackErrorState[]>(
		[],
	);
	const [filter, setFilter] = createSignal<LibraryFilter>(EMPTY_FILTER);
	const [assetErrors, setAssetErrors] = createSignal<
		ReadonlyMap<string, string>
	>(new Map());
	const [auditioningId, setAuditioningId] = createSignal<string | null>(null);
	const [treeQuery, setTreeQuerySignal] = createSignal("");
	const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set());

	// One first-use signal per browser session (PRD OPS-02). Emitted the first
	// time the browser is opened, not per open, so it measures adoption.
	analytics.logFeatureFirstUse("library_browser");

	const audition = options.previewEngine
		? new AuditionController(options.previewEngine, {
				onActiveChange: (id) => setAuditioningId(id),
				onError: (asset, error) => {
					setAssetErrors((prev) => new Map(prev).set(asset.id, error.reason));
					analytics.log("asset_load_failed", {
						asset_type: analyticsAssetType(asset),
						error_code: toErrorCode(error.reason),
					});
				},
			})
		: null;

	if (audition) onCleanup(() => void audition.dispose());

	/**
	 * The assets in scope: one pack when a pack is selected, otherwise every
	 * pack that has loaded. Selecting "all packs" shows a union, so clearing a
	 * pack filter can only widen the set — never hides a reachable asset (LIB-05).
	 */
	const assets = createMemo<readonly LibraryAsset[]>(() => {
		const slug = selectedPackSlug();
		const loaded = loadedByPack();
		if (slug !== null) return loaded.get(slug) ?? [];
		return [...loaded.values()].flat();
	});

	const results = createMemo(() => filterAssets(assets(), filter()));
	const facets = createMemo(() => facetValues(assets()));

	/**
	 * The packs the project has added, resolved against the index. Matching is by
	 * pack *id* rather than slug because that is what a project records
	 * (`metadata.packDependencies`), and a slug is a URL convenience that a rename
	 * may change while the id never does (sample-library section 5.1).
	 */
	const addedPacks = createMemo<readonly LibraryPackSummary[]>(() => {
		const wanted = new Set(options.addedPackIds?.() ?? []);
		return packs().filter((pack) => wanted.has(pack.id));
	});

	/**
	 * One pack's index entry by slug, or `undefined` before the index has loaded
	 * (or for an asset whose pack is no longer listed). Analytics resolves a
	 * pack's kind through this: a `LibraryAsset` carries its pack's slug but not
	 * whether that pack is published, and only the published entry may authorize
	 * naming it.
	 */
	function packBySlug(slug: string): LibraryPackSummary | undefined {
		return packs().find((candidate) => candidate.slug === slug);
	}

	const tree = createMemo<readonly LibraryTreePack[]>(() =>
		buildLibraryTree({
			packs: addedPacks(),
			assetsByPack: loadedByPack(),
			failedSlugs: packErrors().map((error) => error.packSlug),
			query: treeQuery(),
		}),
	);

	async function open(): Promise<void> {
		if (packs().length > 0 || indexLoading()) return;
		setIndexLoading(true);
		setIndexError(null);
		try {
			const summaries = await client.loadIndex();
			setPacks(summaries);
			// Open the project's first pack so the panel shows sounds immediately
			// rather than a row of collapsed nodes. That fetches exactly one pack's
			// manifest — still the index plus one pack, never every pack's metadata
			// (sample-library section 12). A project with no packs fetches nothing
			// beyond the index.
			const first = addedPacks()[0];
			if (first) await togglePackNode(first.slug);
		} catch (error) {
			setIndexError(reasonOfIndexError(error));
		} finally {
			setIndexLoading(false);
		}
	}

	/** Load one pack's manifest into `loadedByPack`, recording any failure. */
	async function loadPack(summary: LibraryPackSummary): Promise<void> {
		if (loadedByPack().has(summary.slug)) return;
		const result = await client.loadPack(summary);
		if (result.ok) {
			setLoadedByPack((prev) => new Map(prev).set(summary.slug, result.assets));
		} else {
			recordPackError(result.error);
		}
	}

	function recordPackError(error: PackLoadError): void {
		setPackErrors((prev) => {
			if (prev.some((existing) => existing.packId === error.packId))
				return prev;
			return [
				...prev,
				{
					packId: error.packId,
					packSlug: error.packSlug,
					reason: error.reason,
				},
			];
		});
	}

	async function selectPack(slug: string | null): Promise<void> {
		setSelectedPackSlug(slug);
		// Selecting a pack narrows the pack facet to it; "all packs" clears it.
		setFilter((prev) => ({ ...prev, packSlug: slug }));
		setAssetsLoading(true);
		try {
			if (slug === null) {
				// Cross-pack search needs every pack's manifest; load the ones that
				// have not loaded yet, isolating any that fail.
				await Promise.all(packs().map((summary) => loadPack(summary)));
			} else {
				const summary = packs().find((candidate) => candidate.slug === slug);
				if (summary) await loadPack(summary);
			}
		} finally {
			setAssetsLoading(false);
		}
	}

	function setQuery(query: string): void {
		setFilter((prev) => ({ ...prev, query }));
	}

	function toggleValue(
		key: "genres" | "roles" | "characters",
		value: string,
	): void {
		setFilter((prev) => {
			const have = prev[key];
			const next = have.includes(value)
				? have.filter((existing) => existing !== value)
				: [...have, value];
			return { ...prev, [key]: next };
		});
	}

	function toggleType(type: LibraryFilter["types"][number]): void {
		setFilter((prev) => {
			const next = prev.types.includes(type)
				? prev.types.filter((existing) => existing !== type)
				: [...prev.types, type];
			return { ...prev, types: next };
		});
	}

	function clearFilters(): void {
		// Keep the selected pack; clearing *filters* must not silently jump the
		// user out of the pack they opened. Clearing genres/roles/etc. re-exposes
		// every asset the current pack scope holds (LIB-02).
		batch(() =>
			setFilter((prev) => ({ ...EMPTY_FILTER, packSlug: prev.packSlug })),
		);
	}

	async function auditionAsset(asset: LibraryAsset): Promise<void> {
		if (!audition) return;
		// Clear any prior error for this asset before a fresh attempt.
		setAssetErrors((prev) => {
			if (!prev.has(asset.id)) return prev;
			const next = new Map(prev);
			next.delete(asset.id);
			return next;
		});
		analytics.log("library_audition", {
			asset_type: analyticsAssetType(asset),
			had_genre_filter: hasGenreFilter(filter()),
			// The pack's *published* identity, resolved from the index rather than
			// taken from the asset: only the index says whether this pack is one
			// anyone may be told about (see `packAnalyticsIdentity`).
			...packAnalyticsIdentity(packBySlug(asset.packSlug)),
		});
		await audition.play(asset);
	}

	function stopAudition(): void {
		audition?.stop();
	}

	// -----------------------------------------------------------------------
	// The panel tree
	// -----------------------------------------------------------------------

	function isExpanded(key: string): boolean {
		return expanded().has(key);
	}

	function setNodeExpanded(key: string, open: boolean): void {
		setExpanded((prev) => {
			const next = new Set(prev);
			if (open) next.add(key);
			else next.delete(key);
			return next;
		});
	}

	/**
	 * Expand or collapse a pack node. Expanding is the *only* thing that fetches a
	 * pack's manifest from the panel, which is what keeps the load lazy: the tree
	 * lists every pack the project depends on from the index alone, and a pack
	 * costs a request only once someone looks inside it (LIB-05).
	 */
	async function togglePackNode(slug: string): Promise<void> {
		const open = !isExpanded(slug);
		setNodeExpanded(slug, open);
		if (!open) return;
		const summary = packs().find((candidate) => candidate.slug === slug);
		if (!summary || loadedByPack().has(slug)) return;
		setAssetsLoading(true);
		try {
			await loadPack(summary);
		} finally {
			setAssetsLoading(false);
		}
	}

	function toggleGroupNode(key: string): void {
		setNodeExpanded(key, !isExpanded(key));
	}

	/**
	 * Add a pack to the project. The browser reports the choice and warms the
	 * pack's manifest so the panel can show it straight away; recording it on the
	 * project is the editor's job (see {@link UseLibraryBrowserOptions.onAddPack}).
	 */
	async function addPack(pack: LibraryPackSummary): Promise<void> {
		// Which pack was added, for every pack we publish *and* every pack a third
		// party publishes through us — a third-party creator's adoption number is
		// the feedback the marketplace runs on (LIB-05, LIB-06). A pack the user
		// authored themselves is counted but not named.
		analytics.log("library_pack_added", packAnalyticsIdentity(pack));
		options.onAddPack?.(pack);
		setNodeExpanded(pack.slug, true);
		await loadPack(pack);
	}

	/** Retry a pack whose manifest failed, clearing its error before the attempt. */
	async function retryPack(pack: LibraryPackSummary): Promise<void> {
		setPackErrors((prev) =>
			prev.filter((error) => error.packSlug !== pack.slug),
		);
		setAssetsLoading(true);
		try {
			await loadPack(pack);
		} finally {
			setAssetsLoading(false);
		}
	}

	function setTreeQuery(query: string): void {
		setTreeQuerySignal(query);
	}

	return {
		packs,
		indexLoading,
		indexError,
		selectedPackSlug,
		assetsLoading,
		assets,
		results,
		facets,
		filter,
		packErrors,
		auditioningId,
		assetErrors,
		tree,
		treeQuery,
		isExpanded,
		addedPacks,
		open,
		selectPack,
		setQuery,
		toggleGenre: (genre) => toggleValue("genres", genre),
		toggleRole: (role) => toggleValue("roles", role),
		toggleCharacter: (character) => toggleValue("characters", character),
		toggleType,
		clearFilters,
		audition: auditionAsset,
		stopAudition,
		setTreeQuery,
		togglePackNode,
		toggleGroupNode,
		addPack,
		retryPack,
	};
}

/** The catalog's `asset_type` for a library asset (LOOP-013 analytics). */
function analyticsAssetType(
	asset: LibraryAsset,
): "one_shot" | "loop" | "instrument_preset" {
	if (asset.type === "loop") return "loop";
	if (asset.type === "preset") return "instrument_preset";
	return "one_shot";
}

function reasonOfIndexError(error: unknown): LibraryLoadReason {
	if (
		error &&
		typeof error === "object" &&
		"reason" in error &&
		typeof (error as { reason: unknown }).reason === "string"
	) {
		return (error as { reason: LibraryLoadReason }).reason;
	}
	return "network";
}
