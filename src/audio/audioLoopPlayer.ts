import * as Tone from "tone";

/**
 * How a tempo-labelled audio loop is made to follow the project tempo
 * (PRD INS-02).
 *
 * A loop declares the tempo it was authored at, so a song at a different tempo
 * has to change how long the loop takes to play. There are two ways to do it:
 *
 * - **Resampling** — play the buffer faster or slower, exactly like a tape.
 *   Cheap and artifact-free, but the pitch moves with the tempo, which is
 *   wrong for a loop carrying tuned material.
 * - **Time-stretching** — change the duration while holding the pitch.
 *
 * Solid Groove time-stretches. `Tone.GrainPlayer` advances its read position
 * through the buffer at `playbackRate` while each grain is played back at the
 * buffer's native rate, so a loop authored at 90 BPM played in a 120 BPM song
 * takes 3/4 of the time and keeps every pitch it was recorded with.
 *
 * The honest cost, which `LoopInfo` states in the UI, is that granular
 * stretching smears transients and adds a faint periodic texture, and both grow
 * with the stretch ratio. So an *unstretched* loop never pays it: at a playback
 * rate of 1 this module falls back to a plain `Tone.Player`, which is a
 * sample-accurate copy of the recording with no resynthesis at all.
 */

/**
 * The grain length, in seconds. Shorter grains follow transients more closely
 * but make the periodic granular texture more audible; 100 ms is the usual
 * compromise for rhythmic loop material, and half of `Tone.GrainPlayer`'s own
 * 200 ms default, which smears a drum hit badly.
 */
export const LOOP_GRAIN_SIZE_SECONDS = 0.1;

/** The crossfade between successive grains — half a grain, so they overlap smoothly. */
export const LOOP_GRAIN_OVERLAP_SECONDS = 0.05;

/**
 * Rates this close to 1 count as "not stretched". A tempo is a float and a
 * project can carry a source tempo that is fractionally off the song's, so an
 * exact `=== 1` would send an inaudible 0.0001 ratio down the granular path
 * for no reason.
 */
const UNSTRETCHED_RATE_EPSILON = 1e-4;

/** Whether a loop at this playback rate needs stretching at all. */
export function isLoopStretched(playbackRate: number): boolean {
	if (!Number.isFinite(playbackRate) || playbackRate <= 0) return false;
	return Math.abs(playbackRate - 1) > UNSTRETCHED_RATE_EPSILON;
}

export interface AudioLoopPlayback {
	/** Where the destination track's audio input is. */
	readonly destination: Tone.ToneAudioNode;
	/** Transport time the loop event starts at. */
	readonly time: Tone.Unit.Time;
	/**
	 * How long the event sounds for, in *song-timeline* seconds — the span the
	 * arrangement draws, not a length in the buffer's own timeline.
	 */
	readonly durationSeconds: number;
	/** Song tempo over the loop's authored source tempo. */
	readonly playbackRate: number;
	/** Where inside the buffer's own timeline the event starts, in seconds. */
	readonly offsetSeconds: number;
}

/**
 * Plays one scheduled audio-loop event, following the song tempo without
 * moving the loop's pitch. Like `playOneShot`, the node is the short-lived
 * source AUD-08 permits per event: it disposes itself once it has stopped, so
 * nothing accumulates across repeats.
 */
export function playAudioLoop(
	buffer: Tone.ToneAudioBuffer,
	playback: AudioLoopPlayback,
): void {
	const { destination, time, durationSeconds, playbackRate, offsetSeconds } =
		playback;
	if (durationSeconds <= 0) return;

	if (!isLoopStretched(playbackRate)) {
		// Source tempo already matches the song: play the recording as recorded.
		const player = new Tone.Player(buffer).connect(destination);
		player.onstop = () => player.dispose();
		player.start(time, offsetSeconds, durationSeconds);
		return;
	}

	const player = new Tone.GrainPlayer(buffer).connect(destination);
	player.grainSize = LOOP_GRAIN_SIZE_SECONDS;
	player.overlap = LOOP_GRAIN_OVERLAP_SECONDS;
	player.playbackRate = playbackRate;
	// Time is stretched; pitch is not touched. `detune` is the other half of
	// GrainPlayer — it would transpose the grains — and stays at zero precisely
	// because the point of this path is that the pitch does not move.
	player.detune = 0;
	// `GrainPlayer.start`'s duration is wall-clock (it schedules a `stop` at
	// `time + duration`), unlike `Player.start`, which divides by the playback
	// rate. So the song-timeline span goes in as-is; the offset is a buffer
	// position, so it does not.
	player.start(time, offsetSeconds, durationSeconds);
	player.onstop = () => {
		// The last grains are scheduled up to one grain plus its crossfade past
		// the stop, so let them ring out instead of cutting the tail.
		const tailMs =
			(LOOP_GRAIN_SIZE_SECONDS + LOOP_GRAIN_OVERLAP_SECONDS) * 1000 + 50;
		setTimeout(() => player.dispose(), tailMs);
	};
}
