import type { Timestamp } from "firebase/firestore";

// Mock Firestore Timestamp for development
const mockTimestamp = {
	toDate: () => new Date("2025-01-01T00:00:00Z"),
	seconds: 0,
	nanoseconds: 0,
} as Timestamp;

export default {
	id: "nn-ts",
	name: "My First Groove",
	ownerId: "user-456",
	createdAt: mockTimestamp,
	isPublic: false,
	latestSnapshot: {
		song: {
			tempo: 125,
			tracks: [
				{
					name: "BD",
					volume: 1.0,
					isMuted: false,
					isSolo: false,
					instrument: {
						type: "sampler" as const,
						sampleUrl: "/samples/house/drums/bd/909-bd.mp3",
						envelope: {
							attack: 0.0,
							decay: 0.2,
							sustain: 0.8,
							release: 0.2,
						},
						filter: {
							type: "lowpass",
							cutoff: 20000,
							resonance: 0.0,
						},
					},
				},
				{
					name: "OH",
					volume: 1.0,
					isMuted: false,
					isSolo: false,
					instrument: {
						type: "sampler" as const,
						sampleUrl: "/samples/house/drums/bd/909-oh.mp3",
						envelope: {
							attack: 0.0,
							decay: 0.2,
							sustain: 0.8,
							release: 0.2,
						},
						filter: {
							type: "lowpass",
							cutoff: 20000,
							resonance: 0.0,
						},
					},
				},
			],
			patterns: [
				{
					sequences: [
						{
							steps: [
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
						},
						{
							steps: [
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
								"C3",
								null,
							],
						},
					],
				},
			],
		},
	},
};
