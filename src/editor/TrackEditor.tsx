import { type Accessor, createSignal, Show } from "solid-js";
import type {
  Gesture,
  GestureOptions,
  RawCommandInput,
  TransactionResult,
} from "../commands";
import type { Clip, Instrument, Project } from "../domain/entities";
import type { EventId, TrackId } from "../domain/ids";
import InstrumentKindPicker from "../instrument/InstrumentKindPicker";
import type { LibrarySample } from "../library/assetDrag";
import { MASK_CONTENT } from "../monitoring/replayPrivacy";
import InstrumentArea from "./InstrumentArea";
import InstrumentPanel from "./InstrumentPanel";
import PianoRoll, { type PianoRollActions } from "./PianoRoll";
import StepEditor from "./StepEditor";
import TransformPanel from "./TransformPanel";

export interface TrackEditorProps {
  /** The edited track's clip, or null when it has none yet (#228). */
  readonly clip: Clip | null;
  readonly trackName: string | undefined;
  readonly packDependencyLabel: string | null;
  /** A synth track's note clip gets the CLP-03 piano roll instead of the grid. */
  readonly showPianoRoll: Accessor<boolean>;
  readonly instrument: Instrument | null;
  dispatch(
    commands: RawCommandInput | readonly RawCommandInput[],
  ): TransactionResult | undefined;
  beginGesture(options?: GestureOptions): Gesture | undefined;
  readonly editorPlaybackStep: Accessor<number | null>;
  readonly selectedNoteIds: Accessor<readonly EventId[]>;
  readonly setSelectedNoteIds: (ids: readonly EventId[]) => void;
  readonly project: Project;
  readonly playheadTicks: number;
  readonly registerPianoRollActions: (actions: PianoRollActions | null) => void;
  /** The edited track, when there is one; null while no project is open. */
  readonly instrumentPanelTrackId: TrackId | null;
  readonly sampleName: string | null;
  /** Loads a sound dropped from the library onto this track's sampler (#225). */
  readonly loadSample: (sample: LibrarySample) => void;
  readonly auditionInstrument: () => void;
}

/**
 * One track's editing surface: track info (name, pack dependency), the
 * CLP-02 step grid or CLP-03 piano roll switch, and the instrument panel.
 *
 * Split out of `EditorView` (`REFACTOR-001`); every prop here mirrors the
 * exact value/handler `EditorView` used to close over directly, so this is a
 * pure structural move.
 */
export default function TrackEditor(props: TrackEditorProps) {
  // The piano roll owns its own selection (the step editor's is lifted into
  // `EditorView`), so the roll mirrors it out here for the transformation
  // panel. Which of the two feeds the panel follows the editor on screen.
  const [rollSelection, setRollSelection] = createSignal<readonly EventId[]>([]);
  const transformSelection = () =>
    props.showPianoRoll() ? rollSelection() : props.selectedNoteIds();

  return (
    <div class="track-editor">
      <div class="track-info">
        {/* The track's name, chosen by the user (ADR 0002 decision 2). */}
        <span class={`track-name ${MASK_CONTENT}`}>{props.trackName}</span>
        <Show when={props.packDependencyLabel}>
          <span class="pack-dependency">Pack: {props.packDependencyLabel}</span>
        </Show>
      </div>
      {/*
       * A track carries no clip until one is placed on it — a track added
       * from the mixer starts empty (#228). Its instrument panel below still
       * renders: the clip editor is what has nothing to show, not the track.
       */}
      <Show
        when={props.clip}
        fallback={<p class="no-clip">This track has no clip yet.</p>}
      >
        {(clip) => (
          <>
            {/*
             * A synth track's note clip gets the CLP-03 piano roll; everything
             * else stays on LOOP-010's CLP-02 step editor. Pitched notes want
             * two dimensions (pitch x time), which a one-row-per-step grid
             * cannot show.
             */}
            <Show
              when={props.showPianoRoll()}
              fallback={
                <StepEditor
                  clip={clip()}
                  instrument={props.instrument}
                  dispatch={props.dispatch}
                  beginGesture={props.beginGesture}
                  playbackStep={props.editorPlaybackStep}
                  selectedIds={props.selectedNoteIds}
                  setSelectedIds={props.setSelectedNoteIds}
                />
              }
            >
              <PianoRoll
                clip={clip()}
                project={props.project}
                dispatch={props.dispatch}
                beginGesture={props.beginGesture}
                playheadTicks={props.playheadTicks}
                registerActions={props.registerPianoRollActions}
                onSelectionChange={setRollSelection}
              />
            </Show>
            {/*
             * CLP-04's transformations sit below whichever editor is on screen
             * and act on that editor's selection, so one panel serves both
             * rather than each editor growing its own copy.
             */}
            <TransformPanel
              clip={clip()}
              project={props.project}
              selectedIds={transformSelection()}
              dispatch={props.dispatch}
              editor={props.showPianoRoll() ? "piano_roll" : "step"}
            />
          </>
        )}
      </Show>
      {/*
       * The track's instrument controls, in one region named for the track so
       * a sound dragged from the library lands on a particular one (#225).
       *
       * The kind picker leads them (#224). It sits outside `InstrumentPanel`
       * because that component is the switch *between* instrument panels and
       * the picker is what chooses which one — it must also show for a drum
       * machine and for a track with no instrument, neither of which reaches
       * that switch. Outside the clip `Show` above, too: a track with no clip
       * still has an instrument to choose (#228).
       */}
      <InstrumentArea
        trackName={props.trackName ?? "Track"}
        instrument={props.instrument}
        loadSample={props.loadSample}
      >
        <Show when={props.instrumentPanelTrackId}>
          {(trackId) => (
            <InstrumentKindPicker
              trackId={trackId()}
              project={props.project}
              instrument={props.instrument}
              dispatch={props.dispatch}
            />
          )}
        </Show>
        <Show when={props.instrumentPanelTrackId}>
          {(trackId) => (
            <InstrumentPanel
              trackId={trackId()}
              instrument={props.instrument}
              sampleName={props.sampleName}
              dispatch={props.dispatch}
              audition={props.auditionInstrument}
            />
          )}
        </Show>
      </InstrumentArea>
    </div>
  );
}
