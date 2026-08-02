import * as Tone from "tone";
import { PPQ, TICKS_PER_BAR, TICKS_PER_QUARTER } from "../domain/time";
import type { AudioProjectScope } from "./AudioRuntime";
import { ticksToToneTime } from "./scheduling";

/**
 * The transport layer (PRD AUD-01/AUD-02, section 9.7).
 *
 * Dependable play/pause/stop/seek, tempo, a bar-aligned arrangement loop, and
 * a metronome all sit on top of the one shared `Tone.Transport`. The transport
 * is *not* project state — it is a session-scoped playhead over the arrangement
 * `ProjectAudioGraph` schedules, in the same category as selection. Tempo is
 * the exception: it lives in the song (a `parameter.set`/`song.tempo` command
 * writes it), and this layer only mirrors the song's tempo onto the transport
 * so the schedule already keyed to musical ticks plays at the right speed.
 *
 * Everything here is written against the injectable {@link TransportEngine}
 * interface rather than `Tone.getTransport()` directly, so seek alignment,
 * loop bar-snapping, and metronome scheduling are all provable without a real
 * audio context or any wall-clock timing (PRD AUD-03).
 */

/** The transport's coarse playback state, mirroring `Tone.PlaybackState`. */
export type TransportState = "stopped" | "started" | "paused";

/**
 * The minimum the transport depends on from `Tone.Transport`. An interface, so
 * tests can drive play/pause/stop/seek/loop and observe the exact ticks and
 * loop bounds written, and so the metronome's scheduling can be asserted
 * without a Tone context.
 */
export interface TransportEngine {
	bpm: { value: number };
	/** Absolute transport position, in ticks at {@link PPQ}. */
	ticks: number;
	readonly state: TransportState;
	loop: boolean;
	/** Loop start/end as Tone time strings ("<n>i" tick notation). */
	loopStart: string;
	loopEnd: string;
	start(): void;
	pause(): void;
	stop(): void;
	/** Schedule a callback to repeat every `intervalTicks`, starting at `startTicks`. */
	scheduleRepeat(
		callback: (time: number) => void,
		intervalTicks: number,
		startTicks: number,
	): number;
	clear(id: number): void;
}

/**
 * The live engine backed by the one shared `Tone.Transport`. Constructed lazily
 * by {@link TransportController} so importing this module never touches Tone's
 * global transport.
 */
export const liveTransportEngine: TransportEngine = {
	get bpm() {
		return Tone.getTransport().bpm;
	},
	get ticks() {
		return Tone.getTransport().ticks;
	},
	set ticks(value: number) {
		Tone.getTransport().ticks = value;
	},
	get state(): TransportState {
		return Tone.getTransport().state as TransportState;
	},
	get loop() {
		return Tone.getTransport().loop;
	},
	set loop(value: boolean) {
		Tone.getTransport().loop = value;
	},
	get loopStart() {
		return String(Tone.getTransport().loopStart);
	},
	set loopStart(value: string) {
		Tone.getTransport().loopStart = value;
	},
	get loopEnd() {
		return String(Tone.getTransport().loopEnd);
	},
	set loopEnd(value: string) {
		Tone.getTransport().loopEnd = value;
	},
	start() {
		Tone.getTransport().start();
	},
	pause() {
		Tone.getTransport().pause();
	},
	stop() {
		Tone.getTransport().stop();
	},
	scheduleRepeat(callback, intervalTicks, startTicks) {
		return Tone.getTransport().scheduleRepeat(
			callback,
			ticksToToneTime(intervalTicks),
			ticksToToneTime(startTicks),
		);
	},
	clear(id) {
		Tone.getTransport().clear(id);
	},
};

/** A bar-aligned loop range, in absolute ticks. */
export interface LoopRange {
	readonly startTicks: number;
	readonly endTicks: number;
}

/**
 * Snaps an arbitrary loop range to whole bars (PRD AUD-02: "an arrangement
 * loop range aligned to bars"). The start rounds down and the end rounds up to
 * the nearest bar, and an empty or inverted range is widened to at least one
 * bar so the loop always encloses real musical time.
 */
export function barAlignedLoop(
	startTicks: number,
	endTicks: number,
): LoopRange {
	const rawStart = Math.max(0, Math.min(startTicks, endTicks));
	const rawEnd = Math.max(startTicks, endTicks);
	const start = Math.floor(rawStart / TICKS_PER_BAR) * TICKS_PER_BAR;
	let end = Math.ceil(rawEnd / TICKS_PER_BAR) * TICKS_PER_BAR;
	if (end <= start) end = start + TICKS_PER_BAR;
	return { startTicks: start, endTicks: end };
}

/** A loop spanning `barCount` bars from bar `startBar` (both zero-based). */
export function loopOfBars(startBar: number, barCount: number): LoopRange {
	const start = Math.max(0, Math.floor(startBar)) * TICKS_PER_BAR;
	const bars = Math.max(1, Math.floor(barCount));
	return { startTicks: start, endTicks: start + bars * TICKS_PER_BAR };
}

/** The AUD-02 supported tempo range. The domain `song.tempo` parameter allows a
 * wider band for migration headroom; the transport surface clamps to the range
 * the product actually supports. */
export const MIN_TEMPO_BPM = 40;
export const MAX_TEMPO_BPM = 240;

/** Clamps a tempo to the AUD-02 supported 40-240 BPM range. */
export function clampTempo(bpm: number): number {
	if (!Number.isFinite(bpm)) return MIN_TEMPO_BPM;
	return Math.min(MAX_TEMPO_BPM, Math.max(MIN_TEMPO_BPM, bpm));
}

/**
 * The metronome click (PRD AUD-02). One reusable synth voice, scheduled once
 * as a bar-relative repeat on the transport so it stays aligned across seek,
 * tempo change, and loop boundaries exactly like every other scheduled event —
 * it is never dispatched from an animation frame. Toggling it on or off never
 * stops or restarts the transport.
 */
export interface Metronome {
	readonly enabled: boolean;
	setEnabled(enabled: boolean): void;
	dispose(): void;
}

export interface MetronomeOptions {
	/** Injectable for tests; defaults to a real Tone voice on the shared output. */
	readonly createVoice?: () => MetronomeVoice;
}

/** The sound source the metronome triggers. Injectable so scheduling is testable. */
export interface MetronomeVoice {
	/** Trigger one click. `accent` marks the downbeat of a bar. */
	click(time: number, accent: boolean): void;
	dispose(): void;
}

/** A Tone-backed metronome voice: a short pitched blip, accented on the downbeat. */
function createToneMetronomeVoice(
	destination: Tone.ToneAudioNode,
): MetronomeVoice {
	const synth = new Tone.Synth({
		oscillator: { type: "square" },
		envelope: { attack: 0.001, decay: 0.03, sustain: 0, release: 0.01 },
		volume: -8,
	});
	synth.connect(destination);
	return {
		click(time, accent) {
			synth.triggerAttackRelease(accent ? "C6" : "C5", 0.02, time);
		},
		dispose() {
			synth.dispose();
		},
	};
}

/**
 * Wires a metronome onto the transport. The click repeats every quarter note
 * from tick 0; the accent lands on beat 0 of each 4/4 bar. Scheduling once and
 * gating on `enabled` (rather than clearing/rescheduling on every toggle) keeps
 * the click phase locked to the transport regardless of when it was turned on.
 */
export class TransportMetronome implements Metronome {
	private readonly voice: MetronomeVoice;
	private readonly scheduleId: number;
	private readonly handle: ReturnType<AudioProjectScope["register"]>;
	private isEnabled = false;
	private disposed = false;

	constructor(
		private readonly engine: TransportEngine,
		private readonly scope: AudioProjectScope,
		destination: Tone.ToneAudioNode,
		options: MetronomeOptions = {},
	) {
		this.voice = options.createVoice
			? options.createVoice()
			: createToneMetronomeVoice(destination);
		this.scheduleId = this.engine.scheduleRepeat(
			(time) => {
				if (!this.isEnabled) return;
				// The scheduled tick is quarter-note aligned; the accent is the bar
				// downbeat. `engine.ticks` is the transport's position when the event
				// fires, which is exact at a quarter-note grid point.
				const accent = this.engine.ticks % TICKS_PER_BAR < TICKS_PER_QUARTER;
				this.voice.click(time, accent);
			},
			TICKS_PER_QUARTER,
			0,
		);
		this.handle = this.scope.register("schedule", () => {
			this.engine.clear(this.scheduleId);
		});
	}

	get enabled(): boolean {
		return this.isEnabled;
	}

	setEnabled(enabled: boolean): void {
		this.isEnabled = enabled;
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.isEnabled = false;
		void this.scope.release(this.handle);
		this.voice.dispose();
	}
}

export interface TransportControllerOptions {
	readonly engine?: TransportEngine;
	readonly scope?: AudioProjectScope;
	readonly metronome?: Metronome;
}

/**
 * Owns the transport's play/pause/stop/seek, tempo, bar-aligned loop, and
 * metronome for one open project (PRD AUD-01/AUD-02). It never schedules the
 * arrangement itself — {@link ProjectAudioGraph} owns that — so a tempo change
 * or a loop toggle updates the transport in place without rebuilding a single
 * audio node or restarting playback.
 */
export class TransportController {
	private readonly engine: TransportEngine;
	private readonly metronome: Metronome | null;
	private loopRange: LoopRange | null = null;

	constructor(options: TransportControllerOptions = {}) {
		this.engine = options.engine ?? liveTransportEngine;
		this.metronome = options.metronome ?? null;
	}

	get state(): TransportState {
		return this.engine.state;
	}

	get isPlaying(): boolean {
		return this.engine.state === "started";
	}

	/** The current playhead position, in absolute ticks at {@link PPQ}. */
	get positionTicks(): number {
		return Math.max(0, Math.round(this.engine.ticks));
	}

	get loop(): LoopRange | null {
		return this.loopRange;
	}

	get loopEnabled(): boolean {
		return this.engine.loop;
	}

	get metronomeEnabled(): boolean {
		return this.metronome?.enabled ?? false;
	}

	/** Start (or resume) playback from the current position. */
	play(): void {
		this.engine.start();
	}

	/** Pause, leaving the playhead where it is so `play()` resumes from there. */
	pause(): void {
		this.engine.pause();
	}

	/**
	 * Stop and return the playhead to the loop start when looping, or to the
	 * arrangement start otherwise (PRD AUD-01: "returns to the expected position
	 * on stop").
	 */
	stop(): void {
		this.engine.stop();
		this.engine.ticks = this.engine.loop
			? (this.loopRange?.startTicks ?? 0)
			: 0;
	}

	/** Move the playhead without changing whether the transport is running. A
	 * tempo change is a mirror, not a seek — see {@link setTempo}. */
	seekTicks(ticks: number): void {
		this.engine.ticks = Math.max(0, Math.round(ticks));
	}

	/**
	 * Mirror the song's tempo onto the transport. Because the arrangement
	 * schedule is keyed to musical ticks, changing the BPM re-times every event
	 * without moving the playhead or restarting the song (PRD AUD-02: "Tempo
	 * changes during playback do not restart the song").
	 */
	setTempo(bpm: number): void {
		this.engine.bpm.value = clampTempo(bpm);
	}

	/** Set (and bar-align) the loop range, applying it if looping is on. */
	setLoop(startTicks: number, endTicks: number): LoopRange {
		const range = barAlignedLoop(startTicks, endTicks);
		this.loopRange = range;
		this.engine.loopStart = ticksToToneTime(range.startTicks);
		this.engine.loopEnd = ticksToToneTime(range.endTicks);
		return range;
	}

	/** Enable or disable looping without touching the transport's run state. */
	setLoopEnabled(enabled: boolean): void {
		if (enabled && this.loopRange) {
			this.engine.loopStart = ticksToToneTime(this.loopRange.startTicks);
			this.engine.loopEnd = ticksToToneTime(this.loopRange.endTicks);
		}
		this.engine.loop = enabled;
	}

	toggleLoop(): void {
		this.setLoopEnabled(!this.engine.loop);
	}

	/** Turn the metronome click on or off without stopping playback. */
	setMetronomeEnabled(enabled: boolean): void {
		this.metronome?.setEnabled(enabled);
	}

	toggleMetronome(): void {
		this.setMetronomeEnabled(!this.metronomeEnabled);
	}
}
