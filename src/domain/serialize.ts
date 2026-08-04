import type {
	Asset,
	AutomationLane,
	Clip,
	Device,
	DrumPad,
	Instrument,
	NoteEvent,
	Placement,
	Project,
	ProjectMetadata,
	ReturnBus,
	Section,
	Send,
	Song,
	Track,
} from "./entities";

/**
 * Deterministic schema-v1 serialization.
 *
 * The same project always produces byte-identical JSON: keys are written in a
 * fixed order and every collection is sorted by stable, meaningful keys rather
 * than by insertion order. That makes round trips, diffs, remote-echo
 * comparison, and fixture assertions reliable.
 */

export type JsonValue =
	| string
	| number
	| boolean
	| null
	| JsonValue[]
	| { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

export function serializeProject(project: Project): JsonObject {
	return {
		metadata: serializeProjectMetadata(project.metadata),
		song: serializeSong(project.song),
		clips: sortBy(project.clips, (clip) => [clip.id]).map(serializeClip),
	};
}

/** Stable JSON text; equal projects always produce an equal string. */
export function stringifyProject(project: Project): string {
	return JSON.stringify(serializeProject(project));
}

export function serializeProjectMetadata(
	metadata: ProjectMetadata,
): JsonObject {
	return {
		id: metadata.id,
		schemaVersion: metadata.schemaVersion,
		revision: metadata.revision,
		name: metadata.name,
		ownerId: metadata.ownerId,
		collaboratorIds: [...metadata.collaboratorIds].sort(compareStrings),
		createdAt: metadata.createdAt,
		modifiedAt: metadata.modifiedAt,
		template: metadata.template,
		genre: metadata.genre,
		packDependencies: sortBy(metadata.packDependencies, (dependency) => [
			dependency.packId,
			dependency.version,
		]).map((dependency) => ({
			packId: dependency.packId,
			version: dependency.version,
		})),
		addedPacks: sortBy(metadata.addedPacks, (entry) => [
			entry.packId,
			entry.version,
		]).map((entry) => ({
			packId: entry.packId,
			version: entry.version,
		})),
	};
}

export function serializeSong(song: Song): JsonObject {
	return {
		tempo: song.tempo,
		timeSignature: {
			numerator: song.timeSignature.numerator,
			denominator: song.timeSignature.denominator,
		},
		tracks: sortBy(song.tracks, (track) => [track.order, track.id]).map(
			serializeTrack,
		),
		returns: sortBy(song.returns, (bus) => [bus.order, bus.id]).map(
			serializeReturnBus,
		),
		master: {
			volume: song.master.volume,
			devices: serializeDevices(song.master.devices),
		},
		sections: sortBy(song.sections, (section) => [
			section.startTicks,
			section.id,
		]).map(serializeSection),
		placements: sortBy(song.placements, (placement) => [
			placement.startTicks,
			placement.trackId,
			placement.id,
		]).map(serializePlacement),
		automation: sortBy(song.automation, (lane) => [
			automationSortKey(lane),
			lane.id,
		]).map(serializeAutomationLane),
		assets: sortBy(song.assets, (asset) => [asset.id]).map(serializeAsset),
	};
}

export function serializeClip(clip: Clip): JsonObject {
	return {
		id: clip.id,
		trackId: clip.trackId,
		name: clip.name,
		color: clip.color,
		lengthTicks: clip.lengthTicks,
		content:
			clip.content.kind === "notes"
				? {
						kind: clip.content.kind,
						events: sortBy(clip.content.events, (event) => [
							event.startTicks,
							event.id,
						]).map(serializeNoteEvent),
					}
				: {
						kind: clip.content.kind,
						assetId: clip.content.assetId,
						sourceTempo: clip.content.sourceTempo,
						startOffsetTicks: clip.content.startOffsetTicks,
					},
	};
}

function serializeNoteEvent(event: NoteEvent): JsonObject {
	return {
		id: event.id,
		trigger:
			event.trigger.kind === "pitch"
				? { kind: event.trigger.kind, pitch: event.trigger.pitch }
				: { kind: event.trigger.kind, padId: event.trigger.padId },
		startTicks: event.startTicks,
		durationTicks: event.durationTicks,
		velocity: event.velocity,
		probability: event.probability,
	};
}

function serializeTrack(track: Track): JsonObject {
	return {
		id: track.id,
		name: track.name,
		color: track.color,
		order: track.order,
		type: track.type,
		instrument: track.instrument ? serializeInstrument(track.instrument) : null,
		devices: serializeDevices(track.devices),
		sendConfig: sortBy(track.sendConfig, (send) => [send.returnId]).map(
			serializeSend,
		),
		mixer: {
			volume: track.mixer.volume,
			pan: track.mixer.pan,
			muted: track.mixer.muted,
			soloed: track.mixer.soloed,
		},
	};
}

function serializeInstrument(instrument: Instrument): JsonObject {
	switch (instrument.kind) {
		case "sampler":
			return {
				kind: instrument.kind,
				assetId: instrument.assetId,
				parameters: serializeParameters(instrument.parameters),
			};
		case "synth":
			return {
				kind: instrument.kind,
				parameters: serializeParameters(instrument.parameters),
			};
		case "drumMachine":
			return {
				kind: instrument.kind,
				pads: instrument.pads.map(serializeDrumPad),
				parameters: serializeParameters(instrument.parameters),
			};
	}
}

function serializeDrumPad(pad: DrumPad): JsonObject {
	return {
		id: pad.id,
		name: pad.name,
		assetId: pad.assetId,
		chokeGroup: pad.chokeGroup,
		parameters: serializeParameters(pad.parameters),
		mixer: {
			volume: pad.mixer.volume,
			pan: pad.mixer.pan,
			muted: pad.mixer.muted,
			soloed: pad.mixer.soloed,
		},
	};
}

function serializeDevices(devices: readonly Device[]): JsonValue[] {
	return sortBy(devices, (device) => [device.order, device.id]).map(
		serializeDevice,
	);
}

function serializeDevice(device: Device): JsonObject {
	return {
		id: device.id,
		type: device.type,
		order: device.order,
		bypassed: device.bypassed,
		parameters: serializeParameters(device.parameters),
		preset: device.preset
			? {
					id: device.preset.id,
					name: device.preset.name,
					source: device.preset.source,
				}
			: null,
	};
}

function serializeSend(send: Send): JsonObject {
	return {
		returnId: send.returnId,
		level: send.level,
		preFader: send.preFader,
	};
}

function serializeReturnBus(bus: ReturnBus): JsonObject {
	return {
		id: bus.id,
		name: bus.name,
		order: bus.order,
		devices: serializeDevices(bus.devices),
		mixer: {
			volume: bus.mixer.volume,
			pan: bus.mixer.pan,
			muted: bus.mixer.muted,
		},
	};
}

function serializeSection(section: Section): JsonObject {
	return {
		id: section.id,
		name: section.name,
		color: section.color,
		startTicks: section.startTicks,
		durationTicks: section.durationTicks,
	};
}

function serializePlacement(placement: Placement): JsonObject {
	return {
		id: placement.id,
		clipId: placement.clipId,
		trackId: placement.trackId,
		startTicks: placement.startTicks,
		durationTicks: placement.durationTicks,
		clipOffsetTicks: placement.clipOffsetTicks,
		looped: placement.looped,
	};
}

function serializeAutomationLane(lane: AutomationLane): JsonObject {
	return {
		id: lane.id,
		target: serializeAutomationTarget(lane.target),
		interpolation: lane.interpolation,
		points: [...lane.points]
			.sort((a, b) => a.tick - b.tick)
			.map((point) => ({ tick: point.tick, value: point.value })),
	};
}

function serializeAutomationTarget(
	target: AutomationLane["target"],
): JsonObject {
	switch (target.scope) {
		case "track":
			return {
				scope: target.scope,
				trackId: target.trackId,
				parameterId: target.parameterId,
			};
		case "trackDevice":
			return {
				scope: target.scope,
				trackId: target.trackId,
				deviceId: target.deviceId,
				parameterId: target.parameterId,
			};
		case "send":
			return {
				scope: target.scope,
				trackId: target.trackId,
				returnId: target.returnId,
				parameterId: target.parameterId,
			};
		case "return":
			return {
				scope: target.scope,
				returnId: target.returnId,
				parameterId: target.parameterId,
			};
		case "master":
			return { scope: target.scope, parameterId: target.parameterId };
	}
}

function automationSortKey(lane: AutomationLane): string {
	const target = lane.target;
	switch (target.scope) {
		case "track":
			return `track:${target.trackId}:${target.parameterId}`;
		case "trackDevice":
			return `trackDevice:${target.trackId}:${target.deviceId}:${target.parameterId}`;
		case "send":
			return `send:${target.trackId}:${target.returnId}:${target.parameterId}`;
		case "return":
			return `return:${target.returnId}:${target.parameterId}`;
		case "master":
			return `master:${target.parameterId}`;
	}
}

function serializeAsset(asset: Asset): JsonObject {
	return {
		id: asset.id,
		packId: asset.packId,
		packVersion: asset.packVersion,
		kind: asset.kind,
		name: asset.name,
		storageRef: asset.storageRef,
		url: asset.url,
		durationSeconds: asset.durationSeconds,
		sampleRate: asset.sampleRate,
		channelCount: asset.channelCount,
		provenance: {
			source: asset.provenance.source,
			licence: asset.provenance.licence,
			attribution: asset.provenance.attribution,
		},
	};
}

function serializeParameters(
	parameters: Readonly<Record<string, number>>,
): JsonObject {
	const serialized: JsonObject = {};
	for (const key of Object.keys(parameters).sort(compareStrings)) {
		serialized[key] = parameters[key];
	}
	return serialized;
}

type SortKey = ReadonlyArray<string | number>;

function sortBy<T>(items: readonly T[], key: (item: T) => SortKey): T[] {
	return [...items].sort((a, b) => compareKeys(key(a), key(b)));
}

function compareKeys(a: SortKey, b: SortKey): number {
	for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
		const left = a[index];
		const right = b[index];
		if (left === right) {
			continue;
		}
		if (typeof left === "number" && typeof right === "number") {
			return left - right;
		}
		return compareStrings(String(left), String(right));
	}
	return 0;
}

function compareStrings(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}
