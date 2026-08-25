import type { BucketLabel } from "../analytics/buckets";
import { bucketOf } from "../analytics/buckets";
import type { Clip, Instrument, NoteEvent, NoteTrigger } from "../domain/entities";
import type { EventId, PadId } from "../domain/ids";
import { TICKS_PER_BAR, TICKS_PER_SIXTEENTH } from "../domain/time";

/**
 * Pure, framework-free model for the CLP-02 step editor.
 *
 * The component (`StepEditor.tsx`) owns pointer state, gestures, and command
 * dispatch; everything that is a *function of the clip and instrument* lives
 * here so it can be unit-tested without a DOM. Nothing in this module mutates a
 * project — it only reads a clip's note content and the owning track's
 * instrument to describe the grid.
 */

/** A 16th note is the grid's fixed resolution (PRD CLP-02, 192 PPQ). */
export const STEPS_PER_BAR = TICKS_PER_BAR / TICKS_PER_SIXTEENTH;

/** The clip-length range CLP-02 supports, in bars. */
export const MIN_BARS = 1;
export const MAX_BARS = 8;

/**
 * One row of the grid. A drum-machine clip shows one lane per pad, named after
 * the pad; a sampler clip shows a single pitched lane. `trigger` is what a note
 * painted into this lane fires.
 */
export interface StepLane {
  readonly key: string;
  readonly name: string;
  readonly trigger: NoteTrigger;
}

/**
 * How many bars the clip spans, clamped to the 1-8 bar range. A clip whose
 * `lengthTicks` is not a whole number of bars rounds up to the next bar so no
 * step is hidden.
 */
export function barCount(clip: Clip): number {
  const bars = Math.ceil(clip.lengthTicks / TICKS_PER_BAR);
  return Math.min(MAX_BARS, Math.max(MIN_BARS, bars));
}

/** Total 16th-note steps across the clip's bars. */
export function stepCount(clip: Clip): number {
  return barCount(clip) * STEPS_PER_BAR;
}

/** The absolute start tick of a step index (0-based). */
export function stepStartTicks(step: number): number {
  return step * TICKS_PER_SIXTEENTH;
}

/** True at the first step of a bar (a heavier bar division). */
export function isBarStart(step: number): boolean {
  return step % STEPS_PER_BAR === 0;
}

/** True at the first step of a beat (a lighter beat division). */
export function isBeatStart(step: number): boolean {
  return step % (STEPS_PER_BAR / 4) === 0;
}

/** Whether two triggers name the same lane (pitch value, or pad id). */
export function triggersMatch(a: NoteTrigger, b: NoteTrigger): boolean {
  if (a.kind === "pitch" && b.kind === "pitch") return a.pitch === b.pitch;
  if (a.kind === "pad" && b.kind === "pad") return a.padId === b.padId;
  return false;
}

/**
 * The lanes to render for a clip on a track carrying `instrument`.
 *
 * - A `drumMachine` instrument yields one named lane per pad, top pad first, so
 *   hits can be painted across multiple lanes (CLP-02).
 * - Any other instrument (sampler, or none) yields a single pitched lane. The
 *   pitch matches the `FND-009` slice's kick so an existing slice clip keeps its
 *   notes on the one lane.
 */
export const SAMPLER_LANE_PITCH = 36;

export function lanesFor(instrument: Instrument | null): readonly StepLane[] {
  if (instrument?.kind === "drumMachine") {
    return instrument.pads.map((pad) => ({
      key: pad.id,
      name: pad.name,
      trigger: { kind: "pad", padId: pad.id },
    }));
  }
  return [
    {
      key: `pitch:${SAMPLER_LANE_PITCH}`,
      name: "Notes",
      trigger: { kind: "pitch", pitch: SAMPLER_LANE_PITCH },
    },
  ];
}

/** The clip's note events, or an empty list for non-note content. */
export function noteEventsOf(clip: Clip): readonly NoteEvent[] {
  return clip.content.kind === "notes" ? clip.content.events : [];
}

/**
 * The note occupying a given lane and step, if any. A step is "occupied" when a
 * note starts exactly on that step's tick and its trigger matches the lane.
 */
export function noteAt(clip: Clip, lane: StepLane, step: number): NoteEvent | undefined {
  const startTicks = stepStartTicks(step);
  return noteEventsOf(clip).find(
    (event) =>
      event.startTicks === startTicks && triggersMatch(event.trigger, lane.trigger),
  );
}

/**
 * The step index the playhead is currently over, or `null` when the playhead
 * sits outside the clip's range or playback is stopped. Wraps within the clip's
 * bars so a looped clip lights the correct step on each pass.
 */
export function playbackStep(
  clip: Clip,
  positionTicks: number,
  isPlaying: boolean,
): number | null {
  if (!isPlaying) return null;
  const total = stepCount(clip);
  if (total <= 0) return null;
  const step = Math.floor(positionTicks / TICKS_PER_SIXTEENTH);
  if (step < 0) return null;
  return step % total;
}

/** The `event_count_bucket` for a completed gesture (PRD OPS-02). */
export function eventCountBucket(count: number): BucketLabel<"event_count"> {
  return bucketOf("event_count", count);
}

/** A stable identity for a (lane, step) cell, for pointer-drag de-duplication. */
export function cellKey(lane: StepLane, step: number): string {
  return `${lane.key}#${step}`;
}

export type { EventId, PadId };
