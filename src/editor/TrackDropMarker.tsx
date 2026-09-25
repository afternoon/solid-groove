import { type JSX, Show } from "@solidjs/web";
import "./TrackDropMarker.css";

/**
 * Where a dragged track will land (TRK-02, #331): a bright bar across the gap,
 * drawn along the drag's axis inside its zone. Decoration, not a control — the
 * reorder itself is announced by the list changing, and the keyboard's route
 * (the mixer's move buttons) never shows one — so it is hidden from assistive
 * tech.
 */
export default function TrackDropMarker(props: {
  readonly axis: "x" | "y";
  readonly offset: number | null;
}): JSX.Element {
  return (
    <Show when={props.offset !== null}>
      <div
        class={`track-drop-indicator track-drop-indicator-${props.axis}`}
        data-testid="track-drop-indicator"
        aria-hidden="true"
        style={
          props.axis === "y"
            ? { top: `${props.offset ?? 0}px` }
            : { left: `${props.offset ?? 0}px` }
        }
      />
    </Show>
  );
}
