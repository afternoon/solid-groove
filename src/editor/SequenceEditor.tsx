import type { JSX } from "@solidjs/web";
import { type Accessor, onSettled, Show } from "solid-js";
import type {
  Gesture,
  GestureOptions,
  RawCommandInput,
  TransactionResult,
} from "../commands";
import Dialog from "../components/Dialog";
import type { Clip, Project, Track } from "../domain/entities";
import type { EventId } from "../domain/ids";
import { MASK_CONTENT } from "../monitoring/replayPrivacy";
import type { LoopClipEntry } from "./editorViewModel";
import LoopInfo from "./LoopInfo";
import type { PianoRollActions } from "./PianoRoll";
import TrackClipEditor from "./TrackClipEditor";
import "./SequenceEditor.css";

export interface SequenceEditorProps {
  readonly clip: Clip;
  readonly track: Track;
  readonly project: Project;
  readonly packDependencyLabel: string | null;
  /** The clip takes the CLP-03 piano roll rather than the CLP-02 step grid. */
  readonly showPianoRoll: Accessor<boolean>;
  /** Set when the opened clip is a tempo-labelled audio loop (LOOP-006). */
  readonly loop: LoopClipEntry | null;
  readonly songTempo: number;
  readonly editorPlaybackStep: Accessor<number | null>;
  readonly selectedNoteIds: Accessor<readonly EventId[]>;
  readonly setSelectedNoteIds: (ids: readonly EventId[]) => void;
  readonly playheadTicks: number;
  readonly registerPianoRollActions: (actions: PianoRollActions | null) => void;
  dispatch(
    commands: RawCommandInput | readonly RawCommandInput[],
  ): TransactionResult | undefined;
  beginGesture(options?: GestureOptions): Gesture | undefined;
  onClose(): void;
}

/**
 * The sequence editor (`UI-001`): one clip, almost the whole window, over
 * whichever view opened it.
 *
 * The step grid and the piano roll used to be panels stacked under the
 * arrangement, always mounted for the selected track and sharing their height
 * with everything else in the workspace. Here they get the room instead — the
 * piano roll most of all — and they show the clip you *opened* rather than the
 * one the selection happens to imply.
 *
 * `role="dialog"` is an accessibility fact: this is a window over the page and
 * a screen reader has to be told so. It is deliberately **not** the shortcut
 * layer's `dialog` context, which would take the keyboard from everything
 * underneath: `EditorView` gives it `sequence_editor` instead, so the
 * transport, the note shortcuts and `1`/`2`/`3` keep working while a producer
 * programs. `Escape` closes it, through the registry's `view.close_surface`.
 */
export default function SequenceEditor(props: SequenceEditorProps): JSX.Element {
  return (
    <Dialog
      label="Sequence editor"
      size="jumbo"
      onClose={() => props.onClose()}
      header={
        /* The track's name, chosen by the user (ADR 0002 decision 2). */
        <h2 class={`sequence-editor-title ${MASK_CONTENT}`}>{props.track.name}</h2>
      }
    >
      <div class="sequence-editor-body">
        <TrackClipEditor
          clip={props.clip}
          trackName={props.track.name}
          packDependencyLabel={props.packDependencyLabel}
          showPianoRoll={props.showPianoRoll}
          instrument={props.track.instrument ?? null}
          dispatch={props.dispatch}
          beginGesture={props.beginGesture}
          editorPlaybackStep={props.editorPlaybackStep}
          selectedNoteIds={props.selectedNoteIds}
          setSelectedNoteIds={props.setSelectedNoteIds}
          project={props.project}
          playheadTicks={props.playheadTicks}
          registerPianoRollActions={props.registerPianoRollActions}
        />
        {/* An audio loop has no notes to program, so what it gets is what
              LOOP-006 always showed: the tempo it was recorded at, and how
              following the song tempo will treat it. */}
        <Show when={props.loop}>
          {(entry) => (
            <LoopInfo
              clip={entry().clip}
              asset={entry().asset}
              songTempo={props.songTempo}
            />
          )}
        </Show>
      </div>
    </Dialog>
  );
}
