import { describe, expect, it } from "vitest";
import type { NoteEvent } from "../domain/entities";
import type { AssetId, ClipId, PlacementId, TrackId } from "../domain/ids";
import { TICKS_PER_BAR, TICKS_PER_SIXTEENTH, toTicks } from "../domain/time";
import type {
	AudioClipProjection,
	AudioPlacementProjection,
} from "../projection/audioProjection";
import {
	audioLoopDurationSeconds,
	audioLoopOffsetSeconds,
	computePlacementSchedule,
	ticksToToneTime,
} from "./scheduling";

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
	startOffsetTicks = 0,
): AudioClipProjection {
	return {
		id: clipId,
		trackId,
		lengthTicks: toTicks(lengthTicks),
		content: {
			kind: "audioLoop",
			assetId,
			sourceTempo,
			startOffsetTicks: toTicks(startOffsetTicks),
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

	it("plays a left-trimmed audio loop from inside the sample rather than dropping it", () => {
		// The user drags the placement's left edge one beat right: clip length
		// 768 ticks, placement { start 0, duration 768, clipOffset 192 }. The
		// renderer draws a trimmed placement, so the engine must play the same
		// 576 ticks — starting 192 ticks into the sample — not fall silent.
		const clip = audioLoopClip(120, 768);
		const schedule = computePlacementSchedule(
			placement({
				startTicks: toTicks(0),
				durationTicks: toTicks(768),
				clipOffsetTicks: toTicks(192),
				looped: false,
			}),
			clip,
			120,
		);

		expect(schedule.audioLoops).toHaveLength(1);
		expect(schedule.audioLoops[0].absoluteTicks).toBe(0);
		expect(schedule.audioLoops[0].sourceOffsetTicks).toBe(192);
		expect(schedule.audioLoops[0].durationTicks).toBe(576);
	});

	it("starts a left-trimmed looped audio placement at the placement start", () => {
		// Same trim, but looped across two clip lengths: the first repeat must
		// still sound at the placement start, and every later repeat lands on
		// the placement's own grid.
		const clip = audioLoopClip(120, 768);
		const schedule = computePlacementSchedule(
			placement({
				startTicks: toTicks(0),
				durationTicks: toTicks(1536),
				clipOffsetTicks: toTicks(192),
				looped: true,
			}),
			clip,
			120,
		);

		expect(schedule.audioLoops.map((l) => l.absoluteTicks)).toEqual([
			0, 576, 1344,
		]);
		expect(schedule.audioLoops.map((l) => l.sourceOffsetTicks)).toEqual([
			192, 0, 0,
		]);
		expect(schedule.audioLoops.map((l) => l.durationTicks)).toEqual([
			576, 768, 192,
		]);
	});

	it("honours a clip's authored startOffsetTicks as the sample's start position", () => {
		const clip = audioLoopClip(120, TICKS_PER_BAR, 192);
		const schedule = computePlacementSchedule(placement(), clip, 120);

		expect(schedule.audioLoops).toHaveLength(1);
		expect(schedule.audioLoops[0].absoluteTicks).toBe(0);
		expect(schedule.audioLoops[0].sourceOffsetTicks).toBe(192);
	});

	it("adds a placement's left trim to the clip's authored start offset", () => {
		const clip = audioLoopClip(120, 768, 96);
		const schedule = computePlacementSchedule(
			placement({
				durationTicks: toTicks(768),
				clipOffsetTicks: toTicks(192),
			}),
			clip,
			120,
		);

		expect(schedule.audioLoops).toHaveLength(1);
		expect(schedule.audioLoops[0].sourceOffsetTicks).toBe(288);
	});

	it("drops an audio loop repeat that ends before the placement's clip offset", () => {
		// clipOffsetTicks past a whole clip length: the first repeat is entirely
		// trimmed away, and the repeats that do overlap start mid-sample.
		const clip = audioLoopClip(120, 384);
		const schedule = computePlacementSchedule(
			placement({
				looped: true,
				durationTicks: toTicks(384),
				clipOffsetTicks: toTicks(576),
			}),
			clip,
			120,
		);

		expect(schedule.audioLoops.map((l) => l.absoluteTicks)).toEqual([0, 192]);
		expect(schedule.audioLoops.map((l) => l.sourceOffsetTicks)).toEqual([
			192, 0,
		]);
		expect(schedule.audioLoops.map((l) => l.durationTicks)).toEqual([192, 192]);
	});

	it("drops a non-looped audio placement trimmed past the end of its clip", () => {
		const clip = audioLoopClip(120, 384);
		const schedule = computePlacementSchedule(
			placement({
				looped: false,
				durationTicks: toTicks(384),
				clipOffsetTicks: toTicks(576),
			}),
			clip,
			120,
		);

		expect(schedule.audioLoops).toHaveLength(0);
	});
});

describe("audioLoopOffsetSeconds", () => {
	it("converts the source offset at the sample's authored tempo, not the song tempo", () => {
		// A one-bar sample authored at 60 BPM is 4s long and plays at rate 2 in
		// a 120 BPM song. One beat into that sample is 1s of buffer, not the
		// 0.5s a song-tempo conversion would give.
		const clip = audioLoopClip(60, TICKS_PER_BAR, 192);
		const schedule = computePlacementSchedule(placement(), clip, 120);

		expect(schedule.audioLoops).toHaveLength(1);
		expect(audioLoopOffsetSeconds(schedule.audioLoops[0], 120)).toBeCloseTo(1);
	});

	it("is zero for an untrimmed loop", () => {
		const clip = audioLoopClip(120);
		const schedule = computePlacementSchedule(placement(), clip, 120);

		expect(audioLoopOffsetSeconds(schedule.audioLoops[0], 120)).toBe(0);
	});
});

describe("audioLoopDurationSeconds", () => {
	// A loop is time-stretched, not resampled, so the event always sounds for
	// exactly the song-time span the arrangement draws — the same 2s for a
	// one-bar placement at 120 BPM whatever tempo the sample was authored at.
	// (`Tone.GrainPlayer` stops at `time + duration`, so no rate compensation
	// belongs here; that is what pulls this apart from the buffer-timeline
	// offset above.)
	it("is the song-time duration for a sample authored faster than the song", () => {
		// Authored at 60 BPM, played at 120 => stretched 2x, still 2s of song.
		const clip = audioLoopClip(60, TICKS_PER_BAR);
		const schedule = computePlacementSchedule(placement(), clip, 120);

		const [loop] = schedule.audioLoops;
		expect(loop.playbackRate).toBeCloseTo(2);
		expect(audioLoopDurationSeconds(loop, 120)).toBeCloseTo(2);
	});

	it("is the song-time duration for a sample authored slower than the song", () => {
		// Authored at 140 BPM, played at 120 => stretched ~0.857x, still 2s.
		const clip = audioLoopClip(140, TICKS_PER_BAR);
		const schedule = computePlacementSchedule(placement(), clip, 120);

		const [loop] = schedule.audioLoops;
		expect(loop.playbackRate).toBeCloseTo(120 / 140);
		expect(audioLoopDurationSeconds(loop, 120)).toBeCloseTo(2);
	});

	it("is the plain song-time duration at unity rate", () => {
		const clip = audioLoopClip(120);
		const schedule = computePlacementSchedule(placement(), clip, 120);

		expect(audioLoopDurationSeconds(schedule.audioLoops[0], 120)).toBeCloseTo(
			2,
		);
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
