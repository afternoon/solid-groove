import { createEffect } from "solid-js";
import * as Tone from "tone";
import type { ProjectStore } from "../model/project";
import type { Sequence } from "../model/types";

export default class SongPlayer {
	private store: ProjectStore | null = null;

	constructor() {
		console.log("We are the music makers, and we are the dreamers of dreams.");
	}

	setProjectStore(store: ProjectStore) {
		this.store = store;

		// React to changes in the project data
		createEffect(() => {
			const project = store.data;
			if (project?.latestSnapshot?.song?.tempo) {
				console.log("AudioEngine tempo", project.latestSnapshot.song.tempo);
				Tone.getTransport().bpm.value = project.latestSnapshot.song.tempo;
			}
		});
	}

	async play() {
		console.log("AudioEngine.play");
		if (Tone.getContext().state !== "running") {
			await Tone.start();
		}
		const synth = new Tone.Synth().toDestination();
		const currentPattern = 0;
		new Tone.Sequence(
			(time, index) => {
				const patterns = this.store?.data?.latestSnapshot?.song?.patterns;
				if (patterns !== undefined && patterns.at(currentPattern)) {
					const sequences: Sequence[] = patterns[currentPattern].sequences;
					sequences.forEach((sequence) => {
						const note = sequence.steps[index];
						if (note === null) return;
						synth.triggerAttackRelease(note, "16n", time);
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
}
