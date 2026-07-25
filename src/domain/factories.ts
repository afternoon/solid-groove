import {
	type Asset,
	type Clip,
	type Device,
	type DrumPad,
	type Instrument,
	type NoteEvent,
	type Placement,
	type Project,
	type ProjectMetadata,
	type ReturnBus,
	SCHEMA_VERSION,
	type Section,
	type Song,
	type Track,
} from "./entities";
import {
	type AssetId,
	type ClipId,
	createIdFactory,
	type IdFactory,
	type PadId,
	type ReturnId,
	type TrackId,
} from "./ids";
import {
	clampParameterValue,
	MASTER_VOLUME,
	NOTE_VELOCITY,
	RETURN_PAN,
	RETURN_VOLUME,
	SONG_TEMPO,
	TRACK_PAN,
	TRACK_SEND_LEVEL,
	TRACK_VOLUME,
} from "./parameters";
import { assertProject } from "./parse";
import { TICKS_PER_BAR, type Ticks, toTicks } from "./time";

/**
 * Domain factories.
 *
 * Factories build valid schema-v1 state from plain arguments. They never touch
 * Firebase, Tone, or Solid: an ID factory and a clock are injected so fixtures
 * and tests are deterministic. Every project-level factory returns state that
 * has passed `assertProject`, so an invalid project cannot escape a factory.
 */

/** Track colors from the editor palette, cycled by track order. */
export const TRACK_COLORS = [
	"#e0573e",
	"#e8a33d",
	"#4fa86b",
	"#3d7fe8",
	"#8a5ce0",
	"#d84f9c",
] as const;

export type Clock = () => number;

export interface DomainFactoryContext {
	readonly ids: IdFactory;
	readonly now: Clock;
}

export function createFactoryContext(
	options: { ids?: IdFactory; now?: number | Clock } = {},
): DomainFactoryContext {
	const now =
		typeof options.now === "function"
			? options.now
			: () => (typeof options.now === "number" ? options.now : Date.now());
	return { ids: options.ids ?? createIdFactory(), now };
}

export function trackColor(order: number): string {
	return TRACK_COLORS[order % TRACK_COLORS.length];
}

export interface CreateTrackOptions {
	name: string;
	order: number;
	type?: Track["type"];
	instrument?: Instrument | null;
	color?: string;
	devices?: Device[];
	sends?: Track["sends"];
	volume?: number;
	pan?: number;
	muted?: boolean;
	soloed?: boolean;
}

export function createTrack(
	context: DomainFactoryContext,
	options: CreateTrackOptions,
): Track {
	return {
		id: context.ids("track"),
		name: options.name,
		color: options.color ?? trackColor(options.order),
		order: options.order,
		type: options.type ?? "instrument",
		instrument: options.instrument ?? null,
		devices: options.devices ?? [],
		sends: options.sends ?? [],
		mixer: {
			volume: clampParameterValue(
				TRACK_VOLUME,
				options.volume ?? TRACK_VOLUME.defaultValue,
			),
			pan: clampParameterValue(
				TRACK_PAN,
				options.pan ?? TRACK_PAN.defaultValue,
			),
			muted: options.muted ?? false,
			soloed: options.soloed ?? false,
		},
	};
}

export function createSamplerInstrument(
	assetId: AssetId | null = null,
): Instrument {
	return { kind: "sampler", assetId, parameters: {} };
}

export function createDrumPad(
	context: DomainFactoryContext,
	options: {
		name: string;
		assetId?: AssetId | null;
		chokeGroup?: number | null;
	},
): DrumPad {
	return {
		id: context.ids("pad"),
		name: options.name,
		assetId: options.assetId ?? null,
		chokeGroup: options.chokeGroup ?? null,
		parameters: {},
		mixer: {
			volume: TRACK_VOLUME.defaultValue,
			pan: TRACK_PAN.defaultValue,
			muted: false,
		},
	};
}

export function createReturnBus(
	context: DomainFactoryContext,
	options: { name: string; order: number },
): ReturnBus {
	return {
		id: context.ids("return"),
		name: options.name,
		order: options.order,
		devices: [],
		mixer: {
			volume: RETURN_VOLUME.defaultValue,
			pan: RETURN_PAN.defaultValue,
			muted: false,
		},
	};
}

export function createSend(
	returnId: ReturnId,
	level: number = TRACK_SEND_LEVEL.defaultValue,
	preFader = false,
): Track["sends"][number] {
	return {
		returnId,
		level: clampParameterValue(TRACK_SEND_LEVEL, level),
		preFader,
	};
}

export interface CreateNoteEventOptions {
	startTicks: number;
	durationTicks: number;
	pitch?: number;
	padId?: PadId;
	velocity?: number;
	probability?: number | null;
}

export function createNoteEvent(
	context: DomainFactoryContext,
	options: CreateNoteEventOptions,
): NoteEvent {
	return {
		id: context.ids("event"),
		trigger:
			options.padId !== undefined
				? { kind: "pad", padId: options.padId }
				: { kind: "pitch", pitch: options.pitch ?? 60 },
		startTicks: toTicks(options.startTicks),
		durationTicks: toTicks(options.durationTicks),
		velocity: clampParameterValue(
			NOTE_VELOCITY,
			options.velocity ?? NOTE_VELOCITY.defaultValue,
		),
		probability: options.probability ?? null,
	};
}

export interface CreateNoteClipOptions {
	trackId: TrackId;
	name: string;
	lengthTicks?: number;
	color?: string;
	events?: NoteEvent[];
}

export function createNoteClip(
	context: DomainFactoryContext,
	options: CreateNoteClipOptions,
): Clip {
	return {
		id: context.ids("clip"),
		trackId: options.trackId,
		name: options.name,
		color: options.color ?? TRACK_COLORS[0],
		lengthTicks: toTicks(options.lengthTicks ?? TICKS_PER_BAR),
		content: { kind: "notes", events: options.events ?? [] },
	};
}

export interface CreatePlacementOptions {
	clipId: ClipId;
	trackId: TrackId;
	startTicks: number;
	durationTicks: number;
	clipOffsetTicks?: number;
	looped?: boolean;
}

export function createPlacement(
	context: DomainFactoryContext,
	options: CreatePlacementOptions,
): Placement {
	return {
		id: context.ids("placement"),
		clipId: options.clipId,
		trackId: options.trackId,
		startTicks: toTicks(options.startTicks),
		durationTicks: toTicks(options.durationTicks),
		clipOffsetTicks: toTicks(options.clipOffsetTicks ?? 0),
		looped: options.looped ?? false,
	};
}

export interface CreateSectionOptions {
	name: string;
	startTicks: number;
	durationTicks: number;
	color?: string;
}

export function createSection(
	context: DomainFactoryContext,
	options: CreateSectionOptions,
): Section {
	return {
		id: context.ids("section"),
		name: options.name,
		color: options.color ?? TRACK_COLORS[3],
		startTicks: toTicks(options.startTicks),
		durationTicks: toTicks(options.durationTicks),
	};
}

export interface CreateAssetOptions {
	name: string;
	storageRef: string;
	kind?: Asset["kind"];
	url?: string | null;
	durationSeconds?: number | null;
	sampleRate?: number | null;
	channelCount?: number | null;
	source?: string;
	licence?: string;
	attribution?: string | null;
}

export function createAsset(
	context: DomainFactoryContext,
	options: CreateAssetOptions,
): Asset {
	return {
		id: context.ids("asset"),
		kind: options.kind ?? "sample",
		name: options.name,
		storageRef: options.storageRef,
		url: options.url ?? null,
		durationSeconds: options.durationSeconds ?? null,
		sampleRate: options.sampleRate ?? null,
		channelCount: options.channelCount ?? null,
		provenance: {
			source: options.source ?? "solid-groove",
			licence: options.licence ?? "internal",
			attribution: options.attribution ?? null,
		},
	};
}

export function createEmptySong(tempo: number = SONG_TEMPO.defaultValue): Song {
	return {
		tempo: clampParameterValue(SONG_TEMPO, tempo),
		timeSignature: { numerator: 4, denominator: 4 },
		tracks: [],
		returns: [],
		master: { volume: MASTER_VOLUME.defaultValue, devices: [] },
		sections: [],
		placements: [],
		automation: [],
		assets: [],
	};
}

export interface CreateProjectMetadataOptions {
	ownerId: string;
	name?: string;
	collaboratorIds?: string[];
	template?: string | null;
	genre?: string | null;
	revision?: number;
}

export function createProjectMetadata(
	context: DomainFactoryContext,
	options: CreateProjectMetadataOptions,
): ProjectMetadata {
	const timestamp = context.now();
	return {
		id: context.ids("project"),
		schemaVersion: SCHEMA_VERSION,
		revision: options.revision ?? 0,
		name: options.name ?? "Untitled Project",
		ownerId: options.ownerId,
		collaboratorIds: options.collaboratorIds ?? [],
		createdAt: timestamp,
		modifiedAt: timestamp,
		template: options.template ?? null,
		genre: options.genre ?? null,
	};
}

export interface CreateProjectOptions extends CreateProjectMetadataOptions {
	ids?: IdFactory;
	now?: number | Clock;
	tempo?: number;
}

/** A valid, empty schema-v1 project. Each call returns independent state. */
export function createBlankProject(options: CreateProjectOptions): Project {
	const context = createFactoryContext(options);
	return assertProject({
		metadata: createProjectMetadata(context, options),
		song: createEmptySong(options.tempo),
		clips: [],
	});
}

/** Bar length helper for factories and fixtures. */
export function bars(count: number): Ticks {
	return toTicks(count * TICKS_PER_BAR);
}
