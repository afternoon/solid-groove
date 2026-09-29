// The piano roll's note edits (ARR-010), as pure functions of the notes they
// act on: a move, a resize from either end, a copy, a paste, a velocity drag.
//
// Nothing here dispatches. Each function returns the `note.update` batch or
// the new notes a command carries, and the component hands those to the
// command layer, so a pointer drag, an arrow key and a test all build exactly
// the same edit. Positions are ticks on the fixed 1/16 grid; rows are the
// ones `visibleRows` returned when the edit began.

import type { NoteChanges } from "../../commands";
import type { NoteEvent } from "../../domain/entities";
import type { EventId } from "../../domain/ids";
import { NOTE_VELOCITY } from "../../domain/parameters";
import { TICKS_PER_SIXTEENTH, toTicks } from "../../domain/time";
import { type PianoRollRow, rowIndexOf } from "./rows";

const STEP = TICKS_PER_SIXTEENTH;

/** One entry of a `note.update` batch. */
export interface NoteUpdate {
  readonly eventId: EventId;
  readonly changes: NoteChanges;
}

/** A pitched note's pitch; the roll only ever holds pitched notes. */
export function pitchOf(note: NoteEvent): number {
  return note.trigger.kind === "pitch" ? note.trigger.pitch : 60;
}

function endOf(note: NoteEvent): number {
  return note.startTicks + note.durationTicks;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/**
 * Moves notes by whole steps and whole visible rows, together.
 *
 * The group moves as one: the step and row deltas are clamped so that no note
 * leaves the clip or the rows, rather than each note stopping at the edge on
 * its own and the chord losing its shape. A row move steps through the rows
 * shown, so in a scale it moves by scale degree.
 */
export function moveNotes(
  notes: readonly NoteEvent[],
  steps: number,
  rowsDelta: number,
  rows: readonly PianoRollRow[],
  clipLengthTicks: number,
): NoteUpdate[] {
  if (notes.length === 0) return [];
  const earliest = Math.min(...notes.map((note) => note.startTicks));
  const latest = Math.max(...notes.map(endOf));
  const ticks = clamp(steps * STEP, -earliest, clipLengthTicks - latest);
  const indices = notes.map((note) => rowIndexOf(rows, pitchOf(note)));
  const placed = indices.every((index) => index >= 0);
  const rowShift = placed
    ? clamp(rowsDelta, -Math.min(...indices), rows.length - 1 - Math.max(...indices))
    : 0;
  return notes.map((note, index) => ({
    eventId: note.id,
    changes: {
      startTicks: toTicks(note.startTicks + ticks),
      trigger: {
        kind: "pitch" as const,
        pitch: placed ? rows[indices[index] + rowShift].pitch : pitchOf(note),
      },
    },
  }));
}

/**
 * Moves notes by whole octaves, or not at all when any would leave the MIDI
 * range: an octave that silently stopped short would no longer be an octave.
 */
export function moveOctaves(notes: readonly NoteEvent[], octaves: number): NoteUpdate[] {
  const semitones = octaves * 12;
  const moved = notes.map((note) => pitchOf(note) + semitones);
  if (moved.some((pitch) => pitch < 0 || pitch > 127)) return [];
  return notes.map((note, index) => ({
    eventId: note.id,
    changes: { trigger: { kind: "pitch" as const, pitch: moved[index] } },
  }));
}

/** Moves each note's end by whole steps: at least one step, never past the clip. */
export function resizeEnds(
  notes: readonly NoteEvent[],
  steps: number,
  clipLengthTicks: number,
): NoteUpdate[] {
  return notes.map((note) => ({
    eventId: note.id,
    changes: {
      durationTicks: toTicks(
        clamp(note.durationTicks + steps * STEP, STEP, clipLengthTicks - note.startTicks),
      ),
    },
  }));
}

/** Moves each note's start by whole steps, its end staying put. */
export function resizeStarts(notes: readonly NoteEvent[], steps: number): NoteUpdate[] {
  return notes.map((note) => {
    const end = endOf(note);
    const start = clamp(note.startTicks + steps * STEP, 0, end - STEP);
    return {
      eventId: note.id,
      changes: { startTicks: toTicks(start), durationTicks: toTicks(end - start) },
    };
  });
}

/** Copies of `notes` under new ids, where they are: an Alt-drag starts here. */
export function copiesOf(
  notes: readonly NoteEvent[],
  newIds: readonly EventId[],
): NoteEvent[] {
  return notes.map((note, index) => ({ ...note, id: newIds[index] }));
}

/** Where a copied selection ends, which is where the insert marker goes. */
export function endOfNotes(notes: readonly NoteEvent[]): number {
  return notes.length === 0 ? 0 : Math.max(...notes.map(endOf));
}

/**
 * The notes a paste adds: the clipboard laid down with its earliest note at
 * `atTicks`, pitches kept, as Ableton pastes. A note that would start past the
 * clip's end is left out and one that would run past it is shortened, so a
 * paste near the end adds what fits rather than nothing.
 */
export function pastedNotes(
  clipboard: readonly NoteEvent[],
  atTicks: number,
  clipLengthTicks: number,
  newIds: readonly EventId[],
): NoteEvent[] {
  if (clipboard.length === 0) return [];
  const earliest = Math.min(...clipboard.map((note) => note.startTicks));
  const placed: NoteEvent[] = [];
  clipboard.forEach((note, index) => {
    const start = note.startTicks - earliest + atTicks;
    if (start >= clipLengthTicks) return;
    placed.push({
      ...note,
      id: newIds[index],
      startTicks: toTicks(start),
      durationTicks: toTicks(Math.min(note.durationTicks, clipLengthTicks - start)),
    });
  });
  return placed;
}

/**
 * Velocity for a stalk drag: the dragged note takes `target` outright; with
 * others selected they all move by the same amount, so their differences
 * survive. Every value stays in the velocity range.
 */
export function velocityUpdates(
  notes: readonly NoteEvent[],
  anchor: NoteEvent,
  target: number,
): NoteUpdate[] {
  const delta = target - anchor.velocity;
  return notes.map((note) => ({
    eventId: note.id,
    changes: {
      velocity: clamp(
        note.id === anchor.id ? target : note.velocity + delta,
        NOTE_VELOCITY.min,
        NOTE_VELOCITY.max,
      ),
    },
  }));
}
