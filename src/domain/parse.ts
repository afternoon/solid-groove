import type { z } from "zod";
import {
	type Clip,
	clipSchema,
	type Device,
	type Project,
	type ProjectMetadata,
	projectMetadataSchema,
	projectSchema,
	SCHEMA_VERSION,
	type Song,
	songSchema,
	type Track,
} from "./entities";
import { getParameterDefinition, isParameterValueInRange } from "./parameters";

/**
 * Parsing and cross-entity integrity (PRD section 9.5).
 *
 * `parseProject` is the only way to obtain a `Project`. It validates shape,
 * schema version, and every relationship, and either returns a complete valid
 * project or a list of issues — it never mutates its input and never returns
 * partially repaired state.
 */

export type DomainIssueCode =
	| "invalid_shape"
	| "unsupported_schema_version"
	| "duplicate_id"
	| "dangling_reference"
	| "cross_owner_reference"
	| "invalid_order"
	| "invalid_parameter"
	| "invalid_automation"
	| "invalid_musical_time"
	| "invalid_metadata";

export interface DomainIssue {
	readonly code: DomainIssueCode;
	readonly path: ReadonlyArray<string | number>;
	readonly message: string;
}

export type ParseResult<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly issues: readonly DomainIssue[] };

export class DomainValidationError extends Error {
	readonly issues: readonly DomainIssue[];

	constructor(message: string, issues: readonly DomainIssue[]) {
		super(`${message}: ${issues.map(formatIssue).join("; ")}`);
		this.name = "DomainValidationError";
		this.issues = issues;
	}
}

export function formatIssue(issue: DomainIssue): string {
	const path = issue.path.length > 0 ? issue.path.join(".") : "<root>";
	return `[${issue.code}] ${path}: ${issue.message}`;
}

function issue(
	code: DomainIssueCode,
	path: ReadonlyArray<string | number>,
	message: string,
): DomainIssue {
	return { code, path, message };
}

function fromZod(error: z.ZodError): DomainIssue[] {
	return error.issues.map((zodIssue) =>
		issue(
			"invalid_shape",
			zodIssue.path as (string | number)[],
			zodIssue.message,
		),
	);
}

function parseWith<T>(
	schema: { safeParse: (input: unknown) => z.ZodSafeParseResult<T> },
	input: unknown,
): ParseResult<T> {
	const result = schema.safeParse(input);
	return result.success
		? { ok: true, value: result.data }
		: { ok: false, issues: fromZod(result.error) };
}

/** Parses one `projects/{projectId}` metadata document. */
export function parseProjectMetadata(
	input: unknown,
): ParseResult<ProjectMetadata> {
	const versionIssues = checkSchemaVersion(input, []);
	if (versionIssues.length > 0) {
		return { ok: false, issues: versionIssues };
	}
	return parseWith(projectMetadataSchema, input);
}

/** Parses one `projects/{projectId}/song/current` document. */
export function parseSong(input: unknown): ParseResult<Song> {
	const result = parseWith(songSchema, input);
	if (!result.ok) {
		return result;
	}
	const issues = checkSongIntegrity(result.value, ["song"]);
	return issues.length > 0 ? { ok: false, issues } : result;
}

/**
 * Parses one `projects/{projectId}/clips/{clipId}` document.
 *
 * A clip document carries no track or asset context, so this applies every
 * invariant that a clip can be judged on alone. Owner-dependent rules (pad
 * ownership, audio-loop asset) are checked in the aggregate path, which holds
 * the track and asset sets.
 */
export function parseClip(input: unknown): ParseResult<Clip> {
	const result = parseWith(clipSchema, input);
	if (!result.ok) {
		return result;
	}
	const issues = checkClipInvariants(result.value, []);
	return issues.length > 0 ? { ok: false, issues } : result;
}

/** Parses and fully validates a whole project aggregate. */
export function parseProject(input: unknown): ParseResult<Project> {
	const versionIssues = checkSchemaVersion(
		(input as { metadata?: unknown } | null | undefined)?.metadata,
		["metadata"],
	);
	if (versionIssues.length > 0) {
		return { ok: false, issues: versionIssues };
	}
	const shape = parseWith(projectSchema, input);
	if (!shape.ok) {
		return shape;
	}
	const issues = checkProjectIntegrity(shape.value);
	return issues.length > 0 ? { ok: false, issues } : shape;
}

/** Parses a project, throwing `DomainValidationError` when it is invalid. */
export function assertProject(input: unknown): Project {
	const result = parseProject(input);
	if (!result.ok) {
		throw new DomainValidationError("Invalid schema-v1 project", result.issues);
	}
	return result.value;
}

export function isProject(input: unknown): input is Project {
	return parseProject(input).ok;
}

/**
 * A future schema version is reported rather than parsed, so a newer document
 * is never silently coerced into v1 shape and overwritten (PRJ-04).
 */
function checkSchemaVersion(
	metadata: unknown,
	path: ReadonlyArray<string | number>,
): DomainIssue[] {
	if (typeof metadata !== "object" || metadata === null) {
		return [];
	}
	const version = (metadata as { schemaVersion?: unknown }).schemaVersion;
	if (typeof version !== "number" || !Number.isInteger(version)) {
		return [];
	}
	if (version > SCHEMA_VERSION) {
		return [
			issue(
				"unsupported_schema_version",
				[...path, "schemaVersion"],
				`Schema version ${version} is newer than the supported version ${SCHEMA_VERSION}; refusing to read or overwrite it`,
			),
		];
	}
	if (version < SCHEMA_VERSION) {
		return [
			issue(
				"unsupported_schema_version",
				[...path, "schemaVersion"],
				`Schema version ${version} predates schema v1 and is not migrated`,
			),
		];
	}
	return [];
}

/** Every cross-entity invariant in PRD section 9.5. */
export function checkProjectIntegrity(project: Project): DomainIssue[] {
	const issues: DomainIssue[] = [];
	const seenIds = new Set<string>();

	issues.push(...checkMetadata(project.metadata));
	issues.push(...checkSongIntegrity(project.song, ["song"], seenIds));

	const trackIds = new Map(
		project.song.tracks.map((track) => [track.id, track]),
	);
	const assetIds = new Set(project.song.assets.map((asset) => asset.id));
	const clipIds = new Map<string, Clip>();

	project.clips.forEach((clip, index) => {
		const path = ["clips", index] as const;
		claimId(seenIds, clip.id, [...path, "id"], issues);
		clipIds.set(clip.id, clip);
		const owner = trackIds.get(clip.trackId);
		if (!owner) {
			issues.push(
				issue(
					"dangling_reference",
					[...path, "trackId"],
					`Clip ${clip.id} references missing track ${clip.trackId}`,
				),
			);
		}
		issues.push(...checkClipInvariants(clip, [...path], seenIds));
		issues.push(...checkClipOwnership(clip, owner, assetIds, [...path]));
	});

	project.song.placements.forEach((placement, index) => {
		const path = ["song", "placements", index] as const;
		const clip = clipIds.get(placement.clipId);
		if (!clip) {
			issues.push(
				issue(
					"dangling_reference",
					[...path, "clipId"],
					`Placement ${placement.id} references missing clip ${placement.clipId}`,
				),
			);
			return;
		}
		if (clip.trackId !== placement.trackId) {
			issues.push(
				issue(
					"cross_owner_reference",
					[...path, "trackId"],
					`Placement ${placement.id} puts clip ${clip.id} (owned by track ${clip.trackId}) on track ${placement.trackId}`,
				),
			);
		}
	});

	return issues;
}

/**
 * Song-level integrity. Callers that also hold clips pass their `seenIds` set
 * so duplicate IDs are detected across the whole aggregate.
 */
export function checkSongIntegrity(
	song: Song,
	path: ReadonlyArray<string | number>,
	seenIds: Set<string> = new Set(),
): DomainIssue[] {
	const issues: DomainIssue[] = [];
	const assetIds = new Set<string>();
	const returnIds = new Set<string>();
	const tracks = new Map<string, Track>();

	song.assets.forEach((asset, index) => {
		claimId(seenIds, asset.id, [...path, "assets", index, "id"], issues);
		assetIds.add(asset.id);
	});

	song.returns.forEach((bus, index) => {
		claimId(seenIds, bus.id, [...path, "returns", index, "id"], issues);
		returnIds.add(bus.id);
		issues.push(
			...checkDeviceChain(
				bus.devices,
				[...path, "returns", index, "devices"],
				seenIds,
			),
		);
	});
	issues.push(
		...checkOrdering(
			song.returns.map((bus) => bus.order),
			[...path, "returns"],
			"return buses",
		),
	);

	issues.push(
		...checkDeviceChain(
			song.master.devices,
			[...path, "master", "devices"],
			seenIds,
		),
	);

	song.tracks.forEach((track, index) => {
		const trackPath = [...path, "tracks", index] as const;
		claimId(seenIds, track.id, [...trackPath, "id"], issues);
		tracks.set(track.id, track);
		issues.push(
			...checkDeviceChain(track.devices, [...trackPath, "devices"], seenIds),
		);
		issues.push(...checkInstrument(track, trackPath, assetIds, seenIds));

		const usedReturns = new Set<string>();
		track.sends.forEach((send, sendIndex) => {
			const sendPath = [...trackPath, "sends", sendIndex] as const;
			if (!returnIds.has(send.returnId)) {
				issues.push(
					issue(
						"dangling_reference",
						[...sendPath, "returnId"],
						`Track ${track.id} sends to missing return bus ${send.returnId}`,
					),
				);
			}
			if (usedReturns.has(send.returnId)) {
				issues.push(
					issue(
						"duplicate_id",
						[...sendPath, "returnId"],
						`Track ${track.id} has more than one send to return bus ${send.returnId}`,
					),
				);
			}
			usedReturns.add(send.returnId);
		});
	});
	issues.push(
		...checkOrdering(
			song.tracks.map((track) => track.order),
			[...path, "tracks"],
			"tracks",
		),
	);

	song.sections.forEach((section, index) => {
		claimId(seenIds, section.id, [...path, "sections", index, "id"], issues);
	});

	song.placements.forEach((placement, index) => {
		const placementPath = [...path, "placements", index] as const;
		claimId(seenIds, placement.id, [...placementPath, "id"], issues);
		if (!tracks.has(placement.trackId)) {
			issues.push(
				issue(
					"dangling_reference",
					[...placementPath, "trackId"],
					`Placement ${placement.id} references missing track ${placement.trackId}`,
				),
			);
		}
	});

	song.automation.forEach((lane, index) => {
		const lanePath = [...path, "automation", index] as const;
		claimId(seenIds, lane.id, [...lanePath, "id"], issues);
		issues.push(...checkAutomationLane(lane, lanePath, tracks, returnIds));
	});

	return issues;
}

function checkMetadata(metadata: ProjectMetadata): DomainIssue[] {
	const issues: DomainIssue[] = [];
	if (metadata.modifiedAt < metadata.createdAt) {
		issues.push(
			issue(
				"invalid_metadata",
				["metadata", "modifiedAt"],
				"modifiedAt precedes createdAt",
			),
		);
	}
	const seen = new Set<string>();
	metadata.collaboratorIds.forEach((collaboratorId, index) => {
		if (seen.has(collaboratorId)) {
			issues.push(
				issue(
					"duplicate_id",
					["metadata", "collaboratorIds", index],
					`Collaborator ${collaboratorId} is listed more than once`,
				),
			);
		}
		seen.add(collaboratorId);
	});
	return issues;
}

function checkInstrument(
	track: Track,
	path: ReadonlyArray<string | number>,
	assetIds: ReadonlySet<string>,
	seenIds: Set<string>,
): DomainIssue[] {
	const issues: DomainIssue[] = [];
	const instrument = track.instrument;
	if (!instrument) {
		return issues;
	}
	if (instrument.kind === "sampler" && instrument.assetId !== null) {
		if (!assetIds.has(instrument.assetId)) {
			issues.push(
				issue(
					"dangling_reference",
					[...path, "instrument", "assetId"],
					`Track ${track.id} references missing asset ${instrument.assetId}`,
				),
			);
		}
	}
	if (instrument.kind === "drumMachine") {
		instrument.pads.forEach((pad, index) => {
			const padPath = [...path, "instrument", "pads", index] as const;
			claimId(seenIds, pad.id, [...padPath, "id"], issues);
			if (pad.assetId !== null && !assetIds.has(pad.assetId)) {
				issues.push(
					issue(
						"dangling_reference",
						[...padPath, "assetId"],
						`Drum pad ${pad.id} references missing asset ${pad.assetId}`,
					),
				);
			}
		});
	}
	return issues;
}

/**
 * Clip-local integrity: everything a clip document can be judged on without its
 * owning track or the song's assets. Both `parseClip` and the aggregate path run
 * this, so the two entry points agree on what a valid clip is.
 *
 * Aggregate callers pass their `seenIds` set so event IDs are also unique across
 * the whole project.
 */
export function checkClipInvariants(
	clip: Clip,
	path: ReadonlyArray<string | number>,
	seenIds: Set<string> = new Set(),
): DomainIssue[] {
	const issues: DomainIssue[] = [];
	if (clip.content.kind !== "notes") {
		return issues;
	}
	clip.content.events.forEach((event, index) => {
		const eventPath = [...path, "content", "events", index] as const;
		claimId(seenIds, event.id, [...eventPath, "id"], issues);
		if (event.startTicks >= clip.lengthTicks) {
			issues.push(
				issue(
					"invalid_musical_time",
					[...eventPath, "startTicks"],
					`Note ${event.id} starts at ${event.startTicks} which is outside its ${clip.lengthTicks}-tick clip`,
				),
			);
		}
	});
	return issues;
}

/**
 * Clip integrity that depends on the clip's owner and the song's assets, and so
 * is only decidable in the aggregate path.
 */
function checkClipOwnership(
	clip: Clip,
	owner: Track | undefined,
	assetIds: ReadonlySet<string>,
	path: ReadonlyArray<string | number>,
): DomainIssue[] {
	const issues: DomainIssue[] = [];
	if (clip.content.kind === "audioLoop") {
		if (!assetIds.has(clip.content.assetId)) {
			issues.push(
				issue(
					"dangling_reference",
					[...path, "content", "assetId"],
					`Clip ${clip.id} references missing asset ${clip.content.assetId}`,
				),
			);
		}
		return issues;
	}
	const padIds = new Set(
		owner?.instrument?.kind === "drumMachine"
			? owner.instrument.pads.map((pad) => pad.id)
			: [],
	);
	clip.content.events.forEach((event, index) => {
		const eventPath = [...path, "content", "events", index] as const;
		if (event.trigger.kind === "pad" && !padIds.has(event.trigger.padId)) {
			issues.push(
				issue(
					"dangling_reference",
					[...eventPath, "trigger", "padId"],
					`Note ${event.id} triggers pad ${event.trigger.padId}, which its track does not own`,
				),
			);
		}
	});
	return issues;
}

function checkDeviceChain(
	devices: readonly Device[],
	path: ReadonlyArray<string | number>,
	seenIds: Set<string>,
): DomainIssue[] {
	const issues: DomainIssue[] = [];
	devices.forEach((device, index) => {
		claimId(seenIds, device.id, [...path, index, "id"], issues);
		for (const [parameterId, value] of Object.entries(device.parameters)) {
			const definition = getParameterDefinition(
				`${device.type}.${parameterId}`,
			);
			if (definition && !isParameterValueInRange(definition, value)) {
				issues.push(
					issue(
						"invalid_parameter",
						[...path, index, "parameters", parameterId],
						`Value ${value} is outside the declared range ${definition.min}..${definition.max}`,
					),
				);
			}
		}
	});
	issues.push(
		...checkOrdering(
			devices.map((device) => device.order),
			path,
			"devices",
		),
	);
	return issues;
}

/** Insert chains and track lists are serial: orders are 0..n-1 exactly once. */
function checkOrdering(
	orders: readonly number[],
	path: ReadonlyArray<string | number>,
	label: string,
): DomainIssue[] {
	const sorted = [...orders].sort((a, b) => a - b);
	const contiguous = sorted.every((order, index) => order === index);
	return contiguous
		? []
		: [
				issue(
					"invalid_order",
					path,
					`Order values for ${label} must be 0..${orders.length - 1} without gaps or duplicates, received [${orders.join(", ")}]`,
				),
			];
}

function checkAutomationLane(
	lane: Song["automation"][number],
	path: ReadonlyArray<string | number>,
	tracks: ReadonlyMap<string, Track>,
	returnIds: ReadonlySet<string>,
): DomainIssue[] {
	const issues: DomainIssue[] = [];
	const target = lane.target;

	if ("trackId" in target) {
		const track = tracks.get(target.trackId);
		if (!track) {
			issues.push(
				issue(
					"dangling_reference",
					[...path, "target", "trackId"],
					`Automation ${lane.id} targets missing track ${target.trackId}`,
				),
			);
		} else if (target.scope === "trackDevice") {
			const device = track.devices.find(
				(entry) => entry.id === target.deviceId,
			);
			if (!device) {
				issues.push(
					issue(
						"dangling_reference",
						[...path, "target", "deviceId"],
						`Automation ${lane.id} targets missing device ${target.deviceId} on track ${track.id}`,
					),
				);
			}
		} else if (target.scope === "send") {
			const send = track.sends.find(
				(entry) => entry.returnId === target.returnId,
			);
			if (!send) {
				issues.push(
					issue(
						"dangling_reference",
						[...path, "target", "returnId"],
						`Automation ${lane.id} targets a send to ${target.returnId} that track ${track.id} does not have`,
					),
				);
			}
		}
	}

	if (target.scope === "return" && !returnIds.has(target.returnId)) {
		issues.push(
			issue(
				"dangling_reference",
				[...path, "target", "returnId"],
				`Automation ${lane.id} targets missing return bus ${target.returnId}`,
			),
		);
	}

	const definition = getParameterDefinition(target.parameterId);
	if (!definition) {
		issues.push(
			issue(
				"invalid_automation",
				[...path, "target", "parameterId"],
				`Automation ${lane.id} targets unknown parameter "${target.parameterId}"`,
			),
		);
	} else if (!definition.automatable) {
		issues.push(
			issue(
				"invalid_automation",
				[...path, "target", "parameterId"],
				`Parameter "${definition.id}" does not support automation`,
			),
		);
	}

	let previousTick = -1;
	lane.points.forEach((point, index) => {
		if (point.tick <= previousTick) {
			issues.push(
				issue(
					"invalid_automation",
					[...path, "points", index, "tick"],
					`Automation points must be ordered by strictly increasing tick, received ${point.tick} after ${previousTick}`,
				),
			);
		}
		previousTick = point.tick;
		if (definition && !isParameterValueInRange(definition, point.value)) {
			issues.push(
				issue(
					"invalid_parameter",
					[...path, "points", index, "value"],
					`Value ${point.value} is outside the declared range ${definition.min}..${definition.max} for "${definition.id}"`,
				),
			);
		}
	});

	return issues;
}

function claimId(
	seenIds: Set<string>,
	id: string,
	path: ReadonlyArray<string | number>,
	issues: DomainIssue[],
): void {
	if (seenIds.has(id)) {
		issues.push(issue("duplicate_id", path, `Duplicate entity id ${id}`));
	}
	seenIds.add(id);
}
