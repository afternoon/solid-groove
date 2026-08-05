/**
 * The arrangement's named DOM actions (PRD 9.3 accessibility): zoom in/out,
 * zoom to selection, and scroll to playhead, as real buttons so canvas pixels
 * are never the sole way to drive the surface. Each is also the keyboard
 * equivalent of a pointer gesture on the timeline.
 */
export interface ArrangementToolbarProps {
	readonly onZoomIn: () => void;
	readonly onZoomOut: () => void;
	readonly onZoomToSelection: () => void;
	readonly onScrollToPlayhead: () => void;
	/** Zoom-to-selection is meaningless with nothing selected. */
	readonly hasSelection: boolean;
}

export function ArrangementToolbar(props: ArrangementToolbarProps) {
	return (
		<div class="arrangement-toolbar">
			<button
				type="button"
				class="arrangement-action"
				data-action="zoom-in"
				aria-label="Zoom in"
				onClick={() => props.onZoomIn()}
			>
				Zoom in
			</button>
			<button
				type="button"
				class="arrangement-action"
				data-action="zoom-out"
				aria-label="Zoom out"
				onClick={() => props.onZoomOut()}
			>
				Zoom out
			</button>
			<button
				type="button"
				class="arrangement-action"
				data-action="zoom-to-selection"
				aria-label="Zoom to selection"
				disabled={!props.hasSelection}
				onClick={() => props.onZoomToSelection()}
			>
				Zoom to selection
			</button>
			<button
				type="button"
				class="arrangement-action"
				data-action="scroll-to-playhead"
				aria-label="Scroll to playhead"
				onClick={() => props.onScrollToPlayhead()}
			>
				Scroll to playhead
			</button>
		</div>
	);
}
