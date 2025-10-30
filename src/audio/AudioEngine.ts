import * as Tone from "tone";
import type { Project } from "../model/types";

export default class AudioEngine {
	private project: Project | null = null;
	private sequence: Tone.Sequence<string | null> | null = null;

	constructor() {
		console.log("We are the music makers, and we are the dreamers of dreams.");
	}

	async play() {
		console.log("AudioEngine.play");
		if (Tone.getContext().state !== "running") {
			await Tone.start();
		}
		const synth = new Tone.Synth().toDestination();
		this.sequence = new Tone.Sequence(
			(time, note) => {
				if (note === null) return;
				synth.triggerAttackRelease(note, "16n", time);
			},
			[
				"C3",
				null,
				null,
				null,
				"C3",
				null,
				null,
				null,
				"C3",
				null,
				null,
				null,
				"C3",
				null,
				null,
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

	setProject(project: Project) {
		this.project = project;
		const song = this.project.latestSnapshot?.song;
		if (song?.tempo) {
			console.log("AudioEngine tempo=", song?.tempo)
			Tone.getTransport().bpm.value = song?.tempo;
		}
	}
}
