import { createEffect, onCleanup } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { dataService } from "./dataService";
import type {
	Envelope,
	FilterConfig,
	Instrument,
	Project,
	Song,
	Track,
} from "./types";

export interface ProjectStore {
	data: Project | null;
	loading: boolean;
	error: string | null;
	/**
	 * True when the requested project does not exist or the current user is not
	 * allowed to read it. Drives the 404 page in the editor.
	 */
	notFound: boolean;
}

const [store, setStore] = createStore<ProjectStore>({
	data: null,
	loading: true,
	error: null,
	notFound: false,
});

export function useProject(id: string): ProjectStore {
	createEffect(() => {
		// Reset state when the subscribed id changes so a stale project or a
		// stale 404 from a previous id is never shown.
		setStore(
			produce((state) => {
				state.data = null;
				state.loading = true;
				state.error = null;
				state.notFound = false;
			}),
		);

		const unsubscribe = dataService.subscribeToProject(id, (result) => {
			setStore(
				produce((state) => {
					state.data = result.project;
					state.loading = false;
					state.error = null;
					state.notFound = result.notFound;
				}),
			);
		});

		onCleanup(() => unsubscribe());
	});

	return store as ProjectStore;
}

export function setTempo(tempo: number) {
	if (!store.data) return;

	setStore(
		produce((state) => {
			if (!state.data) return;
			state.data.latestSnapshot.song.tempo = tempo;
		}),
	);

	dataService.updateProject(store.data);
}

export function setTrack(trackIndex: number, trackUpdates: Partial<Track>) {
	if (!store.data) return;

	setStore(
		produce((state) => {
			if (!state.data) return;
			Object.assign(
				state.data.latestSnapshot.song.tracks[trackIndex],
				trackUpdates,
			);
		}),
	);

	dataService.updateProject(store.data);
}

export function setSong(song: Song) {
	if (!store.data) return;

	setStore(
		produce((state) => {
			if (!state.data) return;
			state.data.latestSnapshot.song = song;
		}),
	);

	dataService.updateProject(store.data);
}

export function setSequenceStep(
	patternIndex: number,
	trackIndex: number,
	stepIndex: number,
	note: string | null,
) {
	if (!store.data) return;

	setStore(
		produce((state) => {
			if (!state.data) return;
			state.data.latestSnapshot.song.patterns[patternIndex].sequences[
				trackIndex
			].steps[stepIndex] = note;
		}),
	);

	dataService.updateProject(store.data);
}

export function setProject(project: Project) {
	setStore(
		produce((state) => {
			state.data = project;
			state.loading = false;
			state.error = null;
			state.notFound = false;
		}),
	);

	dataService.updateProject(project);
}

export function setInstrument(trackIndex: number, instrument: Instrument) {
	if (!store.data) return;

	setStore(
		produce((state) => {
			if (!state.data) return;
			state.data.latestSnapshot.song.tracks[trackIndex].instrument = instrument;
		}),
	);

	dataService.updateProject(store.data);
}

export function setInstrumentEnvelope(trackIndex: number, envelope: Envelope) {
	if (!store.data) return;

	setStore(
		produce((state) => {
			if (!state.data) return;
			const instrument =
				state.data.latestSnapshot.song.tracks[trackIndex].instrument;
			if (instrument.type === "synth" || instrument.type === "sampler") {
				instrument.envelope = envelope;
			}
		}),
	);

	dataService.updateProject(store.data);
}

export function setInstrumentFilter(trackIndex: number, filter: FilterConfig) {
	if (!store.data) return;

	setStore(
		produce((state) => {
			if (!state.data) return;
			const instrument =
				state.data.latestSnapshot.song.tracks[trackIndex].instrument;
			if (instrument.type === "synth" || instrument.type === "sampler") {
				instrument.filter = filter;
			}
		}),
	);

	dataService.updateProject(store.data);
}

export function setOscillatorType(
	trackIndex: number,
	oscillatorType: "sine" | "square" | "sawtooth" | "triangle",
) {
	if (!store.data) return;

	setStore(
		produce((state) => {
			if (!state.data) return;
			const instrument =
				state.data.latestSnapshot.song.tracks[trackIndex].instrument;
			if (instrument.type === "synth") {
				instrument.oscillatorType = oscillatorType;
			}
		}),
	);

	dataService.updateProject(store.data);
}

export function setSampleUrl(trackIndex: number, sampleUrl: string) {
	if (!store.data) return;

	setStore(
		produce((state) => {
			if (!state.data) return;
			const instrument =
				state.data.latestSnapshot.song.tracks[trackIndex].instrument;
			if (instrument.type === "sampler" || instrument.type === "clip") {
				instrument.sampleUrl = sampleUrl;
			}
		}),
	);

	dataService.updateProject(store.data);
}

export function setSampleTempo(trackIndex: number, sampleTempo: number) {
	if (!store.data) return;

	setStore(
		produce((state) => {
			if (!state.data) return;
			const instrument =
				state.data.latestSnapshot.song.tracks[trackIndex].instrument;
			if (instrument.type === "clip") {
				instrument.sampleTempo = sampleTempo;
			}
		}),
	);

	dataService.updateProject(store.data);
}
