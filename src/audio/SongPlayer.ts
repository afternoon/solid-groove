import {
	type Accessor,
	createEffect,
	createRoot,
	createSignal,
} from "solid-js";
import * as Tone from "tone";
import { analytics } from "../analytics/analytics";
import type { ProjectStore } from "../model/project";
import type { Sequence, Track } from "../model/types";
import { codeFor, reportError } from "../monitoring/errorReporting";
import type { AudioHost, AudioProjectScope } from "./AudioRuntime";
import type { ResourceHandle } from "./resourceRegistry";
import { createToneInstrument, type ToneInstrument } from "./ToneInstrument";

/**
 * Convert a 0–1 fader position into a linear gain multiplier.
 *
 * A fader mapped straight to gain feels wrong: loudness is perceived roughly
 * logarithmically, so the whole bottom half of a linear fader sounds like
 * "almost silent" and all the useful travel bunches up at the top. Squaring the
 * position approximates a perceptual taper, giving even-feeling steps across the
 * range. Position 1.0 is unity gain, so the default (1.0) is unchanged.
 */
export function trackGain(volume: number): number {
	const clamped = Math.min(Math.max(volume, 0), 1);
	return clamped * clamped;
}

/**
 * Read every track field the audio graph is derived from, so the enclosing
 * effect subscribes to all of them.
 *
 * Solid tracks the properties an effect actually reads. The audio setup that
 * consumes these values sits behind a conditional, so without this the effect's
 * subscription set depends on when it first ran. Reading them here — cheaply and
 * unconditionally — makes the dependency set complete and stable.
 */
function trackAudioParams(tracks: Track[]): void {
	for (const track of tracks) {
		void track.volume;
		void track.isMuted;
		void track.isSolo;

		const instrument = track.instrument;
		void instrument.type;

		if (instrument.type === "synth" || instrument.type === "sampler") {
			const { attack, decay, sustain, release } = instrument.envelope;
			void attack;
			void decay;
			void sustain;
			void release;

			const { type, cutoff, resonance } = instrument.filter;
			void type;
			void cutoff;
			void resonance;
		}

		if (instrument.type === "synth") {
			void instrument.oscillatorType;
		}

		if (instrument.type === "sampler" || instrument.type === "clip") {
			void instrument.sampleUrl;
		}

		if (instrument.type === "clip") {
			void instrument.sampleTempo;
		}
	}
}

/**
 * Owns one project's Tone objects — instruments and the step sequence — and
 * plays them against the shared `AudioRuntime`.
 *
 * Every Tone object it creates is registered with an `AudioProjectScope` so
 * `dispose()` tears the whole graph down deterministically without touching
 * the runtime's shared real-time context (PRD AUD-07/AUD-09; section 9.7).
 * `SongPlayer` never creates, installs, resumes, suspends, or closes a
 * context itself — only the `AudioRuntime` it was given does that.
 */
export default class SongPlayer {
	private store: ProjectStore | null = null;
	private toneInstruments: ToneInstrument[] = [];
	private instrumentHandles: (ResourceHandle | undefined)[] = [];
	private sequence: Tone.Sequence | null = null;
	private sequenceHandle: ResourceHandle | null = null;
	private hasStarted = false; // Track if the runtime's context has been resumed
	private disposed = false;
	private disposeSubscription: (() => void) | null = null;
	private readonly scope: AudioProjectScope;
	private setPlaying: (value: boolean) => void;

	/** Reactive playback state, for transport UI to follow. */
	readonly isPlaying: Accessor<boolean>;

	/**
	 * @param runtime The application's single `AudioRuntime` (or a test
	 * double implementing `AudioHost`). Never construct a Tone/Web Audio
	 * context here — ask `runtime` for one.
	 * @param ownerId Stable id this project graph's resources are registered
	 * under, so `dispose()` releases exactly this graph's Tone objects.
	 */
	constructor(
		private readonly runtime: AudioHost,
		ownerId: string,
	) {
		const [isPlaying, setPlaying] = createSignal(false);
		this.isPlaying = isPlaying;
		this.setPlaying = setPlaying;
		this.scope = runtime.openProjectScope(ownerId);
	}

	setProjectStore(store: ProjectStore) {
		this.store = store;

		// A dedicated root, rather than relying on an ambient Solid owner, so
		// `dispose()` can tear this effect down deterministically instead of
		// depending on whatever component happened to be rendering when
		// `setProjectStore` was called.
		this.disposeSubscription = createRoot((disposeRoot) => {
			const subscriptionHandle = this.scope.register("subscription", () => {});

			createEffect(() => {
				const project = store.data;
				if (!project) return;

				if (project.latestSnapshot?.song?.tempo) {
					Tone.getTransport().bpm.value = project.latestSnapshot.song.tempo;
				}

				const tracks = project.latestSnapshot?.song?.tracks;
				if (!tracks) return;

				/*
				 * Read every field this effect depends on *before* any early return, so
				 * Solid's fine-grained tracking subscribes to all of them. Previously
				 * the track fields were only read behind `if (this.hasStarted)`, so on
				 * the first run — when playback had not started — the effect subscribed
				 * to nothing but the tempo, and later edits to volume, filter, or
				 * envelope never re-ran it. Touching the values unconditionally keeps
				 * the subscription set stable across runs.
				 */
				trackAudioParams(tracks);

				// Instruments only exist after the first user interaction resumes the
				// runtime's context; until then there is nothing to apply the values to.
				if (this.hasStarted) {
					this.setupToneInstruments(tracks);
				}
			});

			return () => {
				void this.scope.release(subscriptionHandle);
				disposeRoot();
			};
		});
	}

	private setupToneInstruments(tracks: Track[]) {
		const destination = this.runtime.getDestination();

		while (this.toneInstruments.length < tracks.length) {
			const trackIndex = this.toneInstruments.length;
			const track = tracks[trackIndex];
			const instrument = createToneInstrument(track.instrument, destination);
			this.toneInstruments.push(instrument);
			this.instrumentHandles.push(
				this.scope.register("node", () => instrument.dispose()),
			);
		}

		while (this.toneInstruments.length > tracks.length) {
			const instrument = this.toneInstruments.pop();
			const handle = this.instrumentHandles.pop();
			if (handle) void this.scope.release(handle);
			else instrument?.dispose();
		}

		tracks.forEach((track, index) => {
			const currentInstrument = this.toneInstruments[index];
			const oldType = currentInstrument.getType();
			const newType = track.instrument.type;

			if (oldType !== newType) {
				const oldHandle = this.instrumentHandles[index];
				if (oldHandle) void this.scope.release(oldHandle);
				else currentInstrument.dispose();

				const replacement = createToneInstrument(track.instrument, destination);
				this.toneInstruments[index] = replacement;
				this.instrumentHandles[index] = this.scope.register("node", () =>
					replacement.dispose(),
				);
			} else {
				currentInstrument.updateParams(track.instrument);
			}

			// Mute wins over the fader, and a soloed track anywhere silences every
			// track that is not itself soloed.
			const anySolo = tracks.some((t) => t.isSolo);
			const audible = !track.isMuted && (!anySolo || track.isSolo);
			this.toneInstruments[index].setVolume(
				audible ? trackGain(track.volume) : 0,
			);
		});
	}

	private disposeSequence() {
		if (!this.sequence) return;
		if (this.sequenceHandle) void this.scope.release(this.sequenceHandle);
		else this.sequence.dispose();
		this.sequence = null;
		this.sequenceHandle = null;
	}

	/** Start playback if stopped, stop it if playing. */
	async toggle() {
		if (this.isPlaying()) {
			this.stop();
		} else {
			await this.play();
		}
	}

	async play() {
		this.setPlaying(true);

		this.disposeSequence();

		try {
			// Resuming the context is the runtime's job — this is the allowed
			// user gesture that permits it.
			await this.runtime.resume();

			// After first user interaction, set up instruments if needed
			if (!this.hasStarted) {
				this.hasStarted = true;
				const tracks = this.store?.data?.latestSnapshot?.song?.tracks;
				if (tracks) {
					this.setupToneInstruments(tracks);
				}
			}

			await Tone.loaded();
		} catch (error) {
			// PRD `OPS-02`/`OPS-03`: successful audio start is a release gate, so
			// this failure gets its own reliability event with an actionable code
			// rather than only a generic exception. Non-fatal — playback did not
			// start, but nothing was lost and the user can try again.
			const code = codeFor(error);
			analytics.log("audio_start_failed", {
				error_code: code,
				was_browser_blocked: code === "autoplay_blocked",
			});
			reportError(error, { area: "audio", fatal: false, code });
			this.setPlaying(false);
			return;
		}

		// The user may have stopped playback while buffers were loading.
		if (!this.isPlaying()) return;

		const currentPattern = 0;

		this.sequence = new Tone.Sequence(
			(time, index) => {
				const patterns = this.store?.data?.latestSnapshot?.song?.patterns;
				if (patterns?.at(currentPattern)) {
					const sequences: Sequence[] = patterns[currentPattern].sequences;

					// Play each sequence with its corresponding instrument
					sequences.forEach((sequence, trackIndex) => {
						const note = sequence.steps[index];
						if (note === null) return;

						const instrument = this.toneInstruments[trackIndex];
						if (instrument) {
							instrument.trigger(note, "16n", time);
						}
					});
				}
			},
			[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
			"16n",
		).start(0);
		this.sequenceHandle = this.scope.register("schedule", () => {
			this.sequence?.dispose();
		});

		Tone.getTransport().start();
	}

	stop() {
		this.setPlaying(false);
		Tone.getTransport().stop();
	}

	/**
	 * Tear down every Tone object this project graph owns. Safe to call more
	 * than once, and safe even if playback never started or `play()` failed
	 * partway through — resources are registered as soon as they're created,
	 * so whatever exists at the time of the failure is exactly what gets
	 * cleaned up. Never touches the shared runtime/context.
	 */
	dispose() {
		if (this.disposed) return;
		this.disposed = true;

		this.disposeSequence();

		for (const handle of this.instrumentHandles) {
			if (handle) void this.scope.release(handle);
		}
		this.toneInstruments = [];
		this.instrumentHandles = [];

		this.disposeSubscription?.();
		this.disposeSubscription = null;

		// Safety net: release anything the steps above missed (e.g. a resource
		// registered mid-failure that never made it into a tracked array).
		void this.scope.dispose();
	}
}
