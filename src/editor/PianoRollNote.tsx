import type { JSX } from "@solidjs/web";
import type { NoteEvent } from "../domain/entities";
import { NOTE_VELOCITY } from "../domain/parameters";
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
      <input
        class="pr-note-velocity"
        type="range"
        min={NOTE_VELOCITY.min}
        max={NOTE_VELOCITY.max}
        step={0.01}
        value={props.note.velocity}
        aria-label={`Velocity of ${pitchLabel(pitchOf(props.note))}`}
        onPointerDown={(event) => event.stopPropagation()}
        onInput={(event) =>
          props.applyVelocity(props.note, event.currentTarget.valueAsNumber)
        }
        // `change` fires once the drag (or keyboard nudge) settles;
        // pointer-up/cancel cover the mouse path. All commit the one
        // open gesture — extra calls are a safe no-op.
        onChange={() => props.commitVelocity()}
        onPointerUp={() => props.commitVelocity()}
        onPointerCancel={() => props.commitVelocity()}
      />
    </div>
  );
}
