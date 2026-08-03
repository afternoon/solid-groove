import { z } from "zod";
import {
	type Clip,
	type DrumPad,
	drumPadSchema,
	type Instrument,
	type NoteEvent,
	noteEventSchema,
	type Project,
	type Track,
} from "../../domain/entities";
import {
	assetIdSchema,
	type ClipId,
	clipIdSchema,
	type PadId,
	padIdSchema,
	trackIdSchema,
} from "../../domain/ids";
import {
	coerceParameterValue,
	getParameterDefinition,
	PAD_ATTACK,
	PAD_DECAY,
	PAD_PITCH,
	type ParameterDefinition,
	TRACK_PAN,
	TRACK_VOLUME,
} from "../../domain/parameters";
import {
	findTrack,
	noteEventsOf,
	replaceClip,
	replaceTrack,
	trackLabel,
	withNoteEvents,
} from "../projectEdits";
import {
	applied,
	type CommandInput,
	defineCommand,
	eraseCommand,
	type RegisteredCommand,
	rejected,
} from "../types";

/**
 * Drum-machine pad commands (PRD INS-01, LOOP-005).
 *
 * Every pad edit — replacing its sample, muting/soloing it, choosing its choke
 * group, adding or removing a pad, and tweaking its pitch, level, pan, or amp
 * envelope — is a registered command with a generated inverse, so undo,
 * redo, save/reload, and (once `AI-001` lands) the assistant all round-trip
 * through the same tested boundary. Pads are addressed by their stable `pad_`
 * ID, never by array position, so a reorder or duplication never repoints an
 * edit at the wrong pad.
 */

/** The 16-pad ceiling (PRD INS-01: "at least 16 pads"). */
export const MAX_DRUM_PADS = 32;

/** Every per-pad numeric parameter a `drum.setPadParameter` command may target. */
const PAD_PARAMETER_IDS = [
	TRACK_VOLUME.id,
	TRACK_PAN.id,
	PAD_PITCH.id,
	PAD_ATTACK.id,
	PAD_DECAY.id,
] as const;

function findPad(pads: readonly DrumPad[], padId: PadId): DrumPad | undefined {
	return pads.find((pad) => pad.id === padId);
}

/** Rewrites one pad in place, preserving pad order and every other pad's identity. */
function replacePad(
	project: Project,
	track: Track,
	instrument: Extract<Instrument, { kind: "drumMachine" }>,
	next: DrumPad,
): Project {
	return replaceTrack(project, {
		...track,
		instrument: {
			...instrument,
			pads: instrument.pads.map((pad) => (pad.id === next.id ? next : pad)),
		},
	});
}

// --- drum.setPadAsset ------------------------------------------------------

export const drumSetPadAssetPayloadSchema = z.strictObject({
	trackId: trackIdSchema,
	padId: padIdSchema,
	assetId: assetIdSchema.nullable(),
});
export type DrumSetPadAssetPayload = z.infer<
	typeof drumSetPadAssetPayloadSchema
>;

export const drumSetPadAssetCommand = defineCommand<DrumSetPadAssetPayload>({
	type: "drum.setPadAsset",
	version: 1,
	schema: drumSetPadAssetPayloadSchema,
	summarize(payload, project) {
		const label = trackLabel(project, payload.trackId);
		return payload.assetId
			? `Load a sample onto a pad of track ${label}`
			: `Clear a pad of track ${label}`;
	},
	apply(project, payload) {
		const track = findTrack(project, payload.trackId);
		if (track?.instrument?.kind !== "drumMachine") {
			return rejected(`Track ${payload.trackId} is not a drum machine`);
		}
		const pad = findPad(track.instrument.pads, payload.padId);
		if (!pad) {
			return rejected(`Pad ${payload.padId} does not exist`);
		}
		return applied(
			replacePad(project, track, track.instrument, {
				...pad,
				assetId: payload.assetId,
			}),
		);
	},
	invert(payload, before) {
		const track = findTrack(before, payload.trackId);
		if (track?.instrument?.kind !== "drumMachine") return [];
		const pad = findPad(track.instrument.pads, payload.padId);
		return pad
			? [setPadAsset(payload.trackId, payload.padId, pad.assetId)]
			: [];
	},
});

// --- drum.setPadFlag -------------------------------------------------------

export const padFlagSchema = z.enum(["muted", "soloed"]);
export type PadFlag = z.infer<typeof padFlagSchema>;

export const drumSetPadFlagPayloadSchema = z.strictObject({
	trackId: trackIdSchema,
	padId: padIdSchema,
	flag: padFlagSchema,
	value: z.boolean(),
});
export type DrumSetPadFlagPayload = z.infer<typeof drumSetPadFlagPayloadSchema>;

export const drumSetPadFlagCommand = defineCommand<DrumSetPadFlagPayload>({
	type: "drum.setPadFlag",
	version: 1,
	schema: drumSetPadFlagPayloadSchema,
	summarize: (payload, project) =>
		`${payload.value ? "Enable" : "Disable"} pad ${
			payload.flag === "muted" ? "mute" : "solo"
		} on track ${trackLabel(project, payload.trackId)}`,
	apply(project, payload) {
		const track = findTrack(project, payload.trackId);
		if (track?.instrument?.kind !== "drumMachine") {
			return rejected(`Track ${payload.trackId} is not a drum machine`);
		}
		const pad = findPad(track.instrument.pads, payload.padId);
		if (!pad) {
			return rejected(`Pad ${payload.padId} does not exist`);
		}
		return applied(
			replacePad(project, track, track.instrument, {
				...pad,
				mixer: { ...pad.mixer, [payload.flag]: payload.value },
			}),
		);
	},
	invert(payload, before) {
		const track = findTrack(before, payload.trackId);
		if (track?.instrument?.kind !== "drumMachine") return [];
		const pad = findPad(track.instrument.pads, payload.padId);
		return pad
			? [
					setPadFlag(
						payload.trackId,
						payload.padId,
						payload.flag,
						pad.mixer[payload.flag],
					),
				]
			: [];
	},
});

// --- drum.setPadChoke ------------------------------------------------------

export const drumSetPadChokePayloadSchema = z.strictObject({
	trackId: trackIdSchema,
	padId: padIdSchema,
	chokeGroup: z.int().min(0).max(15).nullable(),
});
export type DrumSetPadChokePayload = z.infer<
	typeof drumSetPadChokePayloadSchema
>;

export const drumSetPadChokeCommand = defineCommand<DrumSetPadChokePayload>({
	type: "drum.setPadChoke",
	version: 1,
	schema: drumSetPadChokePayloadSchema,
	summarize: (payload, project) =>
		payload.chokeGroup === null
			? `Remove choke group from a pad of track ${trackLabel(project, payload.trackId)}`
			: `Set a pad of track ${trackLabel(project, payload.trackId)} to choke group ${payload.chokeGroup + 1}`,
	apply(project, payload) {
		const track = findTrack(project, payload.trackId);
		if (track?.instrument?.kind !== "drumMachine") {
			return rejected(`Track ${payload.trackId} is not a drum machine`);
		}
		const pad = findPad(track.instrument.pads, payload.padId);
		if (!pad) {
			return rejected(`Pad ${payload.padId} does not exist`);
		}
		return applied(
			replacePad(project, track, track.instrument, {
				...pad,
				chokeGroup: payload.chokeGroup,
			}),
		);
	},
	invert(payload, before) {
		const track = findTrack(before, payload.trackId);
		if (track?.instrument?.kind !== "drumMachine") return [];
		const pad = findPad(track.instrument.pads, payload.padId);
		return pad
			? [setPadChoke(payload.trackId, payload.padId, pad.chokeGroup)]
			: [];
	},
});

// --- drum.setPadParameter --------------------------------------------------

export const drumSetPadParameterPayloadSchema = z.strictObject({
	trackId: trackIdSchema,
	padId: padIdSchema,
	parameterId: z.enum(PAD_PARAMETER_IDS),
	value: z.number(),
});
export type DrumSetPadParameterPayload = z.infer<
	typeof drumSetPadParameterPayloadSchema
>;

/** The mixer-field name a pad-mixer parameter writes, or `null` for `parameters`. */
function padMixerField(parameterId: string): "volume" | "pan" | null {
	if (parameterId === TRACK_VOLUME.id) return "volume";
	if (parameterId === TRACK_PAN.id) return "pan";
	return null;
}

/** The short key a `pad.*` parameter stores under in the pad `parameters` record. */
function padParameterKey(parameterId: string): string {
	return parameterId.startsWith("pad.")
		? parameterId.slice("pad.".length)
		: parameterId;
}

function currentPadParameter(
	pad: DrumPad,
	definition: ParameterDefinition,
): number {
	const field = padMixerField(definition.id);
	if (field) return pad.mixer[field];
	return (
		pad.parameters[padParameterKey(definition.id)] ?? definition.defaultValue
	);
}

function writePadParameter(
	pad: DrumPad,
	definition: ParameterDefinition,
	value: number,
): DrumPad {
	const field = padMixerField(definition.id);
	if (field) {
		return { ...pad, mixer: { ...pad.mixer, [field]: value } };
	}
	const key = padParameterKey(definition.id);
	const parameters = { ...pad.parameters };
	// A value equal to the default is not stored: the record is a sparse
	// override set, so setting a pad back to its default (as undo does when the
	// pad had never set it) leaves no stray key and the state round-trips exactly.
	if (value === definition.defaultValue) {
		delete parameters[key];
	} else {
		parameters[key] = value;
	}
	return { ...pad, parameters };
}

export const drumSetPadParameterCommand =
	defineCommand<DrumSetPadParameterPayload>({
		type: "drum.setPadParameter",
		version: 1,
		schema: drumSetPadParameterPayloadSchema,
		summarize(payload, project) {
			const definition = getParameterDefinition(payload.parameterId);
			const label = definition?.label ?? payload.parameterId;
			return `Set ${label} on a pad of track ${trackLabel(project, payload.trackId)}`;
		},
		apply(project, payload) {
			const track = findTrack(project, payload.trackId);
			if (track?.instrument?.kind !== "drumMachine") {
				return rejected(`Track ${payload.trackId} is not a drum machine`);
			}
			const pad = findPad(track.instrument.pads, payload.padId);
			if (!pad) {
				return rejected(`Pad ${payload.padId} does not exist`);
			}
			const definition = getParameterDefinition(payload.parameterId);
			if (!definition) {
				return rejected(`Unknown pad parameter "${payload.parameterId}"`);
			}
			const coerced = coerceParameterValue(definition, payload.value);
			if (!coerced.ok) {
				return rejected(coerced.reason);
			}
			return applied(
				replacePad(
					project,
					track,
					track.instrument,
					writePadParameter(pad, definition, coerced.value),
				),
			);
		},
		invert(payload, before) {
			const track = findTrack(before, payload.trackId);
			if (track?.instrument?.kind !== "drumMachine") return [];
			const pad = findPad(track.instrument.pads, payload.padId);
			const definition = getParameterDefinition(payload.parameterId);
			if (!pad || !definition) return [];
			return [
				setPadParameter(
					payload.trackId,
					payload.padId,
					payload.parameterId,
					currentPadParameter(pad, definition),
				),
			];
		},
	});

// --- drum.addPad / drum.removePad ------------------------------------------

/** One clip's worth of hits that referenced a removed pad, so removing a pad
 * and restoring it are a single atomic, exactly-reversible operation. */
const restoredHitsSchema = z.strictObject({
	clipId: clipIdSchema,
	events: z.array(noteEventSchema),
});
export type RestoredHits = z.infer<typeof restoredHitsSchema>;

export const drumAddPadPayloadSchema = z.strictObject({
	trackId: trackIdSchema,
	/** Explicit ID and full body, so replay/redo reproduce the same pad. */
	pad: drumPadSchema,
	/** Where in the pad order to insert it (defaults to the end). */
	index: z.int().min(0).optional(),
	/**
	 * Hits to restore alongside the pad, keyed by clip. Empty for a plain add;
	 * populated when this command is the inverse of a pad removal, so undo brings
	 * the pad's pattern back exactly as it was.
	 */
	restoreHits: z.array(restoredHitsSchema).default([]),
});
export type DrumAddPadPayload = z.infer<typeof drumAddPadPayloadSchema>;

/** Re-inserts a set of note events into a clip, keeping every event in start order. */
function restoreClipHits(
	project: Project,
	clipId: ClipId,
	events: readonly NoteEvent[],
): Project {
	const clip = project.clips.find((candidate) => candidate.id === clipId);
	const existing = clip ? noteEventsOf(clip) : undefined;
	if (!clip || !existing) return project;
	const merged = [...existing, ...events].sort(
		(a, b) => a.startTicks - b.startTicks,
	);
	return replaceClip(project, withNoteEvents(clip, merged));
}

export const drumAddPadCommand = defineCommand<DrumAddPadPayload>({
	type: "drum.addPad",
	version: 1,
	schema: drumAddPadPayloadSchema,
	summarize: (payload, project) =>
		`Add pad "${payload.pad.name}" to track ${trackLabel(project, payload.trackId)}`,
	apply(project, payload) {
		const track = findTrack(project, payload.trackId);
		if (track?.instrument?.kind !== "drumMachine") {
			return rejected(`Track ${payload.trackId} is not a drum machine`);
		}
		if (findPad(track.instrument.pads, payload.pad.id)) {
			return rejected(`Pad ${payload.pad.id} already exists`);
		}
		if (track.instrument.pads.length >= MAX_DRUM_PADS) {
			return rejected(`A drum machine holds at most ${MAX_DRUM_PADS} pads`);
		}
		const at = payload.index ?? track.instrument.pads.length;
		if (at > track.instrument.pads.length) {
			return rejected(
				`Cannot insert a pad at position ${at} of ${track.instrument.pads.length}`,
			);
		}
		const pads = [
			...track.instrument.pads.slice(0, at),
			payload.pad,
			...track.instrument.pads.slice(at),
		];
		let next = replaceTrack(project, {
			...track,
			instrument: { ...track.instrument, pads },
		});
		for (const restore of payload.restoreHits) {
			next = restoreClipHits(next, restore.clipId, restore.events);
		}
		return applied(next);
	},
	invert: (payload) => [removePad(payload.trackId, payload.pad.id)],
});

export const drumRemovePadPayloadSchema = z.strictObject({
	trackId: trackIdSchema,
	padId: padIdSchema,
});
export type DrumRemovePadPayload = z.infer<typeof drumRemovePadPayloadSchema>;

/** Every hit in a track's clips that triggers `padId`, grouped by clip. */
function collectPadHits(
	project: Project,
	track: Track,
	padId: PadId,
): { hits: RestoredHits[]; clips: Clip[] } {
	const hits: RestoredHits[] = [];
	const clips: Clip[] = [];
	for (const clip of project.clips) {
		if (clip.trackId !== track.id) continue;
		const events = noteEventsOf(clip);
		if (!events) continue;
		const removed = events.filter(
			(event) => event.trigger.kind === "pad" && event.trigger.padId === padId,
		);
		if (removed.length === 0) continue;
		hits.push({ clipId: clip.id, events: removed });
		clips.push(
			withNoteEvents(
				clip,
				events.filter(
					(event) =>
						!(event.trigger.kind === "pad" && event.trigger.padId === padId),
				),
			),
		);
	}
	return { hits, clips };
}

export const drumRemovePadCommand = defineCommand<DrumRemovePadPayload>({
	type: "drum.removePad",
	version: 1,
	schema: drumRemovePadPayloadSchema,
	summarize: (payload, project) =>
		`Remove a pad from track ${trackLabel(project, payload.trackId)}`,
	apply(project, payload) {
		const track = findTrack(project, payload.trackId);
		if (track?.instrument?.kind !== "drumMachine") {
			return rejected(`Track ${payload.trackId} is not a drum machine`);
		}
		const pad = findPad(track.instrument.pads, payload.padId);
		if (!pad) {
			return rejected(`Pad ${payload.padId} does not exist`);
		}
		// A removed pad cannot leave its hits dangling (a domain invariant), so
		// removing it cascades to the hits that triggered it — exactly like
		// deleting a track cascades to its clips. The inverse restores both.
		const { clips } = collectPadHits(project, track, pad.id);
		let next = replaceTrack(project, {
			...track,
			instrument: {
				...track.instrument,
				pads: track.instrument.pads.filter((p) => p.id !== pad.id),
			},
		});
		for (const clip of clips) {
			next = replaceClip(next, clip);
		}
		return applied(next);
	},
	invert(payload, before) {
		const track = findTrack(before, payload.trackId);
		if (track?.instrument?.kind !== "drumMachine") return [];
		const index = track.instrument.pads.findIndex(
			(pad) => pad.id === payload.padId,
		);
		if (index < 0) return [];
		const { hits } = collectPadHits(before, track, payload.padId);
		return [addPad(payload.trackId, track.instrument.pads[index], index, hits)];
	},
});

// --- drum.reorderPad -------------------------------------------------------

export const drumReorderPadPayloadSchema = z.strictObject({
	trackId: trackIdSchema,
	padId: padIdSchema,
	toIndex: z.int().min(0),
});
export type DrumReorderPadPayload = z.infer<typeof drumReorderPadPayloadSchema>;

export const drumReorderPadCommand = defineCommand<DrumReorderPadPayload>({
	type: "drum.reorderPad",
	version: 1,
	schema: drumReorderPadPayloadSchema,
	summarize: (payload, project) =>
		`Reorder a pad of track ${trackLabel(project, payload.trackId)}`,
	apply(project, payload) {
		const track = findTrack(project, payload.trackId);
		if (track?.instrument?.kind !== "drumMachine") {
			return rejected(`Track ${payload.trackId} is not a drum machine`);
		}
		const from = track.instrument.pads.findIndex(
			(pad) => pad.id === payload.padId,
		);
		if (from < 0) {
			return rejected(`Pad ${payload.padId} does not exist`);
		}
		if (payload.toIndex >= track.instrument.pads.length) {
			return rejected(
				`Cannot move a pad to position ${payload.toIndex} of ${track.instrument.pads.length}`,
			);
		}
		const moved = track.instrument.pads[from];
		const without = track.instrument.pads.filter((_, i) => i !== from);
		const pads = [
			...without.slice(0, payload.toIndex),
			moved,
			...without.slice(payload.toIndex),
		];
		return applied(
			replaceTrack(project, {
				...track,
				instrument: { ...track.instrument, pads },
			}),
		);
	},
	invert(payload, before) {
		const track = findTrack(before, payload.trackId);
		if (track?.instrument?.kind !== "drumMachine") return [];
		const from = track.instrument.pads.findIndex(
			(pad) => pad.id === payload.padId,
		);
		return from < 0 ? [] : [reorderPad(payload.trackId, payload.padId, from)];
	},
});

// --- Typed builders --------------------------------------------------------

export function setPadAsset(
	trackId: z.infer<typeof trackIdSchema>,
	padId: PadId,
	assetId: DrumSetPadAssetPayload["assetId"],
): CommandInput<DrumSetPadAssetPayload> {
	return {
		type: drumSetPadAssetCommand.type,
		payload: { trackId, padId, assetId },
	};
}

export function setPadFlag(
	trackId: z.infer<typeof trackIdSchema>,
	padId: PadId,
	flag: PadFlag,
	value: boolean,
): CommandInput<DrumSetPadFlagPayload> {
	return {
		type: drumSetPadFlagCommand.type,
		payload: { trackId, padId, flag, value },
	};
}

export function setPadChoke(
	trackId: z.infer<typeof trackIdSchema>,
	padId: PadId,
	chokeGroup: DrumSetPadChokePayload["chokeGroup"],
): CommandInput<DrumSetPadChokePayload> {
	return {
		type: drumSetPadChokeCommand.type,
		payload: { trackId, padId, chokeGroup },
	};
}

export function setPadParameter(
	trackId: z.infer<typeof trackIdSchema>,
	padId: PadId,
	parameterId: DrumSetPadParameterPayload["parameterId"],
	value: number,
): CommandInput<DrumSetPadParameterPayload> {
	return {
		type: drumSetPadParameterCommand.type,
		payload: { trackId, padId, parameterId, value },
	};
}

export function addPad(
	trackId: z.infer<typeof trackIdSchema>,
	pad: DrumPad,
	index?: number,
	restoreHits: readonly RestoredHits[] = [],
): CommandInput<DrumAddPadPayload> {
	return {
		type: drumAddPadCommand.type,
		payload: {
			trackId,
			pad,
			...(index === undefined ? {} : { index }),
			restoreHits: [...restoreHits],
		},
	};
}

export function removePad(
	trackId: z.infer<typeof trackIdSchema>,
	padId: PadId,
): CommandInput<DrumRemovePadPayload> {
	return { type: drumRemovePadCommand.type, payload: { trackId, padId } };
}

export function reorderPad(
	trackId: z.infer<typeof trackIdSchema>,
	padId: PadId,
	toIndex: number,
): CommandInput<DrumReorderPadPayload> {
	return {
		type: drumReorderPadCommand.type,
		payload: { trackId, padId, toIndex },
	};
}

/** Registered, payload-erased commands from this module. */
export const drumCommands: readonly RegisteredCommand[] = [
	eraseCommand(drumSetPadAssetCommand),
	eraseCommand(drumSetPadFlagCommand),
	eraseCommand(drumSetPadChokeCommand),
	eraseCommand(drumSetPadParameterCommand),
	eraseCommand(drumAddPadCommand),
	eraseCommand(drumRemovePadCommand),
	eraseCommand(drumReorderPadCommand),
];
