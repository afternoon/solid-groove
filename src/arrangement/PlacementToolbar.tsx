import { describeDuplicate } from "./placementDuplication";

/**
 * The CLP-01 headline affordance: when one or more placements are selected,
 * the UI must state which of the two duplicate operations will run *before*
 * the gesture fires — not a single ambiguous "Duplicate" button. Cut/copy/
 * paste/delete are keyboard-only here, matching the piano roll's own
 * precedent (KEY-01/KEY-02: the registry and the `?` guide are the affordance,
 * not redundant on-screen buttons) — this toolbar exists only for the choice
 * a keyboard shortcut cannot make honestly on its own.
 */
export interface PlacementToolbarProps {
	readonly selectionCount: number;
	readonly onDuplicateLinked: () => void;
	readonly onDuplicateIndependent: () => void;
}

export function PlacementToolbar(props: PlacementToolbarProps) {
	const disabled = () => props.selectionCount === 0;
	return (
		<div class="placement-toolbar" data-testid="placement-toolbar">
			<span class="placement-toolbar-count">
				{props.selectionCount > 0
					? `${props.selectionCount} placement${props.selectionCount === 1 ? "" : "s"} selected`
					: "No placement selected"}
			</span>
			<button
				type="button"
				class="arrangement-action"
				data-action="duplicate-linked"
				disabled={disabled()}
				title={describeDuplicate("linked")}
				onClick={() => props.onDuplicateLinked()}
			>
				{describeDuplicate("linked")}
			</button>
			<button
				type="button"
				class="arrangement-action"
				data-action="duplicate-independent"
				disabled={disabled()}
				title={describeDuplicate("independent")}
				onClick={() => props.onDuplicateIndependent()}
			>
				{describeDuplicate("independent")}
			</button>
		</div>
	);
}
