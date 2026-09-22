import { Show } from "solid-js";
import type {
  Gesture,
  GestureOptions,
  RawCommandInput,
  TransactionResult,
} from "../commands";
import type { Instrument, Project } from "../domain/entities";
import type { TrackId } from "../domain/ids";
import InstrumentKindPicker from "../instrument/InstrumentKindPicker";
import type { LibrarySample } from "../library/assetDrag";
import InstrumentArea from "./InstrumentArea";
import InstrumentPanel from "./InstrumentPanel";

export interface TrackInstrumentProps {
  readonly trackName: string | undefined;
  readonly instrument: Instrument | null;
  readonly project: Project;
  /** The edited track, when there is one; null while no project is open. */
  readonly trackId: TrackId | null;
  readonly sampleName: string | null;
  /** Loads a sound dropped from the library onto this track's sampler (#225). */
  readonly loadSample: (sample: LibrarySample) => void;
  readonly audition: () => void;
  dispatch(
    commands: RawCommandInput | readonly RawCommandInput[],
  ): TransactionResult | undefined;
  beginGesture(options?: GestureOptions): Gesture | undefined;
}

/**
 * One track's instrument: the kind picker and whichever panel that kind gets,
 * inside a region named for the track so a sound dragged from the library lands
 * on a particular one (#225).
 *
 * Split out of `TrackEditor` (`UI-001`), which used to carry this *and* the
 * track's clip; every prop is the exact value it passed through, so this half
 * of the split is a pure relocation.
 *
 * The kind picker leads (#224). It sits outside `InstrumentPanel` because that
 * component is the switch *between* instrument panels and the picker is what
 * chooses which one — it must also show for a drum machine and for a track with
 * no instrument, neither of which reaches that switch. It is outside the clip
 * editor entirely for the same reason a track with no clip still has an
 * instrument to choose (#228).
 */
export default function TrackInstrument(props: TrackInstrumentProps) {
  return (
    <InstrumentArea
      trackName={props.trackName ?? "Track"}
      instrument={props.instrument}
      loadSample={props.loadSample}
    >
      <Show when={props.trackId}>
        {(trackId) => (
          <InstrumentKindPicker
            trackId={trackId()}
            project={props.project}
            instrument={props.instrument}
            dispatch={props.dispatch}
          />
        )}
      </Show>
      <Show when={props.trackId}>
        {(trackId) => (
          <InstrumentPanel
            trackId={trackId()}
            instrument={props.instrument}
            sampleName={props.sampleName}
            dispatch={props.dispatch}
            beginGesture={props.beginGesture}
            audition={props.audition}
          />
        )}
      </Show>
    </InstrumentArea>
  );
}
