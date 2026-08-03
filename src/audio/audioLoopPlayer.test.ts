import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installWebAudioGlobals } from "./testAudioContext";

installWebAudioGlobals();

let Tone: typeof import("tone");
let audioLoopPlayer: typeof import("./audioLoopPlayer");

beforeAll(async () => {
	Tone = await import("tone");
	audioLoopPlayer = await import("./audioLoopPlayer");
});

afterEach(() => {
	vi.restoreAllMocks();
});

/** A silent one-second buffer — enough for a player to accept and start. */
function fakeBuffer(): import("tone").ToneAudioBuffer {
	const context = Tone.getContext().rawContext as unknown as {
		createBuffer(channels: number, length: number, rate: number): AudioBuffer;
	};
	return new Tone.ToneAudioBuffer(context.createBuffer(1, 44_100, 44_100));
}

function destination(): import("tone").ToneAudioNode {
	return new Tone.Gain();
}

describe("isLoopStretched", () => {
	it("is false at unity rate and for rates a rounding error away from it", () => {
		expect(audioLoopPlayer.isLoopStretched(1)).toBe(false);
		expect(audioLoopPlayer.isLoopStretched(1.000_01)).toBe(false);
	});

	it("is true for a real tempo mismatch in either direction", () => {
		expect(audioLoopPlayer.isLoopStretched(120 / 90)).toBe(true);
		expect(audioLoopPlayer.isLoopStretched(90 / 120)).toBe(true);
	});

	it("treats a nonsensical rate as unstretched rather than dividing by it", () => {
		expect(audioLoopPlayer.isLoopStretched(0)).toBe(false);
		expect(audioLoopPlayer.isLoopStretched(Number.NaN)).toBe(false);
	});
});

describe("playAudioLoop", () => {
	it("stretches with a GrainPlayer at an untouched pitch when the tempo differs", () => {
		const grainStart = vi
			.spyOn(Tone.GrainPlayer.prototype, "start")
			.mockImplementation(function mocked(this: unknown) {
				return this as never;
			});
		const playerStart = vi
			.spyOn(Tone.Player.prototype, "start")
			.mockImplementation(function mocked(this: unknown) {
				return this as never;
			});

		audioLoopPlayer.playAudioLoop(fakeBuffer(), {
			destination: destination(),
			time: 0,
			durationSeconds: 2,
			playbackRate: 120 / 90,
			offsetSeconds: 0.25,
		});

		expect(playerStart).not.toHaveBeenCalled();
		expect(grainStart).toHaveBeenCalledTimes(1);

		const player = grainStart.mock.instances[0] as import("tone").GrainPlayer;
		// Time is scaled; pitch is not. `detune` is the knob that would transpose
		// the grains, and it stays at zero — that is the whole point.
		expect(player.playbackRate).toBeCloseTo(120 / 90);
		expect(player.detune).toBe(0);
		expect(player.grainSize).toBeCloseTo(
			audioLoopPlayer.LOOP_GRAIN_SIZE_SECONDS,
		);
		expect(player.overlap).toBeCloseTo(
			audioLoopPlayer.LOOP_GRAIN_OVERLAP_SECONDS,
		);

		// Offset is a position in the buffer; duration is the song-time span
		// GrainPlayer stops after. Neither is scaled by the other's timeline.
		expect(grainStart.mock.calls[0][1]).toBeCloseTo(0.25);
		expect(grainStart.mock.calls[0][2]).toBeCloseTo(2);
	});

	it("plays an unstretched loop through a plain Player, with no resynthesis", () => {
		const grainStart = vi
			.spyOn(Tone.GrainPlayer.prototype, "start")
			.mockImplementation(function mocked(this: unknown) {
				return this as never;
			});
		const playerStart = vi
			.spyOn(Tone.Player.prototype, "start")
			.mockImplementation(function mocked(this: unknown) {
				return this as never;
			});

		audioLoopPlayer.playAudioLoop(fakeBuffer(), {
			destination: destination(),
			time: 0,
			durationSeconds: 2,
			playbackRate: 1,
			offsetSeconds: 0,
		});

		expect(grainStart).not.toHaveBeenCalled();
		expect(playerStart).toHaveBeenCalledTimes(1);
		// At unity rate the two timelines coincide, so `Player`'s divide-by-rate
		// leaves the song-time duration alone.
		expect(playerStart.mock.calls[0][2]).toBeCloseTo(2);
	});

	it("plays nothing for a zero-length event", () => {
		const grainStart = vi
			.spyOn(Tone.GrainPlayer.prototype, "start")
			.mockImplementation(function mocked(this: unknown) {
				return this as never;
			});
		const playerStart = vi
			.spyOn(Tone.Player.prototype, "start")
			.mockImplementation(function mocked(this: unknown) {
				return this as never;
			});

		audioLoopPlayer.playAudioLoop(fakeBuffer(), {
			destination: destination(),
			time: 0,
			durationSeconds: 0,
			playbackRate: 2,
			offsetSeconds: 0,
		});

		expect(grainStart).not.toHaveBeenCalled();
		expect(playerStart).not.toHaveBeenCalled();
	});
});
