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
	/**
	 * Set when a debounced or immediate write to the data service rejects. The
	 * optimistic local update already happened, so the user's edit is not lost
	 * locally, but it has not reached the backend and a UI banner should say so.
	 * Cleared on the next successful write.
	 */
	saveError: string | null;
}

const [store, setStore] = createStore<ProjectStore>({
	data: null,
	loading: true,
	error: null,
	notFound: false,
	saveError: null,
});

/** Human-readable message stashed on the store when a project write fails. */
const SAVE_ERROR_MESSAGE = "Changes could not be saved.";

function recordSaveError(error: unknown) {
	console.error("Error saving project:", error);
	setStore("saveError", SAVE_ERROR_MESSAGE);
}

function recordSaveSuccess() {
	setStore("saveError", null);
}

/**
 * Trailing-debounced project persistence.
 *
 * A slider drag fires many setter calls per second. Writing every one to
 * Firestore is wasteful and amplifies the snapshot echo the subscription has
 * to filter out. Coalesce rapid edits into a single write once the user pauses.
 * The optimistic store update stays synchronous; only the network write waits.
 */
const PERSIST_DEBOUNCE_MS = 200;
let persistTimer: ReturnType<typeof setTimeout> | undefined;

let pendingProject: Project | undefined;

function persistProject(project: Project) {
	pendingProject = project;
	if (persistTimer !== undefined) clearTimeout(persistTimer);
	persistTimer = setTimeout(() => {
		persistTimer = undefined;
		pendingProject = undefined;
		dataService.updateProject(project).then(recordSaveSuccess, recordSaveError);
	}, PERSIST_DEBOUNCE_MS);
}

/**
 * Immediately write any debounced edit that is still waiting. Called before the
 * subscription tears down (id change or unmount) so a coalesced edit is never
 * dropped.
 */
function flushPendingWrite() {
	if (persistTimer === undefined) return;
	clearTimeout(persistTimer);
	persistTimer = undefined;
	const project = pendingProject;
	pendingProject = undefined;
	if (project) {
		dataService.updateProject(project).then(recordSaveSuccess, recordSaveError);
	}
}

/**
 * The live project store. `useProject` returns this same object after wiring up
 * a subscription; consumers that only need to read current state (or observe it
 * reactively) can use it directly.
 */
export const projectStore = store as ProjectStore;

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
				state.saveError = null;
			}),
		);

		const unsubscribe = dataService.subscribeToProject(id, (result) => {
			setStore(
				produce((state) => {
					state.data = result.project;
					state.loading = false;
					state.error = result.error
						? "Something went wrong while loading this project."
						: null;
					state.notFound = result.notFound;
				}),
			);
		});

		onCleanup(() => {
			// Persist any debounced edit before we stop listening, otherwise a
			// coalesced change made just before navigating away is lost.
			flushPendingWrite();
			unsubscribe();
		});
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

	persistProject(store.data);
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

	persistProject(store.data);
}

export function setSong(song: Song) {
	if (!store.data) return;

	setStore(
		produce((state) => {
			if (!state.data) return;
			state.data.latestSnapshot.song = song;
		}),
	);

	persistProject(store.data);
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

	persistProject(store.data);
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

	dataService.updateProject(project).then(recordSaveSuccess, recordSaveError);
}

export function setInstrument(trackIndex: number, instrument: Instrument) {
	if (!store.data) return;

	setStore(
		produce((state) => {
			if (!state.data) return;
			state.data.latestSnapshot.song.tracks[trackIndex].instrument = instrument;
		}),
	);

	persistProject(store.data);
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

	persistProject(store.data);
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

	persistProject(store.data);
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

	persistProject(store.data);
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

	persistProject(store.data);
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

	persistProject(store.data);
}
