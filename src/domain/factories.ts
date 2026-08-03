import {
	type Asset,
	type Clip,
	type Device,
	type DrumPad,
	type Instrument,
	type NoteEvent,
	type Pack,
	type PackDependency,
	type PackKind,
	type PackRights,
	type PackVersion,
	type Placement,
	type Project,
	type ProjectMetadata,
	packVersion,
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

/**
 * Track colors from the editor palette, cycled by track order. Spans the hue
 * wheel once at a mid tone, once lighter, then a handful more at a darker
 * tone, so tracks stay visually distinct well past a typical track count.
 */
export const TRACK_COLORS = [
	"#ef4444",
	"#f97316",
	"#f59e0b",
	"#eab308",
	"#84cc16",
	"#22c55e",
	"#10b981",
	"#14b8a6",
	"#06b6d4",
	"#0ea5e9",
	"#3b82f6",
	"#6366f1",
	"#8b5cf6",
	"#a855f7",
	"#d946ef",
	"#ec4899",
	"#f43f5e",
	"#f87171",
	"#fb923c",
	"#fbbf24",
	"#facc15",
	"#a3e635",
	"#4ade80",
	"#34d399",
	"#2dd4bf",
	"#22d3ee",
	"#38bdf8",
	"#60a5fa",
	"#818cf8",
	"#a78bfa",
	"#c084fc",
	"#e879f9",
	"#f472b6",
	"#fb7185",
	"#dc2626",
	"#ca8a04",
	"#059669",
	"#0284c7",
	"#9333ea",
	"#e11d48",
] as const;

export type Clock = () => number;

export interface DomainFactoryContext {
	readonly ids: IdFactory;
	readonly now: Clock;
}

function resolveClock(now: number | Clock | undefined): Clock {
	if (typeof now === "function") return now;
	if (typeof now === "number") return () => now;
	return () => Date.now();
}

export function createFactoryContext(
	options: { ids?: IdFactory; now?: number | Clock } = {},
): DomainFactoryContext {
	return {
		ids: options.ids ?? createIdFactory(),
		now: resolveClock(options.now),
	};
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
	sendConfig?: Track["sendConfig"];
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
		sendConfig: options.sendConfig ?? [],
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

export function createSynthInstrument(): Instrument {
	return { kind: "synth", parameters: {} };
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

export function createDrumMachineInstrument(
	pads: readonly DrumPad[] = [],
): Instrument {
	return { kind: "drumMachine", pads: [...pads], parameters: {} };
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
): Track["sendConfig"][number] {
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

export interface CreateAudioLoopClipOptions {
	trackId: TrackId;
	assetId: AssetId;
	name: string;
	lengthTicks?: number;
	color?: string;
	sourceTempo?: number;
	startOffsetTicks?: number;
}

export function createAudioLoopClip(
	context: DomainFactoryContext,
	options: CreateAudioLoopClipOptions,
): Clip {
	return {
		id: context.ids("clip"),
		trackId: options.trackId,
		name: options.name,
		color: options.color ?? TRACK_COLORS[0],
		lengthTicks: toTicks(options.lengthTicks ?? TICKS_PER_BAR),
		content: {
			kind: "audioLoop",
			assetId: options.assetId,
			sourceTempo: clampParameterValue(
				SONG_TEMPO,
				options.sourceTempo ?? SONG_TEMPO.defaultValue,
			),
			startOffsetTicks: toTicks(options.startOffsetTicks ?? 0),
		},
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

/**
 * Rights position of a bundled factory pack: content Solid Groove owns
 * outright, so raw redistribution is unrestricted and no attribution is owed
 * (see `docs/licenses/starter-library-v1.md`).
 */
export const FACTORY_PACK_RIGHTS: PackRights = {
	licence: "solid-groove-owned",
	rawRedistribution: true,
	attributionRequired: false,
};

/** The first published version of any pack this repository builds. */
export const INITIAL_PACK_VERSION: PackVersion = packVersion("1.0.0");

export interface CreatePackOptions {
	name: string;
	version?: string;
	publisher?: string;
	kind?: PackKind;
	description?: string;
	rights?: PackRights;
}

/**
 * A pack record. Packs describe library content rather than project state — a
 * project stores only the dependency list `derivePackDependencies` computes —
 * so this is what a catalogue, a fixture, or an availability check builds.
 */
export function createPack(
	context: DomainFactoryContext,
	options: CreatePackOptions,
): Pack {
	return {
		id: context.ids("pack"),
		name: options.name,
		version:
			options.version === undefined
				? INITIAL_PACK_VERSION
				: packVersion(options.version),
		publisher: options.publisher ?? "Solid Groove",
		kind: options.kind ?? "factory",
		description: options.description ?? "",
		rights: options.rights ?? FACTORY_PACK_RIGHTS,
	};
}

/** The dependency entry that resolving an asset from `pack` produces. */
export function packDependencyOf(pack: Pack): PackDependency {
	return { packId: pack.id, version: pack.version };
}

export interface CreateAssetOptions {
	/**
	 * The pack this asset resolves from. Required: an asset with no pack is not
	 * representable (invariant 12), so a factory that defaulted it would be a way
	 * to create one by accident.
	 */
	pack: Pack;
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
		packId: options.pack.id,
		packVersion: options.pack.version,
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
	/**
	 * The project's pack dependencies. Pass `derivePackDependencies(song)` — the
	 * list is derived from the song's assets, and `assertProject` rejects one that
	 * does not match.
	 */
	packDependencies?: readonly PackDependency[];
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
		packDependencies: [...(options.packDependencies ?? [])],
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
