import type { Gesture, GestureOptions } from "../../commands";
import { addNotes, updateNotes } from "../../commands";
import type { Clip, NoteEvent } from "../../domain/entities";
import type { EventId, IdFactory } from "../../domain/ids";
import { copiesOf, moveNotes, type NoteUpdate, resizeEnds, resizeStarts } from "./edits";
import { type NoteGrab, ROW_HEIGHT, stepWidth } from "./layout";
import type { PianoRollRow } from "./rows";

/** What a note drag needs from the roll. */
export interface NoteDragHost {
  readonly clip: () => Clip;
  readonly notes: () => readonly NoteEvent[];
  readonly rows: () => readonly PianoRollRow[];
  readonly zoom: () => number;
  readonly selected: () => ReadonlySet<EventId>;
  setSelection(ids: ReadonlySet<EventId>): void;
  beginGesture(options?: GestureOptions): Gesture | undefined;
  audition(pitch: number, velocity: number): void;
  readonly ids: IdFactory;
}

export interface NoteDrag {
  /** The rows as they were when the drag began; they hold still until it ends. */
  readonly rows: readonly PianoRollRow[];
  /** The pointer has moved `dx`, `dy` content pixels from where it pressed. */
  update(dx: number, dy: number): void;
  /** Commits the drag as one edit; how many notes it touched, or 0 for none. */
  finish(): number;
  cancel(): void;
  /** After a resize, the grabbed note's length: the next new note's length. */
  resizedTicks(): number | null;
}

/**
 * A drag that began on a note (ARR-010): its middle moves the selection and
 * either end resizes it, and with Alt held the selection is copied first and
 * the copies move, leaving the originals where they were.
 *
 * The whole drag is one gesture, so one undo entry and one revision however
 * far it went. Each frame applies the edit from where the drag began, never
 * from the last frame, so a drag that comes back to its start lands exactly
 * where it started.
 */
export function startNoteDrag(
  host: NoteDragHost,
  anchor: NoteEvent,
  grab: NoteGrab,
  copy: boolean,
): NoteDrag | null {
  const summary = copy ? "Copy notes" : grab === "body" ? "Move notes" : "Resize notes";
  const begun = host.beginGesture({ summary });
  if (!begun) return null;
  const gesture: Gesture = begun;
  const rows = host.rows();
  const ids = new Set([...host.selected(), anchor.id]);
  let originals = host.notes().filter((note) => ids.has(note.id));
  let anchorId = anchor.id;
  if (copy) {
    const newIds = originals.map(() => host.ids("event"));
    const copies = copiesOf(originals, newIds);
    gesture.apply(addNotes(host.clip().id, copies));
    anchorId = newIds[originals.findIndex((note) => note.id === anchor.id)];
    originals = copies;
    host.setSelection(new Set(newIds));
  }
  let last = "";
  let applied: readonly NoteUpdate[] = [];

  const anchorUpdate = (updates: readonly NoteUpdate[]) =>
    updates.find((update) => update.eventId === anchorId)?.changes;

  function update(dx: number, dy: number): void {
    const steps = Math.round(dx / stepWidth(host.zoom()));
    const rowShift = grab === "body" ? Math.round(dy / ROW_HEIGHT) : 0;
    const key = `${steps}:${rowShift}`;
    if (key === last) return;
    last = key;
    const length = host.clip().lengthTicks;
    const updates =
      grab === "body"
        ? moveNotes(originals, steps, rowShift, rows, length)
        : grab === "end"
          ? resizeEnds(originals, steps, length)
          : resizeStarts(originals, steps);
    gesture.apply(updateNotes(host.clip().id, updates));
    const before = anchorUpdate(applied)?.trigger ?? anchor.trigger;
    const after = anchorUpdate(updates)?.trigger;
    if (
      after?.kind === "pitch" &&
      before.kind === "pitch" &&
      after.pitch !== before.pitch
    ) {
      host.audition(after.pitch, anchor.velocity);
    }
    applied = updates;
  }

  return {
    rows,
    update,
    finish: () => (gesture.commit() ? originals.length : 0),
    cancel: () => gesture.cancel(),
    resizedTicks: () =>
      grab === "body" ? null : (anchorUpdate(applied)?.durationTicks ?? null),
  };
}
