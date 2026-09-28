import { For, type JSX } from "@solidjs/web";
import { HEADER_WIDTH_PX, ROW_METRICS } from "../arrangement/ArrangementView";
import type { Track } from "../domain/entities";
import type { TrackId } from "../domain/ids";
import { MASK_CONTENT } from "../monitoring/replayPrivacy";
import { ariaBool } from "../shared/aria";
import { useTrackDrag } from "./useTrackDrag";
import "./trackDrag.css";
import "./TrackRail.css";

export interface TrackRailProps {
  readonly tracks: readonly Track[];
  readonly selectedTrackId: TrackId | null;
  onSelect(trackId: TrackId): void;
  /** Moves a track to a display index, when the rail is dragged (#447). */
  onReorder?(trackId: TrackId, toIndex: number): void;
}

/**
 * The instrument view's track rail (`UI-001`): every track in the project, down
 * the left edge, and which one you are looking at.
 *
 * The instrument view shows one track at a time, so it needs its own way to
 * move between them — the arrangement's header column and the mixer's strips
 * are both on other pages now. It reports the click and nothing else: selection
 * is one piece of state across all three views, held by the editor.
 *
 * A list rather than a row of buttons, because that is what it is: an ordered
 * set of the project's tracks, one of which is current.
 */
export default function TrackRail(props: TrackRailProps): JSX.Element {
  let list: HTMLUListElement | undefined;
  const indexOf = (trackId: TrackId) => props.tracks.findIndex((t) => t.id === trackId);
  // Drag a row up or down to reorder its track (#447), as the arrangement's
  // header column does, with the same controller and the same one-entry drop.
  const drag = useTrackDrag({
    axis: "y",
    zone: () => list,
    indexOf,
    onDrop: (trackId, toIndex) => props.onReorder?.(trackId, toIndex),
  });
  /** The rows as letting go now would leave them: the dragged track is drawn
   * where it would land; the project changes only on release. */
  const shown = () => {
    const [dragged, to] = [drag.dragging(), drag.target()];
    if (dragged === null || to === null) return props.tracks;
    const moving = props.tracks.find((t) => t.id === dragged);
    if (!moving) return props.tracks;
    const rest = props.tracks.filter((t) => t.id !== dragged);
    return [...rest.slice(0, to), moving, ...rest.slice(to)];
  };

  return (
    <ul
      ref={list}
      class="track-rail"
      aria-label="Tracks"
      /* The arrangement's own header metrics, not a second set of numbers
         that would drift from them: a track's row is the same size and the
         column the same width in both views (`UI-001`). */
      style={{
        "--track-row-height": `${ROW_METRICS.headerHeightPx}px`,
        "--track-column-width": `${HEADER_WIDTH_PX}px`,
      }}
    >
      <For each={shown()}>
        {(track) => (
          <li
            class={[
              "track-rail-item",
              { "track-dragging": drag.dragging() === track.id },
            ]}
            data-track-drag={props.onReorder ? track.id : undefined}
          >
            <button
              type="button"
              class="track-rail-button"
              aria-pressed={ariaBool(props.selectedTrackId === track.id)}
              onClick={() => props.onSelect(track.id)}
              onPointerDown={(event) => {
                if (props.onReorder) drag.begin(event, track.id);
              }}
            >
              <span class="track-rail-swatch" style={{ background: track.color }} />
              {/* The track's name, chosen by the user (ADR 0002 decision 2). */}
              <span class={`track-rail-name ${MASK_CONTENT}`}>{track.name}</span>
            </button>
          </li>
        )}
      </For>
    </ul>
  );
}
