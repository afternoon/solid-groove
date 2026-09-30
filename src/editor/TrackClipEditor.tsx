import { type Accessor, createSignal, Show } from "solid-js";
import type {
  Gesture,
  GestureOptions,
  RawCommandInput,
  TransactionResult,
} from "../commands";
import type { Clip, Instrument, Project } from "../domain/entities";
import type { EventId, PadId } from "../domain/ids";
import KeyPanel from "./pianoRoll/KeyPanel";
import PianoRoll from "./pianoRoll/PianoRoll";
import type { PianoRollActions } from "./pianoRoll/rollActions";
import StepEditor from "./StepEditor";
import TransformPanel from "./TransformPanel";

export interface TrackClipEditorProps {
  /** The edited track's clip, or null when it has none yet (#228). */
  readonly clip: Clip | null;
  /** A synth or sampler note clip gets the piano roll; a drum machine, the grid. */
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
  /** Whether the transport is running, and how the roll's Play toggles it. */
  readonly playing?: boolean;
  onTogglePlay?(): void;
  /** Plays one pitch on the track's instrument, for the roll's preview. */
  audition?(pitch: number, velocity: number): void;
  /** The step grid's selected row, shared with the drum machine (#643). */
  readonly selectedPadId?: PadId | null;
  onSelectPad?(padId: PadId): void;
  auditionPad?(padId: PadId): void;
}

/**
 * One track's clip, in whichever of the two editors it takes (the sequence
 * editor's title bar already names the track) — the `CLP-02` step grid, with the Transform panel
 * beneath, or the ARR-010 piano roll, with the Key and Transform panels side
 * by side beneath it.
 */
export default function TrackClipEditor(props: TrackClipEditorProps) {
  // The piano roll owns its own selection (the step editor's is lifted into
  // `EditorView`), and mirrors it out here for the Transform panel.
  const [rollSelection, setRollSelection] = createSignal<readonly EventId[]>([]);

  return (
    <div class={["track-clip-editor", { "with-roll": props.showPianoRoll() }]}>
      {/*
       * A track carries no clip until one is placed on it — a track added
       * from the mixer starts empty (#228).
       */}
      <Show
        when={props.clip}
        fallback={<p class="no-clip">This track has no clip yet.</p>}
      >
        {(clip) => (
          <Show
            when={props.showPianoRoll()}
            fallback={
              <>
                <StepEditor
                  clip={clip()}
                  instrument={props.instrument}
                  dispatch={props.dispatch}
                  beginGesture={props.beginGesture}
                  playbackStep={props.editorPlaybackStep}
                  selectedIds={props.selectedNoteIds}
                  setSelectedIds={props.setSelectedNoteIds}
                  selectedPadId={props.selectedPadId}
                  onSelectPad={(padId) => props.onSelectPad?.(padId)}
                  auditionPad={(padId) => props.auditionPad?.(padId)}
                />
                <TransformPanel
                  clip={clip()}
                  project={props.project}
                  selectedIds={props.selectedNoteIds()}
                  dispatch={props.dispatch}
                  editor="step"
                />
              </>
            }
          >
            <PianoRoll
              clip={clip()}
              project={props.project}
              dispatch={props.dispatch}
              beginGesture={props.beginGesture}
              playheadTicks={props.playheadTicks}
              playing={props.playing}
              onTogglePlay={() => props.onTogglePlay?.()}
              audition={(pitch, velocity) => props.audition?.(pitch, velocity)}
              registerActions={props.registerPianoRollActions}
              onSelectionChange={setRollSelection}
            />
            <div class="roll-panels">
              <KeyPanel musicalKey={props.project.song.key} dispatch={props.dispatch} />
              <TransformPanel
                clip={clip()}
                project={props.project}
                selectedIds={rollSelection()}
                dispatch={props.dispatch}
                editor="piano_roll"
              />
            </div>
          </Show>
        )}
      </Show>
    </div>
  );
}
