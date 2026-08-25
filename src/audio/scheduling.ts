import type { NoteTrigger } from "../domain/entities";
import type { AssetId, TrackId } from "../domain/ids";
import type { Ticks } from "../domain/time";
import { ticksToSeconds, toTicks } from "../domain/time";
import type {
  AudioClipProjection,
  AudioPlacementProjection,
} from "../projection/audioProjection";

/**
 * Pure musical-time scheduling math (PRD AUD-08/AUD-03, section 9.7:
 * "Scheduling uses musical-time projections ... rather than anonymous global
 * callbacks"). This module never touches Tone or the transport — it only
 * expands one placement's clip content into the absolute-tick events
 * `ProjectAudioGraph` schedules, so the expansion itself (looping, trimming a
 * clip to its placement bounds) is testable without any audio context at all.
 */

export interface ScheduledNote {
  readonly trackId: TrackId;
  readonly absoluteTicks: Ticks;
  readonly durationTicks: Ticks;
  readonly trigger: NoteTrigger;
  readonly velocity: number;
}

export interface ScheduledAudioLoop {
  readonly trackId: TrackId;
  readonly absoluteTicks: Ticks;
  readonly durationTicks: Ticks;
  readonly assetId: AssetId;
  /**
   * Ratio of song tempo to the loop's authored source tempo — how much the
   * loop has to be stretched to fit the song. `playAudioLoop` applies it as a
   * pitch-preserving time-stretch, not as a resampling speed change.
   */
  readonly playbackRate: number;
  /**
   * Where inside the clip's own timeline this event starts, in ticks: the
   * clip's authored `startOffsetTicks` plus however much of this repeat the
   * placement's left-edge trim (`clipOffsetTicks`) cuts away. The consumer
   * converts it to buffer seconds — see `audioLoopOffsetSeconds`.
   */
  readonly sourceOffsetTicks: Ticks;
}

/**
 * The `player.start()` offset for a scheduled loop, in the decoded buffer's
 * own seconds. The sample was authored at the clip's source tempo, so a
 * clip-tick offset is song-tempo seconds scaled by the playback rate
 * (`ticksToSeconds(t, tempo) * tempo / sourceTempo === ticksToSeconds(t, sourceTempo)`).
 */
export function audioLoopOffsetSeconds(loop: ScheduledAudioLoop, tempo: number): number {
  return ticksToSeconds(loop.sourceOffsetTicks, tempo) * loop.playbackRate;
}

/**
 * How long a scheduled loop event sounds for, in *song-timeline* seconds —
 * exactly the span the arrangement draws, unlike the offset above, which is a
 * position in the buffer's own timeline.
 *
 * The two timelines differ whenever the loop is stretched, so this is the one
 * place the distinction is written down. `playAudioLoop` stretches with
 * `Tone.GrainPlayer`, whose `start()` duration is wall-clock (it schedules a
 * `stop` at `time + duration`), so the song-timeline value is what it wants.
 * At an unstretched rate of 1 the two timelines coincide and the fallback
 * `Tone.Player`'s divide-by-rate is a no-op, so the same value is correct
 * there too.
 */
export function audioLoopDurationSeconds(
  loop: ScheduledAudioLoop,
  tempo: number,
): number {
  return ticksToSeconds(loop.durationTicks, tempo);
}

export interface PlacementSchedule {
  readonly notes: readonly ScheduledNote[];
  readonly audioLoops: readonly ScheduledAudioLoop[];
}

/**
 * Expands one placement's clip content into absolute-tick events, trimmed to
 * the placement's bounds and repeated across it when `placement.looped`.
 */
export function computePlacementSchedule(
  placement: AudioPlacementProjection,
  clip: AudioClipProjection,
  tempo: number,
): PlacementSchedule {
  const notes: ScheduledNote[] = [];
  const audioLoops: ScheduledAudioLoop[] = [];
  const clipLength = clip.lengthTicks;
  const repeatCount =
    placement.looped && clipLength > 0
      ? Math.max(
          1,
          Math.ceil((placement.durationTicks + placement.clipOffsetTicks) / clipLength),
        )
      : 1;

  for (let repeat = 0; repeat < repeatCount; repeat += 1) {
    const repeatOffset = repeat * clipLength;
    if (repeatOffset - placement.clipOffsetTicks >= placement.durationTicks) {
      break;
    }

    if (clip.content.kind === "notes") {
      for (const event of clip.content.events) {
        const startInPlacement =
          event.startTicks - placement.clipOffsetTicks + repeatOffset;
        if (startInPlacement < 0 || startInPlacement >= placement.durationTicks) {
          continue;
        }
        const remaining = placement.durationTicks - startInPlacement;
        notes.push({
          trackId: placement.trackId,
          absoluteTicks: toTicks(placement.startTicks + startInPlacement),
          durationTicks: toTicks(Math.min(event.durationTicks, remaining)),
          trigger: event.trigger,
          velocity: event.velocity,
        });
      }
    } else {
      const startInPlacement = repeatOffset - placement.clipOffsetTicks;
      if (startInPlacement >= placement.durationTicks) {
        continue;
      }
      // A repeat straddling the placement's left edge is not skipped: it
      // sounds at the placement start, from `trimmed` ticks into the
      // sample, so a left-edge trim plays the material the arrangement
      // renderer draws instead of falling silent.
      const trimmed = Math.max(0, -startInPlacement);
      if (trimmed >= clipLength) {
        continue;
      }
      const startedAt = startInPlacement + trimmed;
      const remaining = placement.durationTicks - startedAt;
      audioLoops.push({
        trackId: placement.trackId,
        absoluteTicks: toTicks(placement.startTicks + startedAt),
        durationTicks: toTicks(Math.min(clipLength - trimmed, remaining)),
        assetId: clip.content.assetId,
        playbackRate: tempo / clip.content.sourceTempo,
        sourceOffsetTicks: toTicks(clip.content.startOffsetTicks + trimmed),
      });
    }
  }

  return { notes, audioLoops };
}

/** Tone.js Time notation for an absolute tick position ("<n>i" = n ticks). */
export function ticksToToneTime(ticks: number): string {
  return `${Math.max(0, Math.round(ticks))}i`;
}
