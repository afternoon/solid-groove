import { Show } from "solid-js";
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
  /**
   * Opens the selected placement's clip in the sequence editor (`UI-001`).
   *
   * The pointer gesture is a double-click on the canvas, which no keyboard can
   * make; this is its reachable twin. A real button rather than an `Enter`
   * chord in the registry, deliberately: a bare `Enter` valid whenever a
   * placement is selected would also fire on whatever button happened to have
   * focus, the dock's own links included.
   */
  readonly onOpen?: () => void;
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
      <Show when={props.onOpen}>
        {(open) => (
          <button
            type="button"
            class="arrangement-action"
            data-action="open-placement"
            disabled={disabled()}
            title="Open the selected clip in the sequence editor"
            onClick={() => open()()}
          >
            Open clip
          </button>
        )}
      </Show>
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
