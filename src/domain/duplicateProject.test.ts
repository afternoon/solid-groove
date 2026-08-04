import { describe, expect, it } from "vitest";
import { duplicateProject } from "./duplicateProject";
import {
	type AutomationLane,
	type Device,
	type Project,
	packVersion,
	type Song,
} from "./entities";
import {
	createAsset,
	createAudioLoopClip,
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
	createSection,
	createSend,
	createTrack,
} from "./factories";
import { createSeededIdFactory } from "./ids";
import { derivePackDependencies } from "./packs";
import { assertProject } from "./parse";
import { TICKS_PER_BAR, TICKS_PER_SIXTEENTH, toTicks } from "./time";

/**
 * A project exercising every referenceable entity kind `duplicateProject` must
 * remap: sampler + drum-machine tracks (with a pad-triggered note clip), an
 * audio-loop clip, a return bus with its own device chain and a track send
 * into it, master devices, a section, and automation lanes across all five
 * target scopes (track, trackDevice, send, return, master).
 */
function buildRichProject(seed = "duplicate-fixture"): Project {
	const context = createFactoryContext({
		ids: createSeededIdFactory(seed),
		now: 1_700_000_000_000,
	});

	const pack = createPack(context, {
		name: "House Drums",
		description: "Fixture pack",
	});

	const kickAsset = createAsset(context, {
		pack,
		name: "Kick",
		storageRef: "samples/kick.wav",
		url: "/samples/kick.wav",
		durationSeconds: 0.5,
		sampleRate: 44_100,
		channelCount: 1,
	});
	const loopAsset = createAsset(context, {
		pack,
		name: "Loop",
		kind: "loop",
		storageRef: "samples/loop.wav",
		url: "/samples/loop.wav",
		durationSeconds: 4,
		sampleRate: 44_100,
		channelCount: 2,
	});

	const kickPad = createDrumPad(context, {
		name: "Kick",
		assetId: kickAsset.id,
	});

	const returnBus = createReturnBus(context, { name: "Reverb", order: 0 });
	const returnDevice: Device = {
		id: context.ids("device"),
		type: "reverb",
		order: 0,
		bypassed: false,
		parameters: { wet: 0.4 },
		preset: null,
	};
	const returnWithDevice = { ...returnBus, devices: [returnDevice] };

	const trackDevice: Device = {
		id: context.ids("device"),
		type: "eq",
		order: 0,
		bypassed: false,
		parameters: { gain: 0 },
		preset: null,
	};

	const drumTrack = createTrack(context, {
		name: "Drums",
		order: 0,
		instrument: createDrumMachineInstrument([kickPad]),
		devices: [trackDevice],
		sendConfig: [createSend(returnBus.id, 0.5)],
	});
	const samplerTrack = createTrack(context, {
		name: "Bass",
		order: 1,
		instrument: createSamplerInstrument(kickAsset.id),
	});
	const audioTrack = createTrack(context, {
		name: "Break",
		order: 2,
		type: "audio",
		instrument: null,
	});

	const masterDevice: Device = {
		id: context.ids("device"),
		type: "limiter",
		order: 0,
		bypassed: false,
		parameters: {},
		preset: null,
	};

	const drumClip = createNoteClip(context, {
		trackId: drumTrack.id,
		name: "Beat",
		lengthTicks: TICKS_PER_BAR,
		events: [0, 8].map((sixteenth) =>
			createNoteEvent(context, {
				startTicks: sixteenth * TICKS_PER_SIXTEENTH,
				durationTicks: TICKS_PER_SIXTEENTH,
				padId: kickPad.id,
			}),
		),
	});
	const bassClip = createNoteClip(context, {
		trackId: samplerTrack.id,
		name: "Bassline",
		lengthTicks: TICKS_PER_BAR,
		events: [
			createNoteEvent(context, {
				startTicks: 0,
				durationTicks: TICKS_PER_SIXTEENTH,
				pitch: 36,
			}),
		],
	});
	const loopClip = createAudioLoopClip(context, {
		trackId: audioTrack.id,
		assetId: loopAsset.id,
		name: "Break loop",
		lengthTicks: TICKS_PER_BAR * 2,
	});

	const section = createSection(context, {
		name: "Intro",
		startTicks: 0,
		durationTicks: TICKS_PER_BAR * 2,
	});

	const automation: AutomationLane[] = [
		{
			id: context.ids("automation"),
			target: {
				scope: "track",
				trackId: drumTrack.id,
				parameterId: "track.volume",
			},
			interpolation: "linear",
			points: [{ tick: toTicks(0), value: 0.8 }],
		},
		{
			id: context.ids("automation"),
			target: {
				scope: "trackDevice",
				trackId: drumTrack.id,
				deviceId: trackDevice.id,
				parameterId: "track.pan",
			},
			interpolation: "step",
			points: [{ tick: toTicks(0), value: 0 }],
		},
		{
			id: context.ids("automation"),
			target: {
				scope: "send",
				trackId: drumTrack.id,
				returnId: returnBus.id,
				parameterId: "track.sendLevel",
			},
			interpolation: "linear",
			points: [{ tick: toTicks(0), value: 0.5 }],
		},
		{
			id: context.ids("automation"),
			target: {
				scope: "return",
				returnId: returnBus.id,
				parameterId: "return.volume",
			},
			interpolation: "linear",
			points: [{ tick: toTicks(0), value: 0.9 }],
		},
		{
			id: context.ids("automation"),
			target: { scope: "master", parameterId: "master.volume" },
			interpolation: "linear",
			points: [{ tick: toTicks(0), value: 1 }],
		},
	];

	const song: Song = {
		...createEmptySong(120),
		tracks: [drumTrack, samplerTrack, audioTrack],
		returns: [returnWithDevice],
		master: { ...createEmptySong(120).master, devices: [masterDevice] },
		sections: [section],
		assets: [kickAsset, loopAsset],
		placements: [
			createPlacement(context, {
				clipId: drumClip.id,
				trackId: drumTrack.id,
				startTicks: 0,
				durationTicks: TICKS_PER_BAR,
			}),
			createPlacement(context, {
				clipId: bassClip.id,
				trackId: samplerTrack.id,
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
		automation,
	};

	const dependencies = derivePackDependencies(song);
	return assertProject({
		metadata: createProjectMetadata(context, {
			ownerId: "user_owner",
			name: "Rich Project",
			template: "starter",
			genre: "house",
			packDependencies: dependencies,
			// A pack on the shelf that no asset uses, so duplication has to carry it.
			addedPacks: [
				...dependencies,
				{ packId: context.ids("pack"), version: packVersion("1.0.0") },
			],
		}),
		song,
		clips: [drumClip, bassClip, loopClip],
	});
}

describe("duplicateProject", () => {
	it("produces a valid schema-v1 project", () => {
		const source = buildRichProject();
		const duplicate = duplicateProject(source);
		expect(() => assertProject(duplicate)).not.toThrow();
	});

	it("assigns a fresh project id, resets revision, and stamps fresh timestamps", () => {
		const source = buildRichProject();
		const duplicate = duplicateProject(source, { now: 1_800_000_000_000 });

		expect(duplicate.metadata.id).not.toBe(source.metadata.id);
		expect(duplicate.metadata.revision).toBe(0);
		expect(duplicate.metadata.createdAt).toBe(1_800_000_000_000);
		expect(duplicate.metadata.modifiedAt).toBe(1_800_000_000_000);
	});

	it("defaults the name to a 'copy' suffix and the owner to the source owner", () => {
		const source = buildRichProject();
		const duplicate = duplicateProject(source);

		expect(duplicate.metadata.name).toBe("Rich Project copy");
		expect(duplicate.metadata.ownerId).toBe(source.metadata.ownerId);
	});

	it("accepts an explicit name and owner override", () => {
		const source = buildRichProject();
		const duplicate = duplicateProject(source, {
			name: "My Copy",
			ownerId: "user_other",
		});

		expect(duplicate.metadata.name).toBe("My Copy");
		expect(duplicate.metadata.ownerId).toBe("user_other");
	});

	it("carries template and genre over unchanged", () => {
		const source = buildRichProject();
		const duplicate = duplicateProject(source);

		expect(duplicate.metadata.template).toBe(source.metadata.template);
		expect(duplicate.metadata.genre).toBe(source.metadata.genre);
	});

	it("mints independent IDs for every track, device, return, section, clip, event, placement, automation lane, and asset", () => {
		const source = buildRichProject();
		const duplicate = duplicateProject(source);

		const sourceIds = collectAllIds(source);
		const duplicateIds = collectAllIds(duplicate);

		for (const id of duplicateIds) {
			expect(sourceIds.has(id)).toBe(false);
		}
		// Same *count* of each kind of entity, just none of the same identities.
		expect(duplicate.song.tracks).toHaveLength(source.song.tracks.length);
		expect(duplicate.song.returns).toHaveLength(source.song.returns.length);
		expect(duplicate.song.sections).toHaveLength(source.song.sections.length);
		expect(duplicate.song.placements).toHaveLength(
			source.song.placements.length,
		);
		expect(duplicate.song.automation).toHaveLength(
			source.song.automation.length,
		);
		expect(duplicate.song.assets).toHaveLength(source.song.assets.length);
		expect(duplicate.clips).toHaveLength(source.clips.length);
	});

	it("keeps pack references (packId/packVersion) unchanged on duplicated assets", () => {
		const source = buildRichProject();
		const duplicate = duplicateProject(source);

		const sourcePacks = source.song.assets.map((a) => [
			a.packId,
			a.packVersion,
		]);
		const duplicatePacks = duplicate.song.assets.map((a) => [
			a.packId,
			a.packVersion,
		]);
		expect(duplicatePacks).toEqual(sourcePacks);
		expect(duplicate.metadata.packDependencies).toEqual(
			source.metadata.packDependencies,
		);
	});

	it("carries the pack shelf, including an added-but-unused pack, into the copy", () => {
		const source = buildRichProject();
		const duplicate = duplicateProject(source);

		expect(duplicate.metadata.addedPacks).toEqual(source.metadata.addedPacks);
		// The shelf is a strict superset of the dependency list: the extra pack the
		// user added but never used survives duplication.
		expect(duplicate.metadata.addedPacks.length).toBeGreaterThan(
			duplicate.metadata.packDependencies.length,
		);
	});

	it("remaps the sampler instrument's asset reference to the duplicated asset", () => {
		const source = buildRichProject();
		const duplicate = duplicateProject(source);

		const sourceSampler = source.song.tracks.find(
			(t) => t.instrument?.kind === "sampler",
		);
		const duplicateSampler = duplicate.song.tracks.find(
			(t) => t.instrument?.kind === "sampler",
		);
		expect(sourceSampler?.instrument?.kind).toBe("sampler");
		expect(duplicateSampler?.instrument?.kind).toBe("sampler");
		if (
			sourceSampler?.instrument?.kind === "sampler" &&
			duplicateSampler?.instrument?.kind === "sampler"
		) {
			const sourceAssetId = sourceSampler.instrument.assetId;
			const duplicateAssetId = duplicateSampler.instrument.assetId;
			expect(duplicateAssetId).not.toBe(sourceAssetId);
			expect(duplicate.song.assets.some((a) => a.id === duplicateAssetId)).toBe(
				true,
			);
		}
	});

	it("remaps drum pad triggers on note events to the duplicated pad", () => {
		const source = buildRichProject();
		const duplicate = duplicateProject(source);

		const sourceDrumTrack = source.song.tracks.find(
			(t) => t.instrument?.kind === "drumMachine",
		);
		const duplicateDrumTrack = duplicate.song.tracks.find(
			(t) => t.instrument?.kind === "drumMachine",
		);
		if (
			sourceDrumTrack?.instrument?.kind !== "drumMachine" ||
			duplicateDrumTrack?.instrument?.kind !== "drumMachine"
		) {
			throw new Error("expected drum machine tracks in both projects");
		}
		const sourcePadId = sourceDrumTrack.instrument.pads[0].id;
		const duplicatePadId = duplicateDrumTrack.instrument.pads[0].id;
		expect(duplicatePadId).not.toBe(sourcePadId);

		const duplicateDrumClip = duplicate.clips.find(
			(c) => c.trackId === duplicateDrumTrack.id,
		);
		if (duplicateDrumClip?.content.kind !== "notes") {
			throw new Error("expected a notes clip on the duplicated drum track");
		}
		for (const event of duplicateDrumClip.content.events) {
			expect(event.trigger).toEqual({ kind: "pad", padId: duplicatePadId });
		}
	});

	it("remaps the audio-loop clip's asset reference", () => {
		const source = buildRichProject();
		const duplicate = duplicateProject(source);

		const sourceLoopClip = source.clips.find(
			(c) => c.content.kind === "audioLoop",
		);
		const duplicateLoopClip = duplicate.clips.find(
			(c) => c.content.kind === "audioLoop",
		);
		if (
			sourceLoopClip?.content.kind !== "audioLoop" ||
			duplicateLoopClip?.content.kind !== "audioLoop"
		) {
			throw new Error("expected an audio loop clip in both projects");
		}
		const sourceAssetId = sourceLoopClip.content.assetId;
		const duplicateAssetId = duplicateLoopClip.content.assetId;
		expect(duplicateAssetId).not.toBe(sourceAssetId);
		expect(duplicate.song.assets.some((a) => a.id === duplicateAssetId)).toBe(
			true,
		);
	});

	it("remaps every automation target scope (track, trackDevice, send, return, master)", () => {
		const source = buildRichProject();
		const duplicate = duplicateProject(source);

		const sourceScopes = source.song.automation.map(
			(lane) => lane.target.scope,
		);
		const duplicateScopes = duplicate.song.automation.map(
			(lane) => lane.target.scope,
		);
		expect(duplicateScopes).toEqual(sourceScopes);

		for (const lane of duplicate.song.automation) {
			const target = lane.target;
			if (
				target.scope === "track" ||
				target.scope === "trackDevice" ||
				target.scope === "send"
			) {
				expect(duplicate.song.tracks.some((t) => t.id === target.trackId)).toBe(
					true,
				);
			}
			if (target.scope === "trackDevice") {
				const track = duplicate.song.tracks.find(
					(t) => t.id === target.trackId,
				);
				expect(track?.devices.some((d) => d.id === target.deviceId)).toBe(true);
			}
			if (target.scope === "send" || target.scope === "return") {
				expect(
					duplicate.song.returns.some((r) => r.id === target.returnId),
				).toBe(true);
			}
		}
	});

	it("remaps the track send's return reference", () => {
		const source = buildRichProject();
		const duplicate = duplicateProject(source);

		const sourceTrack = source.song.tracks.find((t) => t.sendConfig.length > 0);
		const duplicateTrack = duplicate.song.tracks.find(
			(t) => t.sendConfig.length > 0,
		);
		expect(sourceTrack).toBeDefined();
		expect(duplicateTrack).toBeDefined();
		expect(duplicateTrack?.sendConfig[0].returnId).not.toBe(
			sourceTrack?.sendConfig[0].returnId,
		);
		expect(
			duplicate.song.returns.some(
				(r) => r.id === duplicateTrack?.sendConfig[0].returnId,
			),
		).toBe(true);
	});

	it("does not mutate the source project", () => {
		const source = buildRichProject();
		const before = JSON.parse(JSON.stringify(source));
		duplicateProject(source);
		expect(source).toEqual(before);
	});

	it("builds independent duplicates on each call", () => {
		const source = buildRichProject();
		const a = duplicateProject(source);
		const b = duplicateProject(source);
		expect(a.metadata.id).not.toBe(b.metadata.id);
		expect(a.song.tracks[0].id).not.toBe(b.song.tracks[0].id);
	});
});

/** Every ID-bearing field across a project, for cross-project collision checks. */
function collectAllIds(project: Project): Set<string> {
	const ids = new Set<string>();
	ids.add(project.metadata.id);
	for (const track of project.song.tracks) {
		ids.add(track.id);
		for (const device of track.devices) ids.add(device.id);
		if (track.instrument?.kind === "drumMachine") {
			for (const pad of track.instrument.pads) ids.add(pad.id);
		}
	}
	for (const returnBus of project.song.returns) {
		ids.add(returnBus.id);
		for (const device of returnBus.devices) ids.add(device.id);
	}
	for (const device of project.song.master.devices) ids.add(device.id);
	for (const section of project.song.sections) ids.add(section.id);
	for (const placement of project.song.placements) ids.add(placement.id);
	for (const lane of project.song.automation) ids.add(lane.id);
	for (const asset of project.song.assets) ids.add(asset.id);
	for (const clip of project.clips) {
		ids.add(clip.id);
		if (clip.content.kind === "notes") {
			for (const event of clip.content.events) ids.add(event.id);
		}
	}
	return ids;
}
