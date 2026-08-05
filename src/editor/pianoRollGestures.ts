// Pure, framework-free gesture model for the CLP-03 piano roll.
//
// The component (`PianoRoll.tsx`) owns pointer state, gestures, and command
// dispatch; everything that is a *function of the clip and the viewport* lives
// here so it can be unit-tested without a DOM. Nothing in this module mutates a
// project — it reads a clip's note content and returns plain descriptions of the
// change (`note.update` payload changes, selection sets, hit-test results) that
// the component hands to the shared command layer.
//
// This is the same split `stepEditorModel.ts` makes for the CLP-02 step editor:
// clip length and the `PianoRollViewport` are *arguments*, never closed-over
// props, which is exactly what makes move/resize clamping, marquee sweeps, and
// selection algebra provable at the lowest layer.

import type { NoteChanges } from "../commands";
import type { Clip, NoteEvent } from "../domain/entities";
import type { EventId } from "../domain/ids";
import { TICKS_PER_SIXTEENTH, toTicks } from "../domain/time";
import {
	MAX_PITCH,
	MIN_PITCH,
	noteIntersectsRect,
	type PianoRollViewport,
	snapTicks,
} from "./pianoRollGeometry";

/** One entry of a `note.update` batch: which event, and what changes. */
export interface NoteUpdate {
	eventId: EventId;
	changes: NoteChanges;
}

/** A content-space rectangle, the shape `noteIntersectsRect` hit-tests against. */
export interface ContentRect {
	readonly left: number;
	readonly top: number;
	readonly right: number;
	readonly bottom: number;
}

/** The clip's note events, or an empty list for non-note content. */
export function noteEvents(clip: Clip): readonly NoteEvent[] {
	return clip.content.kind === "notes" ? clip.content.events : [];
}

/** A note's MIDI pitch; a non-pitched trigger reads as middle C. */
export function pitchOf(note: NoteEvent): number {
	return note.trigger.kind === "pitch" ? note.trigger.pitch : 60;
}

/** Clamps a pitch into the roll's displayable MIDI range. */
export function clampPitch(pitch: number): number {
	if (pitch < MIN_PITCH) return MIN_PITCH;
	if (pitch > MAX_PITCH) return MAX_PITCH;
	return pitch;
}

/** Keeps a moved note inside the clip: start >= 0, and it never spills past the end. */
export function clampStart(
	startTicks: number,
	durationTicks: number,
	clipLengthTicks: number,
): number {
	const maxStart = Math.max(0, clipLengthTicks - durationTicks);
	return Math.min(Math.max(0, startTicks), maxStart);
}

/**
 * The `note.update` batch for a move drag: every dragged note shifts by the same
 * snapped tick delta and the same whole number of pitch rows, each clamped
 * independently so one note hitting a boundary never drags the others with it.
 */
export function moveUpdates(
	originals: readonly NoteEvent[],
	deltaTicks: number,
	pitchDelta: number,
	clipLengthTicks: number,
): NoteUpdate[] {
	return originals.map((original) => ({
		eventId: original.id,
		changes: {
			startTicks: toTicks(
				clampStart(
					snapTicks(original.startTicks + deltaTicks),
					original.durationTicks,
					clipLengthTicks,
				),
			),
			trigger: {
				kind: "pitch" as const,
				pitch: clampPitch(pitchOf(original) + pitchDelta),
			},
		},
	}));
}

/**
 * The `note.update` batch for a resize drag. A note never shrinks below one 16th
 * and never grows past the clip's end.
 */
export function resizeUpdates(
	originals: readonly NoteEvent[],
	deltaTicks: number,
	clipLengthTicks: number,
): NoteUpdate[] {
	return originals.map((original) => {
		const snapped = Math.max(
			TICKS_PER_SIXTEENTH,
			snapTicks(original.durationTicks + deltaTicks),
		);
		const maxDuration = clipLengthTicks - original.startTicks;
		return {
			eventId: original.id,
			changes: {
				durationTicks: toTicks(
					Math.max(TICKS_PER_SIXTEENTH, Math.min(snapped, maxDuration)),
				),
			},
		};
	});
}

/**
 * How many pitch rows a pointer has travelled. Upward pointer movement (a
 * *smaller* clientY) raises the pitch, so the sign is inverted here rather than
 * at each call site.
 */
export function pitchDeltaOf(
	pointerStartY: number,
	clientY: number,
	rowHeight: number,
): number {
	return Math.round((pointerStartY - clientY) / rowHeight);
}

/** How many ticks a pointer has travelled horizontally, before snapping. */
export function tickDeltaOf(
	pointerStartX: number,
	clientX: number,
	pixelsPerTick: number,
): number {
	return (clientX - pointerStartX) / pixelsPerTick;
}

// --- Selection algebra ---------------------------------------------------

/** The selection containing only `id`. */
export function selectOnly(id: EventId): ReadonlySet<EventId> {
	return new Set([id]);
}

/** `current` with `id` added if absent, removed if present (shift+click). */
export function toggleSelected(
	current: ReadonlySet<EventId>,
	id: EventId,
): ReadonlySet<EventId> {
	const next = new Set(current);
	if (next.has(id)) next.delete(id);
	else next.add(id);
	return next;
}

/** Every note in the clip. */
export function selectAll(clip: Clip): ReadonlySet<EventId> {
	return new Set(noteEvents(clip).map((note) => note.id));
}

// --- Marquee -------------------------------------------------------------

/**
 * Normalizes a marquee's two corners into a rectangle, so a drag up-and-left
 * sweeps exactly the same notes as the equivalent drag down-and-right.
 */
export function marqueeRect(
	startX: number,
	startY: number,
	x: number,
	y: number,
): ContentRect {
	return {
		left: Math.min(startX, x),
		right: Math.max(startX, x),
		top: Math.min(startY, y),
		bottom: Math.max(startY, y),
	};
}

/**
 * The notes a marquee rectangle sweeps. The hit test itself lives in
 * `pianoRollGeometry`; this walks the clip and collects the ids, which is what
 * the roll's selection signal wants.
 */
export function notesInRect(
	clip: Clip,
	viewport: PianoRollViewport,
	rect: ContentRect,
): ReadonlySet<EventId> {
	const swept = new Set<EventId>();
	for (const note of noteEvents(clip)) {
		if (
			noteIntersectsRect(
				viewport,
				{
					startTicks: note.startTicks,
					durationTicks: note.durationTicks,
					pitch: pitchOf(note),
				},
				rect,
			)
		) {
			swept.add(note.id);
		}
	}
	return swept;
}
