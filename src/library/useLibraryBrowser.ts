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
import { libraryPackSlug } from "../analytics/catalog";
import { toErrorCode } from "../analytics/errorCodes";
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
}

export interface UseLibraryBrowserOptions {
	readonly client?: LibraryClient;
	/** The audio engine audition plays through. Omit only in a headless test. */
	readonly previewEngine?: PreviewEngine;
	readonly analytics?: Analytics;
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

	async function open(): Promise<void> {
		if (packs().length > 0 || indexLoading()) return;
		setIndexLoading(true);
		setIndexError(null);
		try {
			const summaries = await client.loadIndex();
			setPacks(summaries);
			// Open into the first pack so the browser shows content immediately
			// rather than an empty cross-pack view. This loads exactly one pack's
			// manifest — still the index plus one pack, never every pack's metadata
			// (sample-library section 12).
			const first = summaries[0];
			if (first && selectedPackSlug() === null) {
				await selectPack(first.slug);
			}
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
			pack_id: libraryPackSlug(asset.packSlug),
		});
		await audition.play(asset);
	}

	function stopAudition(): void {
		audition?.stop();
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
