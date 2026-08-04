// Test-only fixtures for the command suite.
//
// This lives beside the code it supports (the same pattern as
// `src/audio/testAudioContext.ts`) because it is specific to command tests
// rather than shared across suites. It is built from the real domain
// factories and always seeded, so IDs and serialized output are identical on
// every run.
//
// `src/domain/fixtures.ts`'s projects deliberately cover the schema's shape;
// this one covers the surfaces commands touch that those fixtures leave empty:
// a return bus and a send, an insert device with a parameter, an automation
// lane, and two tracks so reorder and delete cascades have something to move.

import {
	type AssetId,
	assertProject,
	bars,
	type ClipId,
	createAsset,
	createDrumMachineInstrument,
	createDrumPad,
	createEmptySong,
	createFactoryContext,
	createNoteClip,
	createNoteEvent,
	createPack,
	createPlacement,
	createProjectMetadata,
	createReturnBus,
	createSamplerInstrument,
	createSeededIdFactory,
	createSend,
	createTrack,
	type Device,
	type DeviceId,
	derivePackDependencies,
	type EventId,
	type Pack,
	type PadId,
	type PlacementId,
	type Project,
	type ReturnId,
	type Song,
	serializeProject,
	TICKS_PER_BAR,
	TICKS_PER_SIXTEENTH,
	TRACK_VOLUME,
	type TrackId,
	toTicks,
} from "../domain";

/** Device type used by the fixture's insert device. */
export const TEST_DEVICE_TYPE = "testDelay";

/** Parameter ID on that device, registered by tests that set it. */
export const TEST_DEVICE_PARAMETER = "time";

export interface CommandTestProject {
	project: Project;
	trackAId: TrackId;
	trackBId: TrackId;
	clipAId: ClipId;
	clipBId: ClipId;
	deviceId: DeviceId;
	returnId: ReturnId;
	placementAId: PlacementId;
	padIds: PadId[];
	/** The sampler asset on track A, and the clap asset the kick pad uses. */
	assetIds: { sampler: AssetId; pad: AssetId };
	/** The two packs the fixture's assets resolve from, in dependency order. */
	packs: [Pack, Pack];
	/** A pack on the shelf that no asset uses — a `pack.remove` target (LIB-08). */
	shelfOnlyPack: Pack;
	/** Event IDs of `clipA`, in the order the fixture created them. */
	eventIds: EventId[];
}

export function createCommandTestProject(
	seed = "commands",
): CommandTestProject {
	const context = createFactoryContext({
		ids: createSeededIdFactory(seed),
		now: 1_700_000_000_000,
	});

	// Two packs, and the drum pads resolve from the second one, so a command,
	// undo, or redo that changes which assets a project holds has two dependencies
	// to keep straight rather than one.
	const drumsPack = createPack(context, { name: "Command Drums" });
	const bassPack = createPack(context, {
		name: "Command Bass",
		version: "3.2.1",
	});
	// A pack the user has added to the shelf but drawn no sound from yet (LIB-08):
	// it is in `addedPacks` and never in the derived `packDependencies`, which is
	// the state a `pack.remove` must be able to act on.
	const shelfOnlyPack = createPack(context, {
		name: "Command Extras",
		version: "2.0.0",
	});

	const asset = createAsset(context, {
		pack: bassPack,
		name: "909 Bass Drum",
		storageRef: "samples/house/drums/bd/909-bd.wav",
	});
	const padAsset = createAsset(context, {
		pack: drumsPack,
		name: "909 Clap",
		storageRef: "samples/house/drums/cp/909-cp.wav",
	});

	const device: Device = {
		id: context.ids("device"),
		type: TEST_DEVICE_TYPE,
		order: 0,
		bypassed: false,
		parameters: { [TEST_DEVICE_PARAMETER]: 0.25 },
		preset: null,
	};

	const returnBus = createReturnBus(context, { name: "Reverb", order: 0 });

	const trackA = createTrack(context, {
		name: "Bass",
		order: 0,
		instrument: createSamplerInstrument(asset.id),
		devices: [device],
		sendConfig: [createSend(returnBus.id, 0.25)],
	});

	const kick = createDrumPad(context, { name: "BD", assetId: padAsset.id });
	const clap = createDrumPad(context, { name: "CP" });
	const trackB = createTrack(context, {
		name: "Drums",
		order: 1,
		instrument: createDrumMachineInstrument([kick, clap]),
	});

	const clipA = createNoteClip(context, {
		trackId: trackA.id,
		name: "Bassline",
		lengthTicks: TICKS_PER_BAR,
		events: [0, 4, 8, 12].map((sixteenth) =>
			createNoteEvent(context, {
				startTicks: sixteenth * TICKS_PER_SIXTEENTH,
				durationTicks: TICKS_PER_SIXTEENTH,
				pitch: 36 + sixteenth,
				velocity: 0.5,
			}),
		),
	});

	const clipB = createNoteClip(context, {
		trackId: trackB.id,
		name: "Beat",
		lengthTicks: TICKS_PER_BAR,
		events: [0, 8].map((sixteenth) =>
			createNoteEvent(context, {
				startTicks: sixteenth * TICKS_PER_SIXTEENTH,
				durationTicks: TICKS_PER_SIXTEENTH,
				padId: kick.id,
			}),
		),
	});

	const placementA = createPlacement(context, {
		clipId: clipA.id,
		trackId: trackA.id,
		startTicks: 0,
		durationTicks: bars(1),
	});
	const placementB = createPlacement(context, {
		clipId: clipB.id,
		trackId: trackB.id,
		startTicks: 0,
		durationTicks: bars(1),
	});

	const song: Song = {
		...createEmptySong(120),
		assets: [asset, padAsset],
		tracks: [trackA, trackB],
		returns: [returnBus],
		placements: [placementA, placementB],
		automation: [
			{
				id: context.ids("automation"),
				target: {
					scope: "track",
					trackId: trackA.id,
					parameterId: TRACK_VOLUME.id,
				},
				interpolation: "linear",
				points: [
					{ tick: toTicks(0), value: 0 },
					{ tick: toTicks(TICKS_PER_BAR), value: -6 },
				],
			},
		],
	};

	const derivedDependencies = derivePackDependencies(song);
	const project = assertProject({
		metadata: createProjectMetadata(context, {
			ownerId: "user_commands",
			name: "Command fixture",
			packDependencies: derivedDependencies,
			// The shelf is every used pack plus the one added-but-unused pack.
			addedPacks: [
				...derivedDependencies,
				{ packId: shelfOnlyPack.id, version: shelfOnlyPack.version },
			],
		}),
		song,
		clips: [clipA, clipB],
	});

	return {
		project,
		trackAId: trackA.id,
		trackBId: trackB.id,
		clipAId: clipA.id,
		clipBId: clipB.id,
		deviceId: device.id,
		returnId: returnBus.id,
		placementAId: placementA.id,
		padIds: [kick.id, clap.id],
		assetIds: { sampler: asset.id, pad: padAsset.id },
		packs: [drumsPack, bassPack],
		shelfOnlyPack,
		eventIds:
			clipA.content.kind === "notes"
				? clipA.content.events.map((event) => event.id)
				: [],
	};
}

/**
 * Well-formed IDs that no fixture uses, for "the payload is valid but the
 * entity is gone" tests. They have to pass the ID schema, or a test would
 * assert on a payload rejection when it means to assert on a precondition.
 */
const ABSENT_SUFFIX = "A".repeat(21);
export const ABSENT_IDS = {
	track: `trk_${ABSENT_SUFFIX}` as TrackId,
	clip: `clp_${ABSENT_SUFFIX}` as ClipId,
	event: `evt_${ABSENT_SUFFIX}` as EventId,
	placement: `plc_${ABSENT_SUFFIX}` as PlacementId,
	device: `dev_${ABSENT_SUFFIX}` as DeviceId,
	return: `ret_${ABSENT_SUFFIX}` as ReturnId,
	pad: `pad_${ABSENT_SUFFIX}` as PadId,
} as const;

/** A seeded factory context for building entities inside a test. */
export function createTestFactoryContext(seed = "test-entities") {
	return createFactoryContext({
		ids: createSeededIdFactory(seed),
		now: 1_700_000_000_000,
	});
}

/**
 * Everything about a project except its metadata, serialized deterministically.
 * Undo restores musical content exactly; it does not rewind the revision
 * counter or `modifiedAt`, so those are excluded from the comparison.
 */
export function contentSignature(project: Project): string {
	const { metadata: _metadata, ...content } = serializeProject(project);
	return JSON.stringify(content);
}
