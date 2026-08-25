// Pure pixel <-> musical-time geometry for the CLP-03 piano roll.
//
// The piano roll is a scrollable, zoomable canvas of pitch rows (vertical) and
// tick columns (horizontal). Every pointer interaction — where a click lands,
// how far a drag moved a note, which pitch a row is — is a coordinate
// conversion, and getting it right *under scroll and zoom* is the acceptance
// criterion this module exists to make provable at the lowest layer.
//
// Nothing here imports Solid, Tone, or the DOM: a `PianoRollViewport` is a
// plain description of the visible window, and every function is a total,
// deterministic map. The component measures the real element, builds a
// viewport, and calls these; a test builds a viewport literally and asserts the
// same maths without a browser.

import { TICKS_PER_SIXTEENTH } from "../domain/time";

/** Inclusive MIDI pitch range the roll can display (C-1 .. G9). */
export const MIN_PITCH = 0;
export const MAX_PITCH = 127;

/**
 * The visible window and scale of the roll.
 *
 * `pixelsPerTick` and `rowHeight` are the zoom; `scrollTicks` and `scrollTop`
 * are the scroll offset (the musical time / pixel at the left / top edge of the
 * visible area). `topPitch` is the pitch drawn in the first row — rows descend
 * in pitch downward, the way a keyboard reads from high notes at the top.
 */
export interface PianoRollViewport {
  readonly pixelsPerTick: number;
  readonly rowHeight: number;
  /** Tick shown at the left edge of the content area. */
  readonly scrollTicks: number;
  /** Pixel scrolled past the top of the content area. */
  readonly scrollTop: number;
  /** Pitch of the topmost row (row index 0). */
  readonly topPitch: number;
}

/** A rectangle in content pixels for one note, ready to position an element. */
export interface NoteRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

function clampPitch(pitch: number): number {
  if (pitch < MIN_PITCH) return MIN_PITCH;
  if (pitch > MAX_PITCH) return MAX_PITCH;
  return pitch;
}

/** Content-x (pixels from the content's left edge, before scroll) for a tick. */
export function tickToContentX(viewport: PianoRollViewport, ticks: number): number {
  return ticks * viewport.pixelsPerTick;
}

/** Content-y (pixels from the content's top edge) for the top of a pitch row. */
export function pitchToContentY(viewport: PianoRollViewport, pitch: number): number {
  return (viewport.topPitch - pitch) * viewport.rowHeight;
}

/**
 * Tick under a pointer at `clientX`, given the content element's own left edge
 * in client space. Scroll and zoom are both folded in: a pointer over the same
 * on-screen pixel maps to a later tick once the view is scrolled right, and to
 * a wider tick span once zoomed out.
 */
export function clientXToTick(
  viewport: PianoRollViewport,
  contentLeft: number,
  clientX: number,
): number {
  const contentX = clientX - contentLeft + viewport.scrollTicks * viewport.pixelsPerTick;
  return viewport.pixelsPerTick === 0 ? 0 : contentX / viewport.pixelsPerTick;
}

/**
 * Pitch under a pointer at `clientY`. The first visible row is `topPitch` minus
 * however many rows the vertical scroll has hidden, so this stays correct when
 * the roll is scrolled to a different octave.
 */
export function clientYToPitch(
  viewport: PianoRollViewport,
  contentTop: number,
  clientY: number,
): number {
  if (viewport.rowHeight === 0) return viewport.topPitch;
  const contentY = clientY - contentTop + viewport.scrollTop;
  const rowsDown = Math.floor(contentY / viewport.rowHeight);
  return clampPitch(viewport.topPitch - rowsDown);
}

/** Snaps a tick to the nearest 16th-note grid line. Never negative. */
export function snapTicks(ticks: number): number {
  const snapped = Math.round(ticks / TICKS_PER_SIXTEENTH) * TICKS_PER_SIXTEENTH;
  return Math.max(0, snapped);
}

/** Snaps a tick *down* to the 16th grid line at or before it (a note start). */
export function snapTicksFloor(ticks: number): number {
  const snapped = Math.floor(ticks / TICKS_PER_SIXTEENTH) * TICKS_PER_SIXTEENTH;
  return Math.max(0, snapped);
}

/**
 * The content rectangle for a note. Width never falls below one pixel so a very
 * short note stays clickable; height is exactly one row.
 */
export function noteRect(
  viewport: PianoRollViewport,
  note: { startTicks: number; durationTicks: number; pitch: number },
): NoteRect {
  return {
    left: tickToContentX(viewport, note.startTicks),
    top: pitchToContentY(viewport, note.pitch),
    width: Math.max(1, note.durationTicks * viewport.pixelsPerTick),
    height: viewport.rowHeight,
  };
}

/**
 * Whether a note intersects a content-space rectangle — the hit test a
 * rubber-band group selection uses. Both ranges are half-open on the far edge
 * so notes exactly touching the marquee's trailing edge are not swept in.
 */
export function noteIntersectsRect(
  viewport: PianoRollViewport,
  note: { startTicks: number; durationTicks: number; pitch: number },
  rect: { left: number; top: number; right: number; bottom: number },
): boolean {
  const noteLeft = tickToContentX(viewport, note.startTicks);
  const noteRight = tickToContentX(viewport, note.startTicks + note.durationTicks);
  const noteTop = pitchToContentY(viewport, note.pitch);
  const noteBottom = noteTop + viewport.rowHeight;
  return (
    noteLeft < rect.right &&
    noteRight > rect.left &&
    noteTop < rect.bottom &&
    noteBottom > rect.top
  );
}
