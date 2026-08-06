import {
	HiSolidChevronDown,
	HiSolidChevronRight,
	HiSolidExclamationTriangle,
	HiSolidSquares2x2,
} from "solid-icons/hi";
import {
	createEffect,
	createMemo,
	createSignal,
	For,
	type JSX,
	onCleanup,
	onMount,
	Show,
} from "solid-js";
import type { Analytics } from "../analytics/analytics";
import TapeLoader from "../components/TapeLoader";
import { MASK_CONTENT } from "../monitoring/replayPrivacy";
import AssetRow from "./AssetRow";
import type { PreviewEngine } from "./audition";
import type { LibraryClient } from "./libraryClient";
import { LOAD_REASON_LABELS } from "./loadReasons";
import type { LibraryAsset, LibraryPackSummary } from "./manifest";
import PackBrowser from "./PackBrowser";
import type { LibraryTreeGroup, LibraryTreePack } from "./tree";
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
	/** The packs the open project has, as pack IDs — the tree's top level. */
	readonly addedPackIds?: readonly string[];
	/** Fired when a pack is added from the pack browser. */
	readonly onAddPack?: (pack: LibraryPackSummary) => void;
	/**
	 * Announces whether the pack browser modal is open, so the surface hosting
	 * this panel can hand the keyboard to the `dialog` shortcut context while it
	 * is (PRD KEY-02: a modal suppresses every other context).
	 */
	readonly onPackBrowserOpenChange?: (open: boolean) => void;
}

/**
 * The library panel: a narrow, always-available column beside the workspace
 * (PRD LIB-01, LIB-02, LIB-05; LOOP-013).
 *
 * It shows the packs *this project* has as a tree — pack, then the pack's own
 * role groups ("Kicks", "Claps", "Closed hats"), then the sounds — so a
 * producer reaches a sound through the structure the pack already has rather
 * than through a taxonomy they have to learn. Expanding a pack is what fetches
 * its manifest, so the panel costs the pack index and nothing else until
 * someone looks inside a pack (sample-library section 12).
 *
 * Everything that needs room — browsing the whole library, filtering by genre,
 * role and character, comparing packs, adding one — lives in the {@link
 * PackBrowser} modal this opens, not in the panel. That split is deliberate:
 * the previous layout put the full facet bar in the panel, where at the
 * delivered library's size it consumed the entire height and left no room for
 * results.
 *
 * The load/filter/audition logic lives in `useLibraryBrowser`; this is the view.
 */
export default function LibraryBrowser(
	props: LibraryBrowserProps,
): JSX.Element {
	const browser = useLibraryBrowser({
		client: props.client,
		previewEngine: props.previewEngine,
		analytics: props.analytics,
		addedPackIds: () => props.addedPackIds ?? [],
		onAddPack: (pack) => props.onAddPack?.(pack),
	});

	const [packBrowserOpen, setPackBrowserOpen] = createSignal(false);

	function openPackBrowser(): void {
		// A preview started in the panel does not follow the user into the modal:
		// audition stops on any surface change, exactly as it does on close.
		browser.stopAudition();
		setPackBrowserOpen(true);
		props.onPackBrowserOpenChange?.(true);
	}

	function closePackBrowser(): void {
		browser.stopAudition();
		setPackBrowserOpen(false);
		props.onPackBrowserOpenChange?.(false);
	}

	onMount(() => void browser.open());

	// Leaving the panel open while the surface unmounts already stops audition
	// (`useLibraryBrowser` disposes it on cleanup); tell the host the modal is
	// gone too, so it does not leave the keyboard in the `dialog` context.
	onCleanup(() => props.onPackBrowserOpenChange?.(false));

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

	const hasQuery = createMemo(() => browser.treeQuery().trim() !== "");

	return (
		<section class="library-browser" aria-label="Library">
			<header class="library-browser-header">
				<h2 class="library-browser-title">Library</h2>
				{/* What the user typed (ADR 0002 decision 2; PRD OPS-03 forbids a
				    user-entered string in a payload). */}
				<input
					type="search"
					class={`library-search ${MASK_CONTENT}`}
					placeholder="Search sounds"
					aria-label="Search sounds"
					value={browser.treeQuery()}
					onInput={(event) => browser.setTreeQuery(event.currentTarget.value)}
				/>
			</header>

			<Show
				when={!browser.indexError()}
				fallback={
					<div class="library-error" role="alert">
						<HiSolidExclamationTriangle size={16} />
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
					<Show
						when={browser.tree().length > 0}
						fallback={
							<p class="library-empty">
								No packs in this project yet. Browse packs to add one.
							</p>
						}
					>
						<ul class="library-tree">
							<For each={browser.tree()}>
								{(pack) => (
									<PackNode
										pack={pack}
										browser={browser}
										hasQuery={hasQuery()}
										onInsert={props.onInsert}
									/>
								)}
							</For>
						</ul>
					</Show>
				</Show>
			</Show>

			<footer class="library-browser-footer">
				<button
					type="button"
					class="library-browse-packs"
					onClick={() => openPackBrowser()}
				>
					<HiSolidSquares2x2 size={14} />
					<span>Browse packs</span>
				</button>
			</footer>

			<Show when={packBrowserOpen()}>
				<PackBrowser
					browser={browser}
					analytics={props.analytics}
					addedPackIds={props.addedPackIds ?? []}
					onInsert={props.onInsert}
					onClose={() => closePackBrowser()}
				/>
			</Show>
		</section>
	);
}

/** One pack in the tree: a disclosure whose expansion fetches its manifest. */
function PackNode(props: {
	pack: LibraryTreePack;
	browser: ReturnType<typeof useLibraryBrowser>;
	hasQuery: boolean;
	onInsert?: (asset: LibraryAsset) => void;
}): JSX.Element {
	const expanded = createMemo(() => props.browser.isExpanded(props.pack.slug));
	const summary = createMemo(
		() =>
			props.browser.packs().find((pack) => pack.slug === props.pack.slug) ??
			null,
	);
	// Before the manifest loads the index's count is all there is to show; after
	// it, the count reflects what the current query actually matched.
	const count = createMemo(() =>
		props.pack.loaded ? props.pack.matchCount : props.pack.assetCount,
	);
	return (
		<li class="library-tree-pack">
			<button
				type="button"
				class="library-node library-node-pack"
				aria-expanded={expanded()}
				onClick={() => void props.browser.togglePackNode(props.pack.slug)}
			>
				<Chevron expanded={expanded()} />
				<span class="library-node-label">{props.pack.name}</span>
				<span class="library-node-count">
					{props.pack.failed ? "!" : count()}
				</span>
			</button>
			<Show when={expanded()}>
				<Show
					when={!props.pack.failed}
					fallback={
						<div class="library-node-error" role="alert">
							<span>“{props.pack.name}” is unavailable. Other packs work.</span>
							<Show when={summary()}>
								{(pack) => (
									<button
										type="button"
										onClick={() => void props.browser.retryPack(pack())}
									>
										Retry
									</button>
								)}
							</Show>
						</div>
					}
				>
					<Show
						when={props.pack.loaded}
						fallback={<TapeLoader label="Loading pack" />}
					>
						<Show
							when={props.pack.groups.length > 0}
							fallback={
								<p class="library-node-empty">
									{props.hasQuery
										? "No sounds match in this pack."
										: "This pack has no sounds."}
								</p>
							}
						>
							<ul class="library-tree-groups">
								<For each={props.pack.groups}>
									{(group) => (
										<GroupNode
											group={group}
											browser={props.browser}
											forceOpen={props.hasQuery}
											onInsert={props.onInsert}
										/>
									)}
								</For>
							</ul>
						</Show>
					</Show>
				</Show>
			</Show>
		</li>
	);
}

/** One role group ("Kicks") and its sounds. */
function GroupNode(props: {
	group: LibraryTreeGroup;
	browser: ReturnType<typeof useLibraryBrowser>;
	/** A search opens every matching group, so a hit is never hidden by a collapse. */
	forceOpen: boolean;
	onInsert?: (asset: LibraryAsset) => void;
}): JSX.Element {
	const expanded = createMemo(
		() => props.forceOpen || props.browser.isExpanded(props.group.key),
	);
	return (
		<li class="library-tree-group">
			<button
				type="button"
				class="library-node library-node-group"
				aria-expanded={expanded()}
				onClick={() => props.browser.toggleGroupNode(props.group.key)}
			>
				<Chevron expanded={expanded()} />
				<span class="library-node-label">{props.group.label}</span>
				<span class="library-node-count">{props.group.assets.length}</span>
			</button>
			<Show when={expanded()}>
				<ul class="library-tree-assets">
					<For each={props.group.assets}>
						{(asset) => (
							<AssetRow
								asset={asset}
								active={props.browser.auditioningId() === asset.id}
								error={props.browser.assetErrors().get(asset.id) ?? null}
								onPlay={() => void props.browser.audition(asset)}
								onStop={() => props.browser.stopAudition()}
								onInsert={
									props.onInsert ? () => props.onInsert?.(asset) : undefined
								}
							/>
						)}
					</For>
				</ul>
			</Show>
		</li>
	);
}

function Chevron(props: { expanded: boolean }): JSX.Element {
	return (
		<span class="library-node-chevron" aria-hidden="true">
			<Show when={props.expanded} fallback={<HiSolidChevronRight size={12} />}>
				<HiSolidChevronDown size={12} />
			</Show>
		</span>
	);
}
