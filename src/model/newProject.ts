import type { Envelope, FilterConfig, Project, Track } from "./types";

const defaultEnvelope: Envelope = {
	attack: 0.0,
	decay: 0.2,
	sustain: 0.8,
	release: 0.2,
};

const defaultFilter: FilterConfig = {
	type: "lowpass",
	cutoff: 20000,
	resonance: 0.0,
};

// Builds a 16-step sequence with the given note placed on the listed (1-based)
// step numbers and the rest left empty.
function stepsOn(note: string, positions: number[]): (string | null)[] {
	return Array.from({ length: 16 }, (_, i) =>
		positions.includes(i + 1) ? note : null,
	);
}

function starterTrack(name: string, sampleUrl: string): Track {
	return {
		name,
		volume: 1.0,
		isMuted: false,
		isSolo: false,
		instrument: {
			type: "sampler",
			sampleUrl,
			envelope: { ...defaultEnvelope },
			filter: { ...defaultFilter },
		},
	};
}

/**
 * Builds a fresh starter project owned by the given user, pre-loaded with a
 * simple four-on-the-floor groove so playback produces sound right away. Works
 * for both anonymous and signed-in users — ownerId is simply the current uid.
 */
export function newProject(ownerId: string): Omit<Project, "id" | "createdAt"> {
	const tracks: Track[] = [
		starterTrack("BD", "/samples/house/drums/bd/909-bd.wav"),
		starterTrack("OH", "/samples/house/drums/bd/909-oh.wav"),
	];

	return {
		name: "Untitled Project",
		ownerId,
		isPublic: false,
		latestSnapshot: {
			song: {
				tempo: 120,
				tracks,
				patterns: [
					{
						sequences: [
							// BD: four-on-the-floor
							{ steps: stepsOn("C3", [1, 5, 9, 13]) },
							// OH: offbeat hats
							{ steps: stepsOn("C4", [3, 7, 11, 15]) },
						],
					},
				],
			},
		},
	};
}
