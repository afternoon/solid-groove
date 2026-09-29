import type { JSX } from "@solidjs/web";
import type { RawCommandInput, TransactionResult } from "../commands";
import { updateTrack } from "../commands";
import type { Track } from "../domain/entities";
import { MASK_CONTENT } from "../monitoring/replayPrivacy";

export interface TrackNameInputProps {
  readonly track: Track;
  dispatch(
    commands: RawCommandInput | readonly RawCommandInput[],
  ): TransactionResult | undefined;
  /** Extra classes; the name is always masked from session replay. */
  readonly class: string;
}

/**
 * A track's name, typed in place: the one rename control the mixer strip and
 * the track header share. A change (Enter, or focus leaving) commits one
 * `track.update` through the command layer; an empty or unchanged name puts
 * the track's own back.
 */
export default function TrackNameInput(props: TrackNameInputProps): JSX.Element {
  return (
    // The track's name, typed here (ADR 0002 decision 2). The rest of the
    // surface stays visible — that is the mixing replay exists to observe.
    <input
      id={`track-name-${props.track.id}`}
      class={`${props.class} ${MASK_CONTENT}`}
      type="text"
      value={props.track.name}
      onChange={(event) => {
        const name = event.currentTarget.value.trim();
        if (name && name !== props.track.name) {
          props.dispatch(updateTrack(props.track.id, { name }));
        } else {
          event.currentTarget.value = props.track.name;
        }
      }}
    />
  );
}
