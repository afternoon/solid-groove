import type { JSX } from "@solidjs/web";
import type { NoteEvent } from "../domain/entities";
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
}

/**
 * One note in the roll: the draggable body, whose right edge is the resize
 * handle. It carries no velocity control — a note block is a few pixels tall,
 * too cramped for a usable slider (#255).
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
    </div>
  );
}
