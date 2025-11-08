import { createEffect } from "solid-js";
import * as Tone from "tone";
import type { ProjectStore } from "../model/project";
import type { Sequence, Track } from "../model/types";
import { createToneInstrument, type ToneInstrument } from "./ToneInstrument";

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

			// Only setup instruments after first user interaction
			if (this.hasStarted && project.latestSnapshot?.song?.tracks) {
				this.setupToneInstruments(project.latestSnapshot.song.tracks);
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
				if (patterns !== undefined && patterns.at(currentPattern)) {
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
		this.toneInstruments.forEach((inst) => inst.dispose());
		this.toneInstruments = [];
	}
}
