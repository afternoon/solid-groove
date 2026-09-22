import { type Accessor, createSignal, Show } from "solid-js";
import type {
  Gesture,
  GestureOptions,
  RawCommandInput,
  TransactionResult,
} from "../commands";
import type { Clip, Instrument, Project } from "../domain/entities";
import type { EventId } from "../domain/ids";
import { MASK_CONTENT } from "../monitoring/replayPrivacy";
import PianoRoll, { type PianoRollActions } from "./PianoRoll";
import StepEditor from "./StepEditor";
import TransformPanel from "./TransformPanel";

export interface TrackClipEditorProps {
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
}

/**
 * One track's clip: its name and pack dependency, and whichever of the two
 * editors that clip takes — the `CLP-02` step grid or the `CLP-03` piano roll —
 * with `CLP-04`'s transformations beneath.
 *
 * Split out of `TrackEditor` (`UI-001`), which used to carry this *and* the
 * track's instrument. The two are going to different places: sequencing becomes
 * a modal over the arrangement, and the instrument becomes a view of its own.
 * Every prop here is the exact value `TrackEditor` passed through, so this half
 * of the split is a pure relocation.
 */
export default function TrackClipEditor(props: TrackClipEditorProps) {
  // The piano roll owns its own selection (the step editor's is lifted into
  // `EditorView`), so the roll mirrors it out here for the transformation
  // panel. Which of the two feeds the panel follows the editor on screen.
  const [rollSelection, setRollSelection] = createSignal<readonly EventId[]>([]);
  const transformSelection = () =>
    props.showPianoRoll() ? rollSelection() : props.selectedNoteIds();

  return (
    <div class="track-clip-editor">
      <div class="track-info">
        {/* The track's name, chosen by the user (ADR 0002 decision 2). */}
        <span class={`track-name ${MASK_CONTENT}`}>{props.trackName}</span>
        <Show when={props.packDependencyLabel}>
          <span class="pack-dependency">Pack: {props.packDependencyLabel}</span>
        </Show>
      </div>
      {/*
       * A track carries no clip until one is placed on it — a track added
       * from the mixer starts empty (#228). Its instrument still has a home
       * elsewhere: the clip editor is what has nothing to show, not the track.
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
    </div>
  );
}
