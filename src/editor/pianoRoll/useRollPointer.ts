import { addNotes } from "../../commands";
import type { NoteEvent } from "../../domain/entities";
import { createNoteEvent, type DomainFactoryContext } from "../../domain/factories";
import type { EventId } from "../../domain/ids";
import { TICKS_PER_SIXTEENTH } from "../../domain/time";
import type { ShortcutPlatform } from "../../shortcuts/keys";
import { pointerModifierHeld } from "../../shortcuts/pointerGestures";
import { pitchOf } from "./edits";
import { isDrag, rowAt, stepAt } from "./layout";
import type { NoteDragHost } from "./noteDrag";

/** What the pointer needs from the roll that owns it. */
export interface RollPointerHost extends Omit<NoteDragHost, "ids"> {
  setMarker(step: number): void;
  readonly grid: () => HTMLElement | undefined;
  readonly scroller: () => HTMLElement | undefined;
  dispatch(commands: ReturnType<typeof addNotes>): unknown;
  /** Called once per committed edit, with how many notes it touched. */
  onEdited(count: number): void;
  readonly factory: DomainFactoryContext;
  readonly platform: ShortcutPlatform;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

interface Press {
  readonly start: Point;
  /** Shift or Cmd/Ctrl: add to the selection rather than replace it. */
  readonly add: boolean;
  /** Set on a press that began on a note. */
  readonly note?: NoteEvent;
  readonly base: ReadonlySet<EventId>;
  started: boolean;
}

/**
 * The roll's pointer (ARR-010). A press that moves under 4 px is a click: on
 * an empty cell it adds a note at the last length used, selects it, plays it
 * and moves the insert marker there; on a note it selects that note. Shift or
 * Cmd/Ctrl adds to a selection, or takes a clicked note out of it. A press
 * that moves further is not a click, so it adds and selects nothing.
 *
 * The press is a plain variable rather than a signal: a pointerup has to see
 * what its pointerdown just set, and a signal write is only visible after the
 * flush.
 */
export function useRollPointer(host: RollPointerHost) {
  let press: Press | null = null;
  const lastLength = TICKS_PER_SIXTEENTH;

  function contentPoint(clientX: number, clientY: number): Point {
    const rect = host.grid()?.getBoundingClientRect();
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
  }

  function adds(event: PointerEvent): boolean {
    return (
      pointerModifierHeld("piano_roll.toggle_select", event, host.platform) ||
      pointerModifierHeld("piano_roll.shift_select", event, host.platform)
    );
  }

  function pressNote(note: NoteEvent, event: PointerEvent): void {
    if ((event.button ?? 0) !== 0) return;
    event.stopPropagation();
    const add = adds(event);
    const selected = host.selected();
    if (add && selected.has(note.id)) {
      host.setSelection(new Set([...selected].filter((id) => id !== note.id)));
      return;
    }
    if (add) host.setSelection(new Set([...selected, note.id]));
    else if (!selected.has(note.id)) host.setSelection(new Set([note.id]));
    host.audition(pitchOf(note), note.velocity);
    const start = contentPoint(event.clientX, event.clientY);
    press = { start, add, note, base: selected, started: false };
  }

  function pressEmpty(event: PointerEvent): void {
    if ((event.button ?? 0) !== 0) return;
    const start = contentPoint(event.clientX, event.clientY);
    press = { start, add: adds(event), base: host.selected(), started: false };
  }

  function move(event: PointerEvent): void {
    const current = press;
    if (!current || current.started) return;
    const point = contentPoint(event.clientX, event.clientY);
    if (isDrag(point.x - current.start.x, point.y - current.start.y)) {
      current.started = true;
    }
  }

  /** Ends the press, whichever way it ends, and hands it back once. */
  function finish(): Press | null {
    const current = press;
    press = null;
    return current;
  }

  function addNoteAt(point: Point, add: boolean): void {
    const step = stepAt(point.x, host.zoom());
    const row = host.rows()[rowAt(point.y)];
    const startTicks = step * TICKS_PER_SIXTEENTH;
    const length = host.clip().lengthTicks;
    if (!row || step < 0 || startTicks >= length) return;
    const note = createNoteEvent(host.factory, {
      startTicks,
      durationTicks: Math.min(lastLength, length - startTicks),
      pitch: row.pitch,
    });
    host.dispatch(addNotes(host.clip().id, [note]));
    host.onEdited(1);
    host.setSelection(new Set(add ? [...host.selected(), note.id] : [note.id]));
    host.setMarker(step);
    host.audition(row.pitch, note.velocity);
  }

  function release(): void {
    const current = finish();
    if (!current || current.started) return;
    if (!current.note) {
      addNoteAt(current.start, current.add);
    } else if (!current.add && current.base.size > 1) {
      host.setSelection(new Set([current.note.id]));
    }
  }

  function cancel(): void {
    finish();
  }

  return { pressNote, pressEmpty, move, release, cancel };
}
