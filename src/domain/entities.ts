import { z } from "zod";
import {
	assetIdSchema,
	automationIdSchema,
	clipIdSchema,
	deviceIdSchema,
	eventIdSchema,
	packIdSchema,
	padIdSchema,
	placementIdSchema,
	projectIdSchema,
	returnIdSchema,
	revisionIdSchema,
	sectionIdSchema,
	trackIdSchema,
} from "./ids";
import {
	MASTER_VOLUME,
	NOTE_PROBABILITY,
	NOTE_VELOCITY,
	parameterValueSchema,
	RETURN_PAN,
	RETURN_VOLUME,
	SONG_TEMPO,
	TRACK_PAN,
	TRACK_SEND_LEVEL,
	TRACK_VOLUME,
} from "./parameters";
import { durationTickSchema, tickSchema } from "./time";

/**
 * Schema-v1 entity shapes (PRD section 9.4).
 *
 * These runtime schemas and the types inferred from them are the authoritative
 * domain contract. Every object is strict: an unknown key is malformed input,
 * not a forward-compatible extension. Cross-entity integrity (dangling and
 * cross-owner references, ordering, automation targets) is checked in
 * `parse.ts`, which is the only entry point that yields a `Project`.
 */

/** The first production schema version. Prototype documents are not v1. */
export const SCHEMA_VERSION = 1;

const nonEmptyString = z.string().min(1);
const displayName = z.string().min(1).max(120);
const colorSchema = z
	.string()
	.regex(/^#[0-9a-fA-F]{6}$/, "Expected a #rrggbb color");
const epochMillis = z.int().min(0);

/** Free-form device/instrument parameter values, authored in Alpha Milestone 1. */
const parameterValues = z.record(z.string().min(1), z.number());

export const assetKindSchema = z.enum(["sample", "loop", "recording"]);

/**
 * A pack version (LIB-05). `major.minor.patch`, and immutable content: changed
 * audio or changed metadata is republished as a *new* version rather than
 * edited in place, which is what lets a project pin one and be sure the audio
 * it reopens is the audio it was built with.
 *
 * Nothing orders or compares versions: a project resolves the exact version it
 * recorded, so a later version can never silently substitute itself.
 */
export const packVersionSchema = z
	.string()
	.regex(/^\d+\.\d+\.\d+$/, "Expected a major.minor.patch pack version")
	.brand<"packVersion">();
export type PackVersion = z.infer<typeof packVersionSchema>;

/** Parses a pack version string, throwing when it is not `major.minor.patch`. */
export function packVersion(value: string): PackVersion {
	return packVersionSchema.parse(value);
}

export const packKindSchema = z.enum(["factory", "user", "third-party"]);
export type PackKind = z.infer<typeof packKindSchema>;

/**
 * One pack's rights position — a single answer, per pack, to "what may we do
 * with these bytes?" (PRD LIB-05, sample-library section 5.1). It covers every
 * asset in the pack, which is what makes a takedown, an export policy, or a
 * licence question answerable at pack level instead of per file. An asset whose
 * terms differ belongs in a different pack.
 */
export const packRightsSchema = z.strictObject({
	/** Licence identifier the whole pack ships under, e.g. `CC0-1.0`. */
	licence: nonEmptyString,
	/** Whether the individual raw files may be redistributed, not just mixes. */
	rawRedistribution: z.boolean(),
	attributionRequired: z.boolean(),
});
export type PackRights = z.infer<typeof packRightsSchema>;

/**
 * A named, versioned, independently deliverable collection of content
 * (PRD section 9.4, LIB-05).
 *
 * A pack is a *library* entity, not project state: a project never embeds pack
 * records, it records which packs and versions it depends on (see
 * `packDependencySchema`) and resolves the records from the library. The alpha
 * ships bundled factory packs only — nothing here models installation,
 * entitlement, or purchase.
 */
export const packSchema = z.strictObject({
	id: packIdSchema,
	name: displayName,
	version: packVersionSchema,
	publisher: displayName,
	kind: packKindSchema,
	description: z.string().max(2_000),
	rights: packRightsSchema,
});
export type Pack = z.infer<typeof packSchema>;

/**
 * One entry of a project's pack dependency list: a pack, and the version of it
 * the project's assets resolved from. Deliberately just the two fields — the
 * list has to be *derivable* from project state, and a display name or rights
 * position could not be derived from an asset reference.
 */
export const packDependencySchema = z.strictObject({
	packId: packIdSchema,
	version: packVersionSchema,
});
export type PackDependency = z.infer<typeof packDependencySchema>;

/**
 * Asset identity is the ID *together with the pack it came from* (invariant 12):
 * two packs may hold a sound of the same name or role without collision, and
 * neither is renamed to avoid the other. The storage reference is never
 * identity (invariant 8).
 */
export const assetSchema = z.strictObject({
	id: assetIdSchema,
	/** The pack that owns this asset. Exactly one, and never absent. */
	packId: packIdSchema,
	/** The pack version this reference resolved from. */
	packVersion: packVersionSchema,
	kind: assetKindSchema,
	name: displayName,
	storageRef: nonEmptyString,
	url: z.string().nullable(),
	durationSeconds: z.number().min(0).nullable(),
	sampleRate: z.int().min(1).nullable(),
	channelCount: z.int().min(1).max(2).nullable(),
	provenance: z.strictObject({
		source: nonEmptyString,
		licence: nonEmptyString,
		attribution: z.string().nullable(),
	}),
});
export type Asset = z.infer<typeof assetSchema>;

export const devicePresetSchema = z.strictObject({
	id: nonEmptyString,
	name: displayName,
	source: nonEmptyString,
});

/**
 * A processor in an ordered insert chain. Typed processors and their parameter
 * definitions arrive with Alpha Milestone 1 devices; v1 stores finite numeric values and
 * validates them against a parameter definition once one is registered.
 */
export const deviceSchema = z.strictObject({
	id: deviceIdSchema,
	type: nonEmptyString,
	order: z.int().min(0),
	bypassed: z.boolean(),
	parameters: parameterValues,
	preset: devicePresetSchema.nullable(),
});
export type Device = z.infer<typeof deviceSchema>;

export const padMixerSchema = z.strictObject({
	volume: parameterValueSchema(TRACK_VOLUME),
	pan: parameterValueSchema(TRACK_PAN),
	muted: z.boolean(),
	soloed: z.boolean(),
});

export const drumPadSchema = z.strictObject({
	id: padIdSchema,
	name: displayName,
	assetId: assetIdSchema.nullable(),
	chokeGroup: z.int().min(0).max(15).nullable(),
	parameters: parameterValues,
	mixer: padMixerSchema,
});
export type DrumPad = z.infer<typeof drumPadSchema>;

export const instrumentSchema = z.discriminatedUnion("kind", [
	z.strictObject({
		kind: z.literal("sampler"),
		assetId: assetIdSchema.nullable(),
		parameters: parameterValues,
	}),
	z.strictObject({
		kind: z.literal("synth"),
		parameters: parameterValues,
	}),
	z.strictObject({
		kind: z.literal("drumMachine"),
		pads: z.array(drumPadSchema),
		parameters: parameterValues,
	}),
]);
export type Instrument = z.infer<typeof instrumentSchema>;

export const sendSchema = z.strictObject({
	returnId: returnIdSchema,
	level: parameterValueSchema(TRACK_SEND_LEVEL),
	preFader: z.boolean(),
});
export type Send = z.infer<typeof sendSchema>;

export const trackMixerSchema = z.strictObject({
	volume: parameterValueSchema(TRACK_VOLUME),
	pan: parameterValueSchema(TRACK_PAN),
	muted: z.boolean(),
	soloed: z.boolean(),
});
export type TrackMixer = z.infer<typeof trackMixerSchema>;

export const trackTypeSchema = z.enum(["instrument", "audio"]);

export const trackSchema = z.strictObject({
	id: trackIdSchema,
	name: displayName,
	color: colorSchema,
	order: z.int().min(0),
	type: trackTypeSchema,
	instrument: instrumentSchema.nullable(),
	devices: z.array(deviceSchema),
	sendConfig: z.array(sendSchema),
	mixer: trackMixerSchema,
});
export type Track = z.infer<typeof trackSchema>;

export const returnBusSchema = z.strictObject({
	id: returnIdSchema,
	name: displayName,
	order: z.int().min(0),
	devices: z.array(deviceSchema),
	mixer: z.strictObject({
		volume: parameterValueSchema(RETURN_VOLUME),
		pan: parameterValueSchema(RETURN_PAN),
		muted: z.boolean(),
	}),
});
export type ReturnBus = z.infer<typeof returnBusSchema>;

export const masterSettingsSchema = z.strictObject({
	volume: parameterValueSchema(MASTER_VOLUME),
	devices: z.array(deviceSchema),
});
export type MasterSettings = z.infer<typeof masterSettingsSchema>;

export const sectionSchema = z.strictObject({
	id: sectionIdSchema,
	name: displayName,
	color: colorSchema,
	startTicks: tickSchema,
	durationTicks: durationTickSchema,
});
export type Section = z.infer<typeof sectionSchema>;

/** Arrangement placement of a clip. Clip content stays separate (invariant 3). */
export const placementSchema = z.strictObject({
	id: placementIdSchema,
	clipId: clipIdSchema,
	trackId: trackIdSchema,
	startTicks: tickSchema,
	durationTicks: durationTickSchema,
	clipOffsetTicks: tickSchema,
	looped: z.boolean(),
});
export type Placement = z.infer<typeof placementSchema>;

export const automationInterpolationSchema = z.enum(["linear", "step"]);

/**
 * `track` targets a parameter the track itself owns (mixer volume, pan, ...);
 * `trackDevice` targets a parameter on one device in that track's chain, so
 * it also needs `deviceId` to say which device.
 */
export const automationTargetSchema = z.discriminatedUnion("scope", [
	z.strictObject({
		scope: z.literal("track"),
		trackId: trackIdSchema,
		parameterId: nonEmptyString,
	}),
	z.strictObject({
		scope: z.literal("trackDevice"),
		trackId: trackIdSchema,
		deviceId: deviceIdSchema,
		parameterId: nonEmptyString,
	}),
	z.strictObject({
		scope: z.literal("send"),
		trackId: trackIdSchema,
		returnId: returnIdSchema,
		parameterId: nonEmptyString,
	}),
	z.strictObject({
		scope: z.literal("return"),
		returnId: returnIdSchema,
		parameterId: nonEmptyString,
	}),
	z.strictObject({
		scope: z.literal("master"),
		parameterId: nonEmptyString,
	}),
]);
export type AutomationTarget = z.infer<typeof automationTargetSchema>;

export const automationPointSchema = z.strictObject({
	tick: tickSchema,
	value: z.number(),
});
export type AutomationPoint = z.infer<typeof automationPointSchema>;

export const automationLaneSchema = z.strictObject({
	id: automationIdSchema,
	target: automationTargetSchema,
	interpolation: automationInterpolationSchema,
	points: z.array(automationPointSchema),
});
export type AutomationLane = z.infer<typeof automationLaneSchema>;

/** A note triggers either a pitch or a drum pad on the owning track. */
export const noteTriggerSchema = z.discriminatedUnion("kind", [
	z.strictObject({ kind: z.literal("pitch"), pitch: z.int().min(0).max(127) }),
	z.strictObject({ kind: z.literal("pad"), padId: padIdSchema }),
]);
export type NoteTrigger = z.infer<typeof noteTriggerSchema>;

export const noteEventSchema = z.strictObject({
	id: eventIdSchema,
	trigger: noteTriggerSchema,
	startTicks: tickSchema,
	durationTicks: durationTickSchema,
	velocity: parameterValueSchema(NOTE_VELOCITY),
	probability: parameterValueSchema(NOTE_PROBABILITY).nullable(),
});
export type NoteEvent = z.infer<typeof noteEventSchema>;

export const clipContentSchema = z.discriminatedUnion("kind", [
	z.strictObject({
		kind: z.literal("notes"),
		events: z.array(noteEventSchema),
	}),
	z.strictObject({
		kind: z.literal("audioLoop"),
		assetId: assetIdSchema,
		sourceTempo: parameterValueSchema(SONG_TEMPO),
		startOffsetTicks: tickSchema,
	}),
]);
export type ClipContent = z.infer<typeof clipContentSchema>;

export const clipSchema = z.strictObject({
	id: clipIdSchema,
	trackId: trackIdSchema,
	name: displayName,
	color: colorSchema,
	lengthTicks: durationTickSchema,
	content: clipContentSchema,
});
export type Clip = z.infer<typeof clipSchema>;

/** The alpha time signature is fixed at 4/4; the field exists for migration. */
export const timeSignatureSchema = z.strictObject({
	numerator: z.literal(4),
	denominator: z.literal(4),
});
export type TimeSignature = z.infer<typeof timeSignatureSchema>;

export const songSchema = z.strictObject({
	tempo: parameterValueSchema(SONG_TEMPO),
	timeSignature: timeSignatureSchema,
	tracks: z.array(trackSchema),
	returns: z.array(returnBusSchema),
	master: masterSettingsSchema,
	sections: z.array(sectionSchema),
	placements: z.array(placementSchema),
	automation: z.array(automationLaneSchema),
	assets: z.array(assetSchema),
});
export type Song = z.infer<typeof songSchema>;

export const projectMetadataSchema = z.strictObject({
	id: projectIdSchema,
	schemaVersion: z.literal(SCHEMA_VERSION),
	revision: z.int().min(0),
	name: displayName,
	ownerId: nonEmptyString,
	collaboratorIds: z.array(nonEmptyString),
	createdAt: epochMillis,
	modifiedAt: epochMillis,
	template: z.string().nullable(),
	genre: z.string().nullable(),
	/**
	 * The packs and pack versions this project depends on (PRD 9.9, LIB-05).
	 *
	 * It lives on the metadata tier so the dashboard, export, and a missing-pack
	 * warning can answer "what does this project need?" without loading song
	 * state or clip content. It is *derived* from `song.assets` rather than
	 * maintained by hand — `derivePackDependencies` computes it and
	 * `checkProjectIntegrity` rejects a project whose list has drifted — and it
	 * carries at most one version per pack.
	 */
	packDependencies: z.array(packDependencySchema),
});
export type ProjectMetadata = z.infer<typeof projectMetadataSchema>;

/** A named checkpoint (PRJ-05). v1 stores the shape; restore ships later. */
export const revisionSchema = z.strictObject({
	id: revisionIdSchema,
	projectId: projectIdSchema,
	revision: z.int().min(0),
	authorId: nonEmptyString,
	createdAt: epochMillis,
	name: z.string().nullable(),
});
export type Revision = z.infer<typeof revisionSchema>;

/**
 * The whole project aggregate. Its three parts map one-to-one onto the PRD
 * section 9.9 Firestore tiers: metadata, song, and clips.
 */
export const projectSchema = z.strictObject({
	metadata: projectMetadataSchema,
	song: songSchema,
	clips: z.array(clipSchema),
});
export type Project = z.infer<typeof projectSchema>;
