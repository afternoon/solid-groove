import type {
	AutomationLane,
	Clip,
	Placement,
	Project,
	Section,
	Track,
} from "./entities";
import {
	bars,
	createAsset,
	createAudioLoopClip,
	createDrumMachineInstrument,
	createDrumPad,
	createEmptySong,
	createFactoryContext,
	createNoteClip,
	createNoteEvent,
	createPlacement,
	createProjectMetadata,
	createSamplerInstrument,
	createSection,
	createTrack,
	type DomainFactoryContext,
} from "./factories";
import { createSeededIdFactory, type IdFactory } from "./ids";
import { TRACK_PAN, TRACK_VOLUME } from "./parameters";
import { assertProject } from "./parse";
import {
	minutesToTicks,
	TICKS_PER_BAR,
	TICKS_PER_SIXTEENTH,
	toTicks,
} from "./time";

/**
 * Deterministic domain fixtures.
 *
 * These are the shared reference projects for schema, persistence, renderer,
 * and audio tests. They are built from the same factories as production state
 * and are always seeded, so two runs produce identical IDs and identical
 * serialized JSON.
 */

export interface FixtureOptions {
	seed?: string;
	ownerId?: string;
	now?: number;
	tempo?: number;
}

interface FixtureContext extends DomainFactoryContext {
	readonly ids: IdFactory;
}

function fixtureContext(options: FixtureOptions, seed: string): FixtureContext {
	return createFactoryContext({
		ids: createSeededIdFactory(options.seed ?? seed),
		now: options.now ?? 1_700_000_000_000,
	});
}

/**
 * The `FND-009` vertical slice fixture: one sampler track holding a one-bar
 * four-on-the-floor clip placed once in the arrangement.
 */
export function createSliceFixtureProject(
	options: FixtureOptions = {},
): Project {
	const context = fixtureContext(options, "slice-fixture");
	const song = createEmptySong(options.tempo ?? 120);

	const asset = createAsset(context, {
		name: "909 Bass Drum",
		storageRef: "samples/house/drums/bd/909-bd.wav",
		url: "/samples/house/drums/bd/909-bd.wav",
		durationSeconds: 0.6,
		sampleRate: 44_100,
		channelCount: 1,
	});

	const track = createTrack(context, {
		name: "BD",
		order: 0,
		instrument: createSamplerInstrument(asset.id),
	});

	const clip = createNoteClip(context, {
		trackId: track.id,
		name: "Four on the floor",
		lengthTicks: TICKS_PER_BAR,
		events: [0, 4, 8, 12].map((sixteenth) =>
			createNoteEvent(context, {
				startTicks: sixteenth * TICKS_PER_SIXTEENTH,
				durationTicks: TICKS_PER_SIXTEENTH,
				pitch: 36,
			}),
		),
	});

	const placement = createPlacement(context, {
		clipId: clip.id,
		trackId: track.id,
		startTicks: 0,
		durationTicks: TICKS_PER_BAR,
	});

	return assertProject({
		metadata: createProjectMetadata(context, {
			ownerId: options.ownerId ?? "user_fixture",
			name: "Slice fixture",
			template: "blank",
		}),
		song: {
			...song,
			assets: [asset],
			tracks: [track],
			placements: [placement],
		},
		clips: [clip],
	});
}

/**
 * The drum-machine fixture: a `drumMachine` track whose pads reference assets
 * and whose clip triggers those pads, plus an audio track holding an
 * `audioLoop` clip. It covers the clip-content and instrument variants the
 * slice fixture deliberately leaves out.
 */
export function createDrumMachineFixtureProject(
	options: FixtureOptions = {},
): Project {
	const context = fixtureContext(options, "drum-machine-fixture");
	const tempo = options.tempo ?? 120;
	const song = createEmptySong(tempo);

	const kickAsset = createAsset(context, {
		name: "909 Bass Drum",
		storageRef: "samples/house/drums/bd/909-bd.wav",
		url: "/samples/house/drums/bd/909-bd.wav",
		durationSeconds: 0.6,
		sampleRate: 44_100,
		channelCount: 1,
	});
	const clapAsset = createAsset(context, {
		name: "909 Clap",
		storageRef: "samples/house/drums/cp/909-cp.wav",
		url: "/samples/house/drums/cp/909-cp.wav",
		durationSeconds: 0.4,
		sampleRate: 44_100,
		channelCount: 1,
	});
	const loopAsset = createAsset(context, {
		name: "Break loop",
		kind: "loop",
		storageRef: "samples/house/loops/break-120.wav",
		url: "/samples/house/loops/break-120.wav",
		durationSeconds: 4,
		sampleRate: 44_100,
		channelCount: 2,
	});

	const kickPad = createDrumPad(context, {
		name: "BD",
		assetId: kickAsset.id,
	});
	const clapPad = createDrumPad(context, {
		name: "CP",
		assetId: clapAsset.id,
	});

	const drumTrack = createTrack(context, {
		name: "Drums",
		order: 0,
		instrument: createDrumMachineInstrument([kickPad, clapPad]),
	});
	const audioTrack = createTrack(context, {
		name: "Break",
		order: 1,
		type: "audio",
		instrument: null,
	});

	const drumClip = createNoteClip(context, {
		trackId: drumTrack.id,
		name: "Beat",
		lengthTicks: TICKS_PER_BAR,
		events: [
			...[0, 4, 8, 12].map((sixteenth) =>
				createNoteEvent(context, {
					startTicks: sixteenth * TICKS_PER_SIXTEENTH,
					durationTicks: TICKS_PER_SIXTEENTH,
					padId: kickPad.id,
				}),
			),
			...[4, 12].map((sixteenth) =>
				createNoteEvent(context, {
					startTicks: sixteenth * TICKS_PER_SIXTEENTH,
					durationTicks: TICKS_PER_SIXTEENTH,
					padId: clapPad.id,
				}),
			),
		],
	});

	const loopClip = createAudioLoopClip(context, {
		trackId: audioTrack.id,
		assetId: loopAsset.id,
		name: "Break loop",
		lengthTicks: TICKS_PER_BAR * 2,
		sourceTempo: tempo,
	});

	return assertProject({
		metadata: createProjectMetadata(context, {
			ownerId: options.ownerId ?? "user_fixture",
			name: "Drum machine fixture",
			template: "blank",
		}),
		song: {
			...song,
			assets: [kickAsset, clapAsset, loopAsset],
			tracks: [drumTrack, audioTrack],
			placements: [
				createPlacement(context, {
					clipId: drumClip.id,
					trackId: drumTrack.id,
					startTicks: 0,
					durationTicks: TICKS_PER_BAR,
				}),
				createPlacement(context, {
					clipId: loopClip.id,
					trackId: audioTrack.id,
					startTicks: 0,
					durationTicks: TICKS_PER_BAR * 2,
				}),
			],
		},
		clips: [drumClip, loopClip],
	});
}

export interface ReferenceProjectOptions extends FixtureOptions {
	/** Tracks in the arrangement. The PRD reference project uses 50. */
	trackCount?: number;
	/** Arrangement length in minutes. The PRD reference project uses 10. */
	minutes?: number;
	/** Total arrangement placements. The PRD reference project uses 2,500. */
	placementCount?: number;
	/** Automation lanes. The PRD reference project uses 100. */
	automationLaneCount?: number;
}

/**
 * The PRD section 9.3 reference arrangement: 50 tracks, ten minutes of musical
 * time, 2,500 placements, and 100 automation lanes by default. Used for
 * ten-minute bound tests here, and by persistence and renderer budgets later.
 */
export function createReferenceProject(
	options: ReferenceProjectOptions = {},
): Project {
	const context = fixtureContext(options, "reference-fixture");
	const tempo = options.tempo ?? 120;
	const trackCount = options.trackCount ?? 50;
	const minutes = options.minutes ?? 10;
	const placementCount = options.placementCount ?? 2_500;
	const automationLaneCount = options.automationLaneCount ?? 100;

	const lengthTicks = minutesToTicks(minutes, tempo);
	const barCount = Math.floor(lengthTicks / TICKS_PER_BAR);

	const tracks: Track[] = [];
	const clips: Clip[] = [];
	const placements: Placement[] = [];
	const automation: AutomationLane[] = [];

	const asset = createAsset(context, {
		name: "Reference loop",
		storageRef: "samples/reference/loop.wav",
		url: "/samples/reference/loop.wav",
		durationSeconds: 2,
		sampleRate: 44_100,
		channelCount: 2,
	});

	const placementsPerTrack = Math.ceil(placementCount / trackCount);

	for (let index = 0; index < trackCount; index += 1) {
		const track = createTrack(context, {
			name: `Track ${index + 1}`,
			order: index,
			instrument: createSamplerInstrument(asset.id),
		});
		tracks.push(track);

		const clip = createNoteClip(context, {
			trackId: track.id,
			name: `Clip ${index + 1}`,
			lengthTicks: TICKS_PER_BAR * 2,
			events: [0, 2, 4, 6, 8, 10, 12, 14].map((sixteenth) =>
				createNoteEvent(context, {
					startTicks: sixteenth * TICKS_PER_SIXTEENTH,
					durationTicks: TICKS_PER_SIXTEENTH,
					pitch: 36 + (index % 24),
					velocity: 0.6 + (index % 4) / 10,
				}),
			),
		});
		clips.push(clip);

		const spacingBars = Math.max(
			2,
			Math.floor(barCount / Math.max(1, placementsPerTrack)),
		);
		for (let slot = 0; slot < placementsPerTrack; slot += 1) {
			const startBar = slot * spacingBars;
			if (startBar + 2 > barCount) {
				break;
			}
			if (placements.length >= placementCount) {
				break;
			}
			placements.push(
				createPlacement(context, {
					clipId: clip.id,
					trackId: track.id,
					startTicks: bars(startBar),
					durationTicks: bars(2),
				}),
			);
		}
	}

	for (let index = 0; index < automationLaneCount; index += 1) {
		const track = tracks[index % tracks.length];
		const parameter = index % 2 === 0 ? TRACK_VOLUME : TRACK_PAN;
		automation.push({
			id: context.ids("automation"),
			target: {
				scope: "track",
				trackId: track.id,
				parameterId: parameter.id,
			},
			interpolation: "linear",
			points: Array.from({ length: 32 }, (_, pointIndex) => ({
				tick: toTicks(pointIndex * Math.floor(lengthTicks / 32)),
				value:
					parameter.min +
					((parameter.max - parameter.min) * (pointIndex % 8)) / 8,
			})),
		});
	}

	const sections: Section[] = ["Intro", "Verse", "Chorus", "Outro"].map(
		(name, index) =>
			createSection(context, {
				name,
				startTicks: bars(index * Math.floor(barCount / 4)),
				durationTicks: bars(Math.max(1, Math.floor(barCount / 4))),
			}),
	);

	return assertProject({
		metadata: createProjectMetadata(context, {
			ownerId: options.ownerId ?? "user_fixture",
			name: "Reference arrangement",
			genre: "house",
		}),
		song: {
			...createEmptySong(tempo),
			assets: [asset],
			tracks,
			placements,
			automation,
			sections,
		},
		clips,
	});
}
