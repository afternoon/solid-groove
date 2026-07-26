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
	/** Ratio of song tempo to the loop's authored source tempo. */
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
export function audioLoopOffsetSeconds(
	loop: ScheduledAudioLoop,
	tempo: number,
): number {
	return ticksToSeconds(loop.sourceOffsetTicks, tempo) * loop.playbackRate;
}

/**
 * The `player.start()` duration for a scheduled loop, in the decoded buffer's
 * own seconds — the same timeline as the offset above, and for the same reason.
 *
 * `Tone.Player` divides this by the playback rate to get the wall-clock length
 * it sounds for (`Player.js`: `computedDuration = toSeconds(duration) /
 * playbackRate`), so passing song-timeline seconds makes a non-unity rate
 * truncate the loop (rate > 1) or overrun into the next repeat (rate < 1).
 * Scaling by the rate cancels that division and leaves the event sounding for
 * exactly the song-time span the arrangement draws.
 */
export function audioLoopDurationSeconds(
	loop: ScheduledAudioLoop,
	tempo: number,
): number {
	return ticksToSeconds(loop.durationTicks, tempo) * loop.playbackRate;
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
					Math.ceil(
						(placement.durationTicks + placement.clipOffsetTicks) / clipLength,
					),
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
				if (
					startInPlacement < 0 ||
					startInPlacement >= placement.durationTicks
				) {
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
