import type { JSX } from "@solidjs/web";
import type { NoteEvent } from "../domain/entities";
import { NOTE_VELOCITY } from "../domain/parameters";
import FillSlider from "../instrument/FillSlider";
import { pitchOf } from "./pianoRollGestures";
import { pitchLabel } from "./pitchClass";

export interface PianoRollNoteProps {
  readonly note: NoteEvent;
  readonly selected: boolean;
  /** Absolute position/size in content pixels, from `pianoRollGeometry`. */
  readonly style: JSX.CSSProperties;
  onPointerDown(note: NoteEvent, event: PointerEvent): void;
  onPointerMove(event: PointerEvent): void;
  onPointerUp(): void;
  /** One intermediate value from the velocity slider drag. */
  applyVelocity(note: NoteEvent, velocity: number): void;
  /** Commits (or cancels) the open velocity gesture. */
  commitVelocity(): void;
}

/**
 * One note in the roll: the draggable body (whose right edge is the resize
 * handle) plus its velocity slider.
 *
 * Every pointer handler forwards to the roll, which owns the drag state and the
 * command dispatch — this component decides nothing, so a note added or removed
 * cannot change gesture behavior.
 */
export default function PianoRollNote(props: PianoRollNoteProps): JSX.Element {
  return (
    <div
      class={["pr-note", { selected: props.selected }]}
      style={props.style}
      data-event-id={props.note.id}
      title={`Note ${pitchLabel(pitchOf(props.note))}`}
      onPointerDown={(event) => props.onPointerDown(props.note, event)}
      onPointerMove={(event) => props.onPointerMove(event)}
      onPointerUp={() => props.onPointerUp()}
    >
      <span class="pr-note-resize" aria-hidden="true" />
      {/* The same fill slider as every other continuous control in the editor,
			    in its compact shape — the note block has no room for a label row or a
			    readout, and a native thumb here read as a different control language
			    entirely (#255). Pressing it must not also start dragging the note, so
			    the wrapper swallows `pointerdown` before it reaches the note body.
			    `change` / pointer-up / pointer-cancel all reach `onCommit`, which
			    closes the one open gesture; extra commits are a safe no-op. */}
      <div class="pr-note-velocity" onPointerDown={(event) => event.stopPropagation()}>
        <FillSlider
          definition={NOTE_VELOCITY}
          inputId={`pr-note-velocity-${props.note.id}`}
          compact
          orientation="horizontal"
          ariaLabel={`Velocity of ${pitchLabel(pitchOf(props.note))}`}
          value={props.note.velocity}
          displayValue={String(Math.round(props.note.velocity * 127))}
          onInput={(value) => props.applyVelocity(props.note, value)}
          onCommit={() => props.commitVelocity()}
        />
      </div>
    </div>
  );
}
