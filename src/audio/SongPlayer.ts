import { createEffect } from "solid-js";
import * as Tone from "tone";
import type { ProjectStore } from "../model/project";

export default class SongPlayer {
	constructor() {
		console.log("We are the music makers, and we are the dreamers of dreams.");
	}

	setProjectStore(store: ProjectStore) {
		// this.store = store;

		// React to changes in the project data
		createEffect(() => {
			const project = store.data;
			if (project?.latestSnapshot?.song?.tempo) {
				console.log("AudioEngine tempo=", project.latestSnapshot.song.tempo);
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
		new Tone.Sequence(
			(time, note) => {
				if (note === null) return;
				synth.triggerAttackRelease(note, "16n", time);
			},
			[
				"C3",
				null,
				null,
				"C3",
				null,
				null,
				"C3",
				null,
				"C3",
				null,
				null,
				"C3",
				null,
				null,
				"C3",
				null,
			],
			"16n",
		).start(0);
		Tone.getTransport().start();
	}

	stop() {
		console.log("AudioEngine.stop");
		Tone.getTransport().stop();
	}
}
