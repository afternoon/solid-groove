import { createSignal } from "solid-js";
import { addNotes } from "../../commands";
import type { NoteEvent } from "../../domain/entities";
import { createNoteEvent, type DomainFactoryContext } from "../../domain/factories";
import type { EventId } from "../../domain/ids";
import { TICKS_PER_SIXTEENTH } from "../../domain/time";
import type { ShortcutPlatform } from "../../shortcuts/keys";
import {
  pointerModifierHeld,
  suppressModifierDefault,
} from "../../shortcuts/pointerGestures";
import { startAutoScroll } from "./autoScroll";
import { pitchOf } from "./edits";
import { grabAt, isDrag, noteBox, rectFrom, rowAt, stepAt, touches } from "./layout";
import { type NoteDrag, type NoteDragHost, startNoteDrag } from "./noteDrag";
import { type PianoRollRow, rowIndexOf } from "./rows";
import { GUTTER_WIDTH } from "./useRollViewport";

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
  readonly copy: boolean;
  readonly base: ReadonlySet<EventId>;
  started: boolean;
  drag?: NoteDrag;
  stopScroll?: () => void;
  releaseAlt?: (held?: boolean) => void;
}

/**
 * The roll's pointer (ARR-010). A press that moves under 4 px is a click: on
 * an empty cell it adds a note at the last length used, selects it, plays it
 * and moves the insert marker there; on a note it selects that note. A press
 * that moves further is a lasso from empty space, or a note drag from a note
 * (`startNoteDrag`). Shift or Cmd/Ctrl adds to a selection, or takes a
 * clicked note out of it.
 *
 * The press is a plain variable rather than a signal: a pointerup has to see
 * what its pointerdown just set, and a signal write is only visible after the
 * flush. Pointer capture waits until a drag starts, so a click and a
 * double-click still land on the note that was clicked.
 */
export function useRollPointer(host: RollPointerHost) {
  const [lasso, setLasso] = createSignal<ReturnType<typeof rectFrom> | null>(null);
  const [frozenRows, setFrozenRows] = createSignal<readonly PianoRollRow[] | null>(null);
  let press: Press | null = null;
  let pointer: { clientX: number; clientY: number } | null = null;
  let lastLength = TICKS_PER_SIXTEENTH;

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
    const copy = pointerModifierHeld("piano_roll.drag_copy", event, host.platform);
    const start = contentPoint(event.clientX, event.clientY);
    press = { start, add, note, copy, base: selected, started: false };
    if (copy) press.releaseAlt = suppressModifierDefault("piano_roll.drag_copy", window);
  }

  function pressEmpty(event: PointerEvent): void {
    if ((event.button ?? 0) !== 0) return;
    const start = contentPoint(event.clientX, event.clientY);
    press = {
      start,
      add: adds(event),
      copy: false,
      base: host.selected(),
      started: false,
    };
  }

  function begin(current: Press, event: PointerEvent): boolean {
    current.started = true;
    host.grid()?.setPointerCapture?.(event.pointerId);
    if (current.note) {
      const box = noteBox(
        current.note.startTicks,
        current.note.durationTicks,
        0,
        host.zoom(),
      );
      const grab = grabAt(current.start.x - box.left, box.width);
      const drag = startNoteDrag(
        { ...host, ids: host.factory.ids },
        current.note,
        grab,
        current.copy && grab === "body",
      );
      if (!drag) return false;
      current.drag = drag;
      setFrozenRows(drag.rows);
    }
    current.stopScroll = startAutoScroll({
      scroller: host.scroller,
      pointer: () => pointer,
      leftInset: GUTTER_WIDTH,
      onScrolled: () => pointer && update(current, pointer.clientX, pointer.clientY),
    });
    return true;
  }

  function update(current: Press, clientX: number, clientY: number): void {
    const point = contentPoint(clientX, clientY);
    if (current.drag) {
      current.drag.update(point.x - current.start.x, point.y - current.start.y);
      return;
    }
    const rect = rectFrom(current.start.x, current.start.y, point.x, point.y);
    setLasso(rect);
    const rows = host.rows();
    const hit = host.notes().filter((note) => {
      const row = rowIndexOf(rows, pitchOf(note));
      const box = noteBox(note.startTicks, note.durationTicks, row, host.zoom());
      return row >= 0 && touches(box, rect);
    });
    const ids = hit.map((note) => note.id);
    host.setSelection(new Set(current.add ? [...current.base, ...ids] : ids));
  }

  function move(event: PointerEvent): void {
    const current = press;
    if (!current) return;
    pointer = { clientX: event.clientX, clientY: event.clientY };
    if (!current.started) {
      const point = contentPoint(event.clientX, event.clientY);
      if (!isDrag(point.x - current.start.x, point.y - current.start.y)) return;
      if (!begin(current, event)) {
        press = null;
        return;
      }
    }
    update(current, event.clientX, event.clientY);
  }

  /** Ends the press, whichever way it ends, and hands it back once. */
  function finish(): Press | null {
    const current = press;
    press = null;
    pointer = null;
    current?.stopScroll?.();
    current?.releaseAlt?.(false);
    setLasso(null);
    setFrozenRows(null);
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
    if (!current) return;
    if (current.drag) {
      const count = current.drag.finish();
      if (count > 0) host.onEdited(count);
      lastLength = current.drag.resizedTicks() ?? lastLength;
    } else if (current.started) {
      return;
    } else if (!current.note) {
      addNoteAt(current.start, current.add);
    } else if (!current.add && current.base.size > 1) {
      host.setSelection(new Set([current.note.id]));
    }
  }

  function cancel(): void {
    finish()?.drag?.cancel();
  }

  return { pressNote, pressEmpty, move, release, cancel, lasso, frozenRows };
}
