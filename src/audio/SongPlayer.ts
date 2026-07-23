import { createEffect } from "solid-js";
import * as Tone from "tone";
import type { ProjectStore } from "../model/project";
import type { Sequence, Track } from "../model/types";
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

export default class SongPlayer {
	private store: ProjectStore | null = null;
	private toneInstruments: ToneInstrument[] = [];
	private sequence: Tone.Sequence | null = null;
	private hasStarted = false; // Track if AudioContext has been started

	constructor() {
		console.log("We are the music makers, and we are the dreamers of dreams.");
	}

	setProjectStore(store: ProjectStore) {
		this.store = store;

		createEffect(() => {
			const project = store.data;
			if (!project) return;

			if (project.latestSnapshot?.song?.tempo) {
				console.log("AudioEngine tempo", project.latestSnapshot.song.tempo);
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

			// Instruments only exist after the first user interaction unlocks the
			// AudioContext; until then there is nothing to apply the values to.
			if (this.hasStarted) {
				this.setupToneInstruments(tracks);
			}
		});
	}

	private setupToneInstruments(tracks: Track[]) {
		while (this.toneInstruments.length < tracks.length) {
			const trackIndex = this.toneInstruments.length;
			const track = tracks[trackIndex];
			const instrument = createToneInstrument(
				track.instrument,
				Tone.getDestination(),
			);
			this.toneInstruments.push(instrument);
			console.log(
				`Created ${track.instrument.type} for track ${trackIndex}: ${track.name}`,
			);
		}

		while (this.toneInstruments.length > tracks.length) {
			const instrument = this.toneInstruments.pop();
			instrument?.dispose();
		}

		tracks.forEach((track, index) => {
			const currentInstrument = this.toneInstruments[index];
			const oldType = currentInstrument.getType();
			const newType = track.instrument.type;

			if (oldType !== newType) {
				console.log(
					`Track ${index} instrument type changed: ${oldType} -> ${newType}`,
				);
				currentInstrument.dispose();
				this.toneInstruments[index] = createToneInstrument(
					track.instrument,
					Tone.getDestination(),
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

	async play() {
		console.log("AudioEngine.play");

		if (this.sequence) {
			this.sequence.dispose();
			this.sequence = null;
		}

		if (Tone.getContext().state !== "running") {
			await Tone.start();
		}

		// After first user interaction, set up instruments if needed
		if (!this.hasStarted) {
			this.hasStarted = true;
			const tracks = this.store?.data?.latestSnapshot?.song?.tracks;
			if (tracks) {
				this.setupToneInstruments(tracks);
			}
		}

		await Tone.loaded();
		console.log("All audio buffers loaded");

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

		Tone.getTransport().start();
	}

	stop() {
		console.log("AudioEngine.stop");
		Tone.getTransport().stop();
	}

	dispose() {
		if (this.sequence) {
			this.sequence.dispose();
		}
		this.toneInstruments.forEach((inst) => {
			inst.dispose();
		});
		this.toneInstruments = [];
	}
}
