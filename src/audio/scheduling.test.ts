import { describe, expect, it } from "vitest";
import type { NoteEvent } from "../domain/entities";
import type { AssetId, ClipId, PlacementId, TrackId } from "../domain/ids";
import { TICKS_PER_BAR, TICKS_PER_SIXTEENTH, toTicks } from "../domain/time";
import type {
	AudioClipProjection,
	AudioPlacementProjection,
} from "../projection/audioProjection";
import { computePlacementSchedule, ticksToToneTime } from "./scheduling";

const trackId = "trk_00000000000000000001" as TrackId;
const clipId = "clp_00000000000000000001" as ClipId;
const placementId = "plc_00000000000000000001" as PlacementId;
const assetId = "ast_00000000000000000001" as AssetId;

function note(startTicks: number, durationTicks: number): NoteEvent {
	return {
		id: `evt_${startTicks}` as NoteEvent["id"],
		trigger: { kind: "pitch", pitch: 60 },
		startTicks: toTicks(startTicks),
		durationTicks: toTicks(durationTicks),
		velocity: 0.8,
		probability: null,
	};
}

function notesClip(
	events: NoteEvent[],
	lengthTicks = TICKS_PER_BAR,
): AudioClipProjection {
	return {
		id: clipId,
		trackId,
		lengthTicks: toTicks(lengthTicks),
		content: { kind: "notes", events },
		fingerprint: "fp",
	};
}

function audioLoopClip(
	sourceTempo: number,
	lengthTicks = TICKS_PER_BAR,
): AudioClipProjection {
	return {
		id: clipId,
		trackId,
		lengthTicks: toTicks(lengthTicks),
		content: {
			kind: "audioLoop",
			assetId,
			sourceTempo,
			startOffsetTicks: toTicks(0),
		},
		fingerprint: "fp",
	};
}

function placement(
	overrides: Partial<AudioPlacementProjection> = {},
): AudioPlacementProjection {
	return {
		id: placementId,
		clipId,
		trackId,
		startTicks: toTicks(0),
		durationTicks: toTicks(TICKS_PER_BAR),
		clipOffsetTicks: toTicks(0),
		looped: false,
		fingerprint: "fp",
		...overrides,
	};
}

describe("computePlacementSchedule", () => {
	it("places a note at placement start + event start, in the placement's track", () => {
		const clip = notesClip([note(0, TICKS_PER_SIXTEENTH)]);
		const schedule = computePlacementSchedule(
			placement({ startTicks: toTicks(TICKS_PER_BAR) }),
			clip,
			120,
		);

		expect(schedule.notes).toHaveLength(1);
		expect(schedule.notes[0].trackId).toBe(trackId);
		expect(schedule.notes[0].absoluteTicks).toBe(TICKS_PER_BAR);
		expect(schedule.notes[0].durationTicks).toBe(TICKS_PER_SIXTEENTH);
	});

	it("drops a note that falls before the placement's clip offset", () => {
		const clip = notesClip([note(0, TICKS_PER_SIXTEENTH)]);
		const schedule = computePlacementSchedule(
			placement({ clipOffsetTicks: toTicks(TICKS_PER_SIXTEENTH) }),
			clip,
			120,
		);

		expect(schedule.notes).toHaveLength(0);
	});

	it("trims a note's duration to the placement's remaining bounds", () => {
		const clip = notesClip([
			note(TICKS_PER_BAR - TICKS_PER_SIXTEENTH, TICKS_PER_SIXTEENTH * 4),
		]);
		const schedule = computePlacementSchedule(placement(), clip, 120);

		expect(schedule.notes).toHaveLength(1);
		expect(schedule.notes[0].durationTicks).toBe(TICKS_PER_SIXTEENTH);
	});

	it("does not repeat a non-looped placement even when the clip is shorter", () => {
		const clip = notesClip(
			[note(0, TICKS_PER_SIXTEENTH)],
			TICKS_PER_SIXTEENTH * 4,
		);
		const schedule = computePlacementSchedule(
			placement({ looped: false, durationTicks: toTicks(TICKS_PER_BAR * 4) }),
			clip,
			120,
		);

		expect(schedule.notes).toHaveLength(1);
	});

	it("repeats a looped placement's clip across the full placement duration", () => {
		const clip = notesClip([note(0, TICKS_PER_SIXTEENTH)], TICKS_PER_BAR);
		const schedule = computePlacementSchedule(
			placement({
				looped: true,
				durationTicks: toTicks(TICKS_PER_BAR * 3),
			}),
			clip,
			120,
		);

		expect(schedule.notes.map((n) => n.absoluteTicks)).toEqual([
			0,
			TICKS_PER_BAR,
			TICKS_PER_BAR * 2,
		]);
	});

	it("keeps repeating a looped placement with a non-zero clip offset through the placement's full duration", () => {
		// clip length 768 ticks, note events at clip ticks 0 and 384;
		// placement { startTicks: 0, durationTicks: 1536, clipOffsetTicks: 384, looped: true }
		// should produce absolute ticks 0, 384, 768, 1152 (the tail of the
		// third wrap must not be dropped just because clipOffsetTicks shifted
		// every repeat later).
		const clip = notesClip(
			[note(0, TICKS_PER_SIXTEENTH), note(384, TICKS_PER_SIXTEENTH)],
			768,
		);
		const schedule = computePlacementSchedule(
			placement({
				looped: true,
				durationTicks: toTicks(1536),
				clipOffsetTicks: toTicks(384),
			}),
			clip,
			120,
		);

		expect(schedule.notes.map((n) => n.absoluteTicks)).toEqual([
			0, 384, 768, 1152,
		]);
	});

	it("computes an audio loop's playback rate from tempo / source tempo", () => {
		const clip = audioLoopClip(100);
		const schedule = computePlacementSchedule(placement(), clip, 120);

		expect(schedule.audioLoops).toHaveLength(1);
		expect(schedule.audioLoops[0].playbackRate).toBeCloseTo(1.2);
		expect(schedule.audioLoops[0].assetId).toBe(assetId);
	});

	it("repeats a looped audio loop clip across the placement duration", () => {
		const clip = audioLoopClip(120, TICKS_PER_BAR);
		const schedule = computePlacementSchedule(
			placement({
				looped: true,
				durationTicks: toTicks(TICKS_PER_BAR * 2),
			}),
			clip,
			120,
		);

		expect(schedule.audioLoops.map((l) => l.absoluteTicks)).toEqual([
			0,
			TICKS_PER_BAR,
		]);
	});
});

describe("ticksToToneTime", () => {
	it("formats ticks using Tone's ticks time notation", () => {
		expect(ticksToToneTime(480)).toBe("480i");
		expect(ticksToToneTime(0)).toBe("0i");
	});

	it("rounds and clamps to a non-negative integer", () => {
		expect(ticksToToneTime(3.6)).toBe("4i");
		expect(ticksToToneTime(-5)).toBe("0i");
	});
});
