import type { NoteTrigger } from "../domain/entities";
import type { AssetId, TrackId } from "../domain/ids";
import type { Ticks } from "../domain/time";
import { toTicks } from "../domain/time";
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
			if (startInPlacement < 0 || startInPlacement >= placement.durationTicks) {
				continue;
			}
			const remaining = placement.durationTicks - startInPlacement;
			audioLoops.push({
				trackId: placement.trackId,
				absoluteTicks: toTicks(placement.startTicks + startInPlacement),
				durationTicks: toTicks(Math.min(clipLength, remaining)),
				assetId: clip.content.assetId,
				playbackRate: tempo / clip.content.sourceTempo,
			});
		}
	}

	return { notes, audioLoops };
}

/** Tone.js Time notation for an absolute tick position ("<n>i" = n ticks). */
export function ticksToToneTime(ticks: number): string {
	return `${Math.max(0, Math.round(ticks))}i`;
}
