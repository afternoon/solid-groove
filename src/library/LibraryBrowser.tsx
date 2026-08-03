import {
	HiSolidExclamationTriangle,
	HiSolidPlay,
	HiSolidPlus,
	HiSolidStop,
} from "solid-icons/hi";
import {
	createEffect,
	createMemo,
	For,
	type JSX,
	onCleanup,
	onMount,
	Show,
} from "solid-js";
import type { Analytics } from "../analytics/analytics";
import TapeLoader from "../components/TapeLoader";
import type { PreviewEngine } from "./audition";
import type { LibraryClient } from "./libraryClient";
import type { LibraryAsset, LibraryAssetType } from "./manifest";
import { useLibraryBrowser } from "./useLibraryBrowser";
import "./LibraryBrowser.css";

export interface LibraryBrowserProps {
	/** Injected in tests; the browser builds its own client/engine otherwise. */
	readonly client?: LibraryClient;
	readonly previewEngine?: PreviewEngine;
	readonly analytics?: Analytics;
	/**
	 * The insertion affordance. Fired with the chosen library asset; the
	 * project-mutating command belongs to the instrument task that consumes this
	 * (LOOP-005/LOOP-006), so the browser only announces the choice.
	 */
	readonly onInsert?: (asset: LibraryAsset) => void;
}

const TYPE_LABELS: Record<LibraryAssetType, string> = {
	"one-shot": "One-shots",
	loop: "Loops",
	preset: "Presets",
};

const LOAD_REASON_LABELS: Record<string, string> = {
	network: "Check your connection.",
	not_found: "This library is unavailable.",
	corrupt: "The library data could not be read.",
	timeout: "The library took too long to load.",
};

/**
 * The searchable, sync-audition library browser (PRD LIB-01, LIB-02, LIB-05;
 * LOOP-013).
 *
 * Packs are the first-class way in: the sidebar lists every available pack with
 * an "All packs" entry for a cross-pack view, and a producer can open a pack and
 * browse it as a coherent set without knowing the taxonomy. Search and the
 * genre/role/character/type facets work within a pack and across all of them.
 * Play auditions an asset in sync where appropriate through the shared runtime,
 * stopping on selection change, close, navigation, or teardown; a missing or
 * corrupt asset — or a whole unavailable pack — reports locally without blocking
 * anything else. All of that logic lives in {@link useLibraryBrowser}; this is
 * the view.
 */
export default function LibraryBrowser(
	props: LibraryBrowserProps,
): JSX.Element {
	const browser = useLibraryBrowser({
		client: props.client,
		previewEngine: props.previewEngine,
		analytics: props.analytics,
	});

	onMount(() => void browser.open());

	// Stop audition when this surface is navigated away from within the SPA (a
	// route change unmounts the component; `useLibraryBrowser`'s onCleanup then
	// disposes audition). A hard pagehide also stops it, matching the AC's
	// "stops on ... navigation".
	createEffect(() => {
		if (typeof window === "undefined") return;
		const stop = () => browser.stopAudition();
		window.addEventListener("pagehide", stop);
		onCleanup(() => window.removeEventListener("pagehide", stop));
	});

	const selectedPackName = createMemo(() => {
		const slug = browser.selectedPackSlug();
		if (slug === null) return "All packs";
		return browser.packs().find((pack) => pack.slug === slug)?.name ?? slug;
	});

	const selectedPackDescription = createMemo(() => {
		const slug = browser.selectedPackSlug();
		if (slug === null) return null;
		return (
			browser.packs().find((pack) => pack.slug === slug)?.description ?? null
		);
	});

	return (
		<section class="library-browser" aria-label="Library">
			<Show
				when={!browser.indexError()}
				fallback={
					<div class="library-error" role="alert">
						<HiSolidExclamationTriangle size={18} />
						<span>{LOAD_REASON_LABELS[browser.indexError() ?? "network"]}</span>
						<button type="button" onClick={() => void browser.open()}>
							Retry
						</button>
					</div>
				}
			>
				<Show
					when={!browser.indexLoading() || browser.packs().length > 0}
					fallback={<TapeLoader label="Loading library" />}
				>
					<div class="library-layout">
						<nav class="library-packs" aria-label="Packs">
							<button
								type="button"
								class="library-pack"
								classList={{
									"library-pack-active": browser.selectedPackSlug() === null,
								}}
								aria-pressed={browser.selectedPackSlug() === null}
								onClick={() => void browser.selectPack(null)}
							>
								<span class="library-pack-name">All packs</span>
							</button>
							<For each={browser.packs()}>
								{(pack) => {
									const failed = createMemo(() =>
										browser
											.packErrors()
											.some((error) => error.packSlug === pack.slug),
									);
									return (
										<button
											type="button"
											class="library-pack"
											classList={{
												"library-pack-active":
													browser.selectedPackSlug() === pack.slug,
												"library-pack-failed": failed(),
											}}
											aria-pressed={browser.selectedPackSlug() === pack.slug}
											title={pack.description}
											onClick={() => void browser.selectPack(pack.slug)}
										>
											<span class="library-pack-name">{pack.name}</span>
											<span class="library-pack-count">
												{failed() ? "!" : pack.assetCount}
											</span>
										</button>
									);
								}}
							</For>
						</nav>

						<div class="library-main">
							<header class="library-header">
								<div class="library-heading">
									<h2 class="library-pack-title">{selectedPackName()}</h2>
									<Show when={selectedPackDescription()}>
										<p class="library-pack-blurb">
											{selectedPackDescription()}
										</p>
									</Show>
								</div>
								<input
									type="search"
									class="library-search"
									placeholder="Search sounds"
									aria-label="Search sounds"
									value={browser.filter().query}
									onInput={(event) =>
										browser.setQuery(event.currentTarget.value)
									}
								/>
							</header>

							<FacetBar browser={browser} />

							<Show
								when={!browser.assetsLoading()}
								fallback={<TapeLoader label="Loading pack" />}
							>
								<PackErrors browser={browser} />
								<Show
									when={browser.results().length > 0}
									fallback={
										<p class="library-empty">
											No sounds match. Clear a filter to see more.
										</p>
									}
								>
									<ul class="library-results">
										<For each={browser.results()}>
											{(asset) => (
												<AssetRow
													asset={asset}
													active={browser.auditioningId() === asset.id}
													error={browser.assetErrors().get(asset.id) ?? null}
													onPlay={() => void browser.audition(asset)}
													onStop={() => browser.stopAudition()}
													onInsert={
														props.onInsert
															? () => props.onInsert?.(asset)
															: undefined
													}
												/>
											)}
										</For>
									</ul>
								</Show>
							</Show>
						</div>
					</div>
				</Show>
			</Show>
		</section>
	);
}

/** The active-facet controls, computed from the assets actually present. */
function FacetBar(props: {
	browser: ReturnType<typeof useLibraryBrowser>;
}): JSX.Element {
	const { browser } = props;
	const anyFilter = createMemo(() => {
		const filter = browser.filter();
		return (
			filter.genres.length > 0 ||
			filter.roles.length > 0 ||
			filter.characters.length > 0 ||
			filter.types.length > 0 ||
			filter.query.trim() !== ""
		);
	});
	return (
		<div class="library-facets">
			<FacetGroup
				label="Type"
				values={browser.facets().types}
				active={browser.filter().types}
				display={(type) => TYPE_LABELS[type as LibraryAssetType]}
				onToggle={(type) => browser.toggleType(type as LibraryAssetType)}
			/>
			<FacetGroup
				label="Genre"
				values={browser.facets().genres}
				active={browser.filter().genres}
				onToggle={(genre) => browser.toggleGenre(genre)}
			/>
			<FacetGroup
				label="Role"
				values={browser.facets().roles}
				active={browser.filter().roles}
				onToggle={(role) => browser.toggleRole(role)}
			/>
			<FacetGroup
				label="Character"
				values={browser.facets().characters}
				active={browser.filter().characters}
				onToggle={(character) => browser.toggleCharacter(character)}
			/>
			<Show when={anyFilter()}>
				<button
					type="button"
					class="library-clear"
					onClick={() => browser.clearFilters()}
				>
					Clear filters
				</button>
			</Show>
		</div>
	);
}

function FacetGroup(props: {
	label: string;
	values: readonly string[];
	active: readonly string[];
	display?: (value: string) => string;
	onToggle: (value: string) => void;
}): JSX.Element {
	return (
		<Show when={props.values.length > 0}>
			<fieldset class="library-facet-group">
				<legend class="library-facet-label">{props.label}</legend>
				<For each={props.values}>
					{(value) => {
						const isActive = createMemo(() => props.active.includes(value));
						return (
							<button
								type="button"
								class="library-chip"
								classList={{ "library-chip-active": isActive() }}
								aria-pressed={isActive()}
								onClick={() => props.onToggle(value)}
							>
								{props.display ? props.display(value) : value}
							</button>
						);
					}}
				</For>
			</fieldset>
		</Show>
	);
}

/** Per-pack load failures, named and isolated (LIB-05). */
function PackErrors(props: {
	browser: ReturnType<typeof useLibraryBrowser>;
}): JSX.Element {
	return (
		<Show when={props.browser.packErrors().length > 0}>
			<div class="library-pack-errors" role="alert">
				<For each={props.browser.packErrors()}>
					{(error) => {
						const name = createMemo(
							() =>
								props.browser
									.packs()
									.find((pack) => pack.slug === error.packSlug)?.name ??
								error.packSlug,
						);
						return (
							<p class="library-pack-error">
								<HiSolidExclamationTriangle size={14} />
								<span>
									“{name()}” is unavailable.{" "}
									{LOAD_REASON_LABELS[error.reason] ?? ""} Other packs still
									work.
								</span>
							</p>
						);
					}}
				</For>
			</div>
		</Show>
	);
}

function AssetRow(props: {
	asset: LibraryAsset;
	active: boolean;
	error: string | null;
	onPlay: () => void;
	onStop: () => void;
	onInsert?: () => void;
}): JSX.Element {
	return (
		<li
			class="library-row"
			classList={{
				"library-row-active": props.active,
				"library-row-error": props.error !== null,
			}}
		>
			<button
				type="button"
				class="library-audition"
				aria-label={
					props.active
						? `Stop ${props.asset.name}`
						: `Audition ${props.asset.name}`
				}
				aria-pressed={props.active}
				onClick={() => (props.active ? props.onStop() : props.onPlay())}
			>
				<Show when={props.active} fallback={<HiSolidPlay size={14} />}>
					<HiSolidStop size={14} />
				</Show>
			</button>
			<div class="library-row-meta">
				<span class="library-row-name">{props.asset.name}</span>
				<span class="library-row-tags">
					{props.asset.role} · {props.asset.packName}
					<Show when={props.error}>
						<span class="library-row-error-text">
							{" "}
							· {LOAD_REASON_LABELS[props.error ?? ""] ?? "Could not load."}
						</span>
					</Show>
				</span>
			</div>
			<Show when={props.onInsert}>
				<button
					type="button"
					class="library-insert"
					aria-label={`Insert ${props.asset.name}`}
					onClick={() => props.onInsert?.()}
				>
					<HiSolidPlus size={14} />
				</button>
			</Show>
		</li>
	);
}
