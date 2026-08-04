import {
	HiSolidCheckCircle,
	HiSolidExclamationTriangle,
	HiSolidXMark,
} from "solid-icons/hi";
import {
	createEffect,
	createMemo,
	createSignal,
	For,
	type JSX,
	onMount,
	Show,
} from "solid-js";
import {
	type Analytics,
	analytics as defaultAnalytics,
} from "../analytics/analytics";
import TapeLoader from "../components/TapeLoader";
import type { ShortcutContext, ShortcutHandlers } from "../shortcuts";
import { useShortcuts } from "../shortcuts";
import { AssetRow, LOAD_REASON_LABELS } from "./LibraryBrowser";
import type {
	LibraryAsset,
	LibraryAssetType,
	LibraryPackSummary,
} from "./manifest";
import { EMPTY_PACK_FILTER, filterPacks, type PackKind } from "./search";
import type { useLibraryBrowser } from "./useLibraryBrowser";
import "./PackBrowser.css";

/** A modal suppresses every other shortcut context while it is open (PRD KEY-01). */
const DIALOG_CONTEXTS: readonly ShortcutContext[] = ["dialog"];

const TYPE_LABELS: Record<LibraryAssetType, string> = {
	"one-shot": "One-shots",
	loop: "Loops",
	preset: "Presets",
};

const KIND_LABELS: Record<PackKind, string> = {
	factory: "Factory",
	"third-party": "Third-party",
	user: "Yours",
};

export interface PackBrowserProps {
	readonly browser: ReturnType<typeof useLibraryBrowser>;
	readonly analytics?: Analytics;
	/** Pack IDs the project already has, so an added pack says so. */
	readonly addedPackIds: readonly string[];
	readonly onInsert?: (asset: LibraryAsset) => void;
	readonly onClose: () => void;
}

/**
 * The pack browser: a modal surface for browsing, searching, and adding packs
 * (PRD LIB-05; LOOP-013).
 *
 * It is its own dialog rather than a region of the editor because a pack is the
 * unit the library is published in — the thing a producer chooses between, and
 * the surface the LIB-06 marketplace will eventually sell from — so it gets the
 * room to show a pack as a whole: what it is, who made it, what is in it, and
 * what it sounds like, with one primary way to bring it into the project.
 *
 * Dismissal is the standard modal set: the `Close` action, the scrim behind the
 * dialog, and `Escape`. `Escape` is not compared here — it is `view.close_surface`
 * in the KEY-01 registry, dispatched by the shared controller like every other
 * mapping, which is what keeps the combination written down once.
 *
 * Facets live here, not in the panel: filtering by genre, role and character
 * needs the width, and the panel is 250px.
 */
export default function PackBrowser(props: PackBrowserProps): JSX.Element {
	const { browser } = props;
	const analytics = props.analytics ?? defaultAnalytics;
	const [packFilter, setPackFilter] = createSignal(EMPTY_PACK_FILTER);

	useShortcuts({
		handlers: (): ShortcutHandlers => ({
			"view.close_surface": { run: () => props.onClose() },
		}),
		contexts: () => DIALOG_CONTEXTS,
	});

	onMount(() => {
		analytics.logFeatureFirstUse("pack_browser");
		void browser.open();
	});

	// Open on a pack rather than the cross-pack list: a pack is what this surface
	// is about, and its detail is what a producer decides from. That fetches
	// exactly one manifest, never every pack's (LIB-05). This is an effect rather
	// than part of `onMount` because the index may still be in flight when the
	// dialog mounts — and it runs once, so choosing "All sounds" afterwards is not
	// undone by a later index update.
	let choseInitialPack = false;
	createEffect(() => {
		if (choseInitialPack || browser.selectedPackSlug() !== null) return;
		const first = browser.packs()[0];
		if (!first) return;
		choseInitialPack = true;
		void browser.selectPack(first.slug);
	});

	const visiblePacks = createMemo(() =>
		filterPacks(browser.packs(), packFilter()),
	);

	const selectedPack = createMemo<LibraryPackSummary | null>(() => {
		const slug = browser.selectedPackSlug();
		if (slug === null) return null;
		return browser.packs().find((pack) => pack.slug === slug) ?? null;
	});

	const isAdded = (pack: LibraryPackSummary) =>
		props.addedPackIds.includes(pack.id);

	function toggleKind(kind: PackKind): void {
		setPackFilter((prev) => ({
			...prev,
			kinds: prev.kinds.includes(kind)
				? prev.kinds.filter((existing) => existing !== kind)
				: [...prev.kinds, kind],
		}));
	}

	const kinds = createMemo<PackKind[]>(() => {
		const present = new Set(browser.packs().map((pack) => pack.kind));
		return (["factory", "third-party", "user"] as const).filter((kind) =>
			present.has(kind),
		);
	});

	return (
		<div class="pack-browser">
			{/*
			 * The scrim is a real button rather than a click handler on a div, so
			 * "click outside to dismiss" is one accessible affordance instead of a
			 * mouse-only one. It is not in the tab order — `Escape` and the dialog's
			 * own Close button are the keyboard paths.
			 */}
			<button
				type="button"
				class="pack-browser-scrim"
				tabIndex={-1}
				aria-label="Close pack browser"
				onClick={() => props.onClose()}
			/>
			<div
				class="pack-browser-dialog"
				role="dialog"
				aria-modal="true"
				aria-labelledby="pack-browser-title"
			>
				<header class="pack-browser-header">
					<h2 class="pack-browser-title" id="pack-browser-title">
						Packs
					</h2>
					<button
						type="button"
						class="pack-browser-close"
						aria-label="Close"
						onClick={() => props.onClose()}
					>
						<HiSolidXMark size={18} />
					</button>
				</header>

				<div class="pack-browser-body">
					<nav class="pack-browser-list" aria-label="Packs">
						<input
							type="search"
							class="pack-browser-search"
							placeholder="Search packs"
							aria-label="Search packs"
							value={packFilter().query}
							onInput={(event) =>
								setPackFilter((prev) => ({
									...prev,
									query: event.currentTarget.value,
								}))
							}
						/>
						<div class="pack-browser-kinds">
							<For each={kinds()}>
								{(kind) => {
									const active = createMemo(() =>
										packFilter().kinds.includes(kind),
									);
									return (
										<button
											type="button"
											class="library-chip"
											classList={{ "library-chip-active": active() }}
											aria-pressed={active()}
											onClick={() => toggleKind(kind)}
										>
											{KIND_LABELS[kind]}
										</button>
									);
								}}
							</For>
						</div>
						<ul class="pack-browser-packs">
							<li>
								<button
									type="button"
									class="pack-browser-pack"
									classList={{
										"pack-browser-pack-active":
											browser.selectedPackSlug() === null,
									}}
									aria-pressed={browser.selectedPackSlug() === null}
									onClick={() => void browser.selectPack(null)}
								>
									<span class="pack-browser-pack-name">All sounds</span>
									<span class="pack-browser-pack-meta">Every pack</span>
								</button>
							</li>
							<For each={visiblePacks()}>
								{(pack) => {
									const failed = createMemo(() =>
										browser
											.packErrors()
											.some((error) => error.packSlug === pack.slug),
									);
									return (
										<li>
											<button
												type="button"
												class="pack-browser-pack"
												classList={{
													"pack-browser-pack-active":
														browser.selectedPackSlug() === pack.slug,
													"pack-browser-pack-failed": failed(),
												}}
												aria-pressed={browser.selectedPackSlug() === pack.slug}
												onClick={() => void browser.selectPack(pack.slug)}
											>
												<span class="pack-browser-pack-name">{pack.name}</span>
												<span class="pack-browser-pack-meta">
													{pack.publisher} ·{" "}
													{failed()
														? "unavailable"
														: `${pack.assetCount} sounds`}
												</span>
												<Show when={isAdded(pack)}>
													<span class="pack-browser-pack-added">
														<HiSolidCheckCircle size={14} />
														<span class="visually-hidden">Added</span>
													</span>
												</Show>
											</button>
										</li>
									);
								}}
							</For>
							<Show when={visiblePacks().length === 0}>
								<li class="pack-browser-no-packs">
									No packs match. Clear the search to see them all.
								</li>
							</Show>
						</ul>
					</nav>

					<section class="pack-browser-detail" aria-label="Pack">
						<Show
							when={selectedPack()}
							fallback={
								<AllSoundsView browser={browser} onInsert={props.onInsert} />
							}
						>
							{(pack) => (
								<PackDetail
									pack={pack()}
									browser={browser}
									added={isAdded(pack())}
									onAdd={() => void browser.addPack(pack())}
									onInsert={props.onInsert}
									onClose={() => props.onClose()}
								/>
							)}
						</Show>
					</section>
				</div>
			</div>
		</div>
	);
}

/** One pack, as the surface a producer decides from. */
function PackDetail(props: {
	pack: LibraryPackSummary;
	browser: ReturnType<typeof useLibraryBrowser>;
	added: boolean;
	onAdd: () => void;
	onInsert?: (asset: LibraryAsset) => void;
	onClose: () => void;
}): JSX.Element {
	const failed = createMemo(() =>
		props.browser
			.packErrors()
			.some((error) => error.packSlug === props.pack.slug),
	);
	return (
		<>
			<div class="pack-detail">
				{/*
				 * A pack's cover art, demo track, and long-form description are
				 * marketing metadata the pack index does not carry yet (see the
				 * LOOP-013 follow-up). Until it does, the hero is typographic rather
				 * than a placeholder image standing in for content that does not exist.
				 */}
				<div class="pack-detail-hero">
					<span class="pack-detail-mark" aria-hidden="true">
						{initials(props.pack.name)}
					</span>
					<div class="pack-detail-heading">
						<h3 class="pack-detail-name">{props.pack.name}</h3>
						<p class="pack-detail-meta">
							{props.pack.publisher} · v{props.pack.version} ·{" "}
							{props.pack.assetCount} sounds
						</p>
					</div>
				</div>
				<p class="pack-detail-description">{props.pack.description}</p>

				<Show when={failed()}>
					<p class="pack-detail-error" role="alert">
						<HiSolidExclamationTriangle size={14} />
						<span>
							“{props.pack.name}” is unavailable. Other packs still work.
						</span>
						<button
							type="button"
							onClick={() => void props.browser.retryPack(props.pack)}
						>
							Retry
						</button>
					</p>
				</Show>

				<h4 class="pack-detail-contents-title">What's inside</h4>
				<FacetBar browser={props.browser} />
				<Results browser={props.browser} onInsert={props.onInsert} />
			</div>

			<footer class="pack-detail-actions">
				<button
					type="button"
					class="pack-detail-secondary"
					onClick={() => props.onClose()}
				>
					Close
				</button>
				<button
					type="button"
					class="pack-detail-primary"
					disabled={props.added}
					onClick={() => props.onAdd()}
				>
					<Show when={props.added} fallback={<>Add pack to project</>}>
						<HiSolidCheckCircle size={16} />
						<span>In this project</span>
					</Show>
				</button>
			</footer>
		</>
	);
}

/**
 * The cross-pack view: search and facets over every pack that has loaded, so a
 * genre or role filter reaches the whole library and clearing the pack filter
 * only ever widens the result (LIB-02).
 */
function AllSoundsView(props: {
	browser: ReturnType<typeof useLibraryBrowser>;
	onInsert?: (asset: LibraryAsset) => void;
}): JSX.Element {
	return (
		<div class="pack-detail">
			<div class="pack-detail-heading">
				<h3 class="pack-detail-name">All sounds</h3>
				<p class="pack-detail-meta">
					Every pack in the library, searchable together.
				</p>
			</div>
			<PackErrors browser={props.browser} />
			<FacetBar browser={props.browser} />
			<Results browser={props.browser} onInsert={props.onInsert} />
		</div>
	);
}

function Results(props: {
	browser: ReturnType<typeof useLibraryBrowser>;
	onInsert?: (asset: LibraryAsset) => void;
}): JSX.Element {
	const { browser } = props;
	return (
		<Show
			when={!browser.assetsLoading()}
			fallback={<TapeLoader label="Loading pack" />}
		>
			<Show
				when={browser.results().length > 0}
				fallback={
					<p class="library-empty">
						No sounds match. Clear a filter to see more.
					</p>
				}
			>
				<ul class="pack-browser-results">
					<For each={browser.results()}>
						{(asset) => (
							<AssetRow
								asset={asset}
								active={browser.auditioningId() === asset.id}
								error={browser.assetErrors().get(asset.id) ?? null}
								showPack
								onPlay={() => void browser.audition(asset)}
								onStop={() => browser.stopAudition()}
								onInsert={
									props.onInsert ? () => props.onInsert?.(asset) : undefined
								}
							/>
						)}
					</For>
				</ul>
			</Show>
		</Show>
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
			<input
				type="search"
				class="library-search"
				placeholder="Search sounds"
				aria-label="Search sounds"
				value={browser.filter().query}
				onInput={(event) => browser.setQuery(event.currentTarget.value)}
			/>
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

/** The pack's initials, as a typographic stand-in for cover art. */
function initials(name: string): string {
	return name
		.split(/\s+/)
		.slice(0, 2)
		.map((word) => word.charAt(0).toUpperCase())
		.join("");
}
