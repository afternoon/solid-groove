import * as Tone from "tone";
import type { Project } from "../model/types";

export default class AudioEngine {
	private project: Project | null = null;

	constructor() {
		console.log("We are the music makers, and we are the dreamers of dreams.");
	}

	play() {
		console.log("AudioEngine.play");
	}

	stop() {
		console.log("AudioEngine.stop");
	}

	setProject(project: Project) {
		this.project = project;
		const song = this.project.latestSnapshot?.song;
		if (song?.tempo) {
			Tone.getTransport().bpm.value = song?.tempo;
		}
	}
}
