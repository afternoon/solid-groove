import { For, type JSX } from "@solidjs/web";
import type { Track } from "../domain/entities";
import type { TrackId } from "../domain/ids";
import { MASK_CONTENT } from "../monitoring/replayPrivacy";
import { ariaBool } from "../shared/aria";
import "./TrackRail.css";

export interface TrackRailProps {
  readonly tracks: readonly Track[];
  readonly selectedTrackId: TrackId | null;
  onSelect(trackId: TrackId): void;
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
  return (
    <ul class="track-rail" aria-label="Tracks">
      <For each={props.tracks}>
        {(track) => (
          <li class="track-rail-item">
            <button
              type="button"
              class="track-rail-button"
              aria-pressed={ariaBool(props.selectedTrackId === track.id)}
              onClick={() => props.onSelect(track.id)}
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
