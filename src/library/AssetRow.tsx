import { HiSolidPlay, HiSolidPlus, HiSolidStop } from "solid-icons/hi";
import { type JSX, Show } from "solid-js";
import { writeLibrarySampleDrag } from "./assetDrag";
import { LOAD_REASON_LABELS } from "./loadReasons";
import type { LibraryAsset } from "./manifest";
// `.library-row`, `.library-audition` and `.library-insert` are defined in the
// panel's stylesheet, and CSS arrives through per-component side-effect imports.
// This row renders inside the pack browser too, which does not import that
// sheet — so it must be imported here, by the component that owns these class
// names, rather than relied on from whichever view happened to mount first.
import "./LibraryBrowser.css";

/**
 * One auditionable sound. Shared by the panel tree and the pack browser.
 *
 * The row is the drag handle: dragging it onto an instrument loads it (#225).
 * Dragging is a pointer gesture, so it is never the only way in (PRD 9.3) — the
 * "Insert" button does the same thing from the keyboard, on whichever track the
 * surface hosting this panel is editing.
 */
export default function AssetRow(props: {
	asset: LibraryAsset;
	active: boolean;
	error: string | null;
	/** Shown in the pack browser, where a result can come from any pack. */
	showPack?: boolean;
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
			draggable="true"
			onDragStart={(event) => {
				// A sound with no master audio (a preset) carries nothing an
				// instrument can load, so its row starts no drag at all rather than
				// one that has to be refused when it lands.
				if (!writeLibrarySampleDrag(event.dataTransfer, props.asset)) {
					event.preventDefault();
				}
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
				<Show when={props.active} fallback={<HiSolidPlay size={12} />}>
					<HiSolidStop size={12} />
				</Show>
			</button>
			<div class="library-row-meta">
				<span class="library-row-name">{props.asset.name}</span>
				<Show when={props.showPack || props.error}>
					<span class="library-row-tags">
						<Show when={props.showPack}>
							{props.asset.role} · {props.asset.packName}
						</Show>
						<Show when={props.error}>
							<span class="library-row-error-text">
								{props.showPack ? " · " : ""}
								{LOAD_REASON_LABELS[props.error ?? ""] ?? "Could not load."}
							</span>
						</Show>
					</span>
				</Show>
			</div>
			<Show when={props.onInsert}>
				<button
					type="button"
					class="library-insert"
					aria-label={`Insert ${props.asset.name}`}
					onClick={() => props.onInsert?.()}
				>
					<HiSolidPlus size={12} />
				</button>
			</Show>
		</li>
	);
}
