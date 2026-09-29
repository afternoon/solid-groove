// The piano roll's pitch rows (ARR-010): which pitches the roll shows, top to
// bottom, and what each is called.
//
// Pure and framework-free, like every model behind the roll: the component
// renders what this returns and the tests assert it without a DOM.

import { isPitchInKey, type MusicalKey, pitchClassOf } from "../../domain/musicalKey";

/** C0 in Ableton's numbering, where MIDI 60 is C3. */
export const LOWEST_PITCH = 24;
/** C6 in Ableton's numbering. */
export const HIGHEST_PITCH = 96;
/** Where an empty clip opens: C3, MIDI 60. */
export const HOME_PITCH = 60;

/** Pitch-class names, sharps spelled `♯`, C = 0. */
export const PITCH_CLASS_NAMES = [
  "C",
  "C♯",
  "D",
  "D♯",
  "E",
  "F",
  "F♯",
  "G",
  "G♯",
  "A",
  "A♯",
  "B",
] as const;

/**
 * A pitch's name in Ableton's numbering, where MIDI 60 is C3 and 48 is C2 —
 * the names a producer coming from Live reads. The `(pitch / 12) - 2` is that
 * numbering, one octave below the scientific C4.
 */
export function pitchName(pitch: number): string {
  return `${PITCH_CLASS_NAMES[pitchClassOf(pitch)]}${Math.floor(pitch / 12) - 2}`;
}

/** Whether a pitch is a black key on a piano. */
export function isBlackKey(pitch: number): boolean {
  const pitchClass = pitchClassOf(pitch);
  return (
    pitchClass === 1 ||
    pitchClass === 3 ||
    pitchClass === 6 ||
    pitchClass === 8 ||
    pitchClass === 10
  );
}

/** One row the roll shows. */
export interface PianoRollRow {
  readonly pitch: number;
  readonly black: boolean;
  /** Outside the key, and shown only because a note sits on it. */
  readonly off: boolean;
}

/**
 * The rows the roll shows, highest pitch first.
 *
 * Chromatic shows every pitch from C0 to C6. A scale shows only its own
 * pitches, plus any row that already holds a note, marked `off` when that
 * note is outside the key — so choosing a scale never hides a note. A note
 * outside C0–C6 gets its row too, for the same reason.
 */
export function visibleRows(
  key: MusicalKey,
  notePitches: Iterable<number>,
): readonly PianoRollRow[] {
  const used = new Set(notePitches);
  let high = HIGHEST_PITCH;
  let low = LOWEST_PITCH;
  for (const pitch of used) {
    high = Math.max(high, pitch);
    low = Math.min(low, pitch);
  }
  const rows: PianoRollRow[] = [];
  for (let pitch = high; pitch >= low; pitch -= 1) {
    const inKey = isPitchInKey(key, pitch);
    const inRange = pitch >= LOWEST_PITCH && pitch <= HIGHEST_PITCH;
    if ((inKey && inRange) || used.has(pitch)) {
      rows.push({ pitch, black: isBlackKey(pitch), off: !inKey });
    }
  }
  return rows;
}

/** The row index showing `pitch`, or -1 when no row does. */
export function rowIndexOf(rows: readonly PianoRollRow[], pitch: number): number {
  return rows.findIndex((row) => row.pitch === pitch);
}

/**
 * The row an empty clip opens on, or the middle of the rows its notes span:
 * the row index the roll scrolls to the centre of the view.
 */
export function focusRow(
  rows: readonly PianoRollRow[],
  notePitches: readonly number[],
): number {
  const indices = notePitches
    .map((pitch) => rowIndexOf(rows, pitch))
    .filter((index) => index >= 0);
  if (indices.length === 0) {
    const home = rowIndexOf(rows, HOME_PITCH);
    if (home >= 0) return home;
    // A scale without C: the nearest row below where C3 would be.
    const below = rows.findIndex((row) => row.pitch < HOME_PITCH);
    return below >= 0 ? below : 0;
  }
  return (Math.min(...indices) + Math.max(...indices)) / 2;
}
