import { createMemo, For, type JSX, Show } from "solid-js";
import type { LibraryAssetType } from "./manifest";
import type { PackKind } from "./search";
import type { useLibraryBrowser } from "./useLibraryBrowser";
// The facet cluster's own layout (`.library-facets`, `.library-facet-group`),
// its chips and its clear button live in the modal's stylesheet, while the
// search input it shares with the panel (`.library-search`) lives in the
// panel's. CSS arrives through per-component side-effect imports, so this
// component imports both rather than depending on which view mounted first.
// Order matters as well as presence: `.pack-browser-detail .library-search`
// overrides the panel's base `.library-search`, so the panel sheet must come
// first, exactly as it did when these views imported one another.
import "./LibraryBrowser.css";
import "./PackBrowser.css";

export const TYPE_LABELS: Record<LibraryAssetType, string> = {
	"one-shot": "One-shots",
	loop: "Loops",
	preset: "Presets",
};

export const KIND_LABELS: Record<PackKind, string> = {
	factory: "Factory",
	"third-party": "Third-party",
	user: "Yours",
};

/** The active-facet controls, computed from the assets actually present. */
export function FacetBar(props: {
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

export function FacetGroup(props: {
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
