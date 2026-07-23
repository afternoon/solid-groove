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

function emptySteps(): (string | null)[] {
	return Array.from({ length: 16 }, () => null);
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
 * Builds a fresh, empty starter project owned by the given user. Works for
 * both anonymous and signed-in users — ownerId is simply the current uid.
 */
export function newProject(ownerId: string): Omit<Project, "id" | "createdAt"> {
	const tracks: Track[] = [
		starterTrack("BD", "/samples/house/drums/bd/909-bd.mp3"),
		starterTrack("OH", "/samples/house/drums/bd/909-oh.mp3"),
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
						sequences: tracks.map(() => ({ steps: emptySteps() })),
					},
				],
			},
		},
	};
}
