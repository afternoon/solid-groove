import { deviceParameters } from "./devices";
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
import {
	bareParameterId,
	getParameterDefinition,
	isParameterValueInRange,
	SAMPLER_SAMPLE_END,
	SAMPLER_SAMPLE_START,
} from "./parameters";
import { checkAutomationLane } from "./parse/automation";
import { checkClipInvariants, checkClipOwnership } from "./parse/clip";
import {
	checkAddedPacks,
	checkMetadata,
	checkPackQualification,
} from "./parse/packs";
import {
	checkOrdering,
	claimId,
	type DomainIssue,
	type DomainIssueCode,
	DomainValidationError,
	formatIssue,
	issue,
	type ParseResult,
	parseWith,
} from "./parse/primitives";

export type { DomainIssue, DomainIssueCode, ParseResult };
export { checkClipInvariants, DomainValidationError, formatIssue };

/**
 * Routing capacity ceilings (PRD FX-01, LOOP-008). The PRD states a floor —
 * "at least eight serial insert devices per track" and "two stereo send/return
 * buses" — and these are the ceilings the alpha actually enforces, set well
 * above that floor so a chain or a send layout stays a creative choice rather
 * than a limit users design around. They are still finite: a bound exists so
 * every mutation path — the device/send commands and any imported document —
 * is judged against one declared value rather than a literal repeated at each
 * call site, and so a runaway document cannot grow a track's graph without end.
 */
export const MAX_TRACK_INSERTS = 16;
export const MAX_RETURN_BUSES = 8;

/**
 * Parsing and cross-entity integrity (PRD section 9.5).
 *
 * `parseProject` is the only way to obtain a `Project`. It validates shape,
 * schema version, and every relationship, and either returns a complete valid
 * project or a list of issues — it never mutates its input and never returns
 * partially repaired state.
 *
 * This file is being split into per-concern modules under `./parse/*` so a
 * new invariant lands in its own file instead of appending to one growing
 * one (REFACTOR-002). The issue primitives, clip invariants, automation
 * invariants, and pack invariants have moved out so far; the rest still
 * live here.
 */

/**
 * Parses one `projects/{projectId}` metadata document.
 *
 * Like `parseClip`, this applies every invariant the document can be judged on
 * alone — timestamps, collaborators, and the shape of the pack dependency list.
 * Whether that list matches the project's assets is only decidable in the
 * aggregate path, which holds the song.
 */
export function parseProjectMetadata(
	input: unknown,
): ParseResult<ProjectMetadata> {
	const versionIssues = checkSchemaVersion(input, []);
	if (versionIssues.length > 0) {
		return { ok: false, issues: versionIssues };
	}
	const result = parseWith(projectMetadataSchema, input);
	if (!result.ok) {
		return result;
	}
	const issues = checkMetadata(result.value);
	return issues.length > 0 ? { ok: false, issues } : result;
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
	issues.push(...checkPackQualification(project));
	issues.push(...checkAddedPacks(project));

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
	if (song.returns.length > MAX_RETURN_BUSES) {
		issues.push(
			issue(
				"capacity_exceeded",
				[...path, "returns"],
				`A song may have at most ${MAX_RETURN_BUSES} return buses, found ${song.returns.length}`,
			),
		);
	}

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
		if (track.devices.length > MAX_TRACK_INSERTS) {
			issues.push(
				issue(
					"capacity_exceeded",
					[...trackPath, "devices"],
					`A track may have at most ${MAX_TRACK_INSERTS} insert devices, track ${track.id} has ${track.devices.length}`,
				),
			);
		}
		issues.push(...checkInstrument(track, trackPath, assetIds, seenIds));

		const usedReturns = new Set<string>();
		track.sendConfig.forEach((send, sendIndex) => {
			const sendPath = [...trackPath, "sendConfig", sendIndex] as const;
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
	// Every stored instrument parameter is validated against its registered
	// definition (invariant 10), the same way device parameters are — namespaced
	// by instrument kind, `${kind}.${parameterId}`.
	issues.push(
		...checkInstrumentParameters(instrument.kind, instrument.parameters, [
			...path,
			"instrument",
			"parameters",
		]),
	);
	if (instrument.kind === "sampler") {
		if (instrument.assetId !== null && !assetIds.has(instrument.assetId)) {
			issues.push(
				issue(
					"dangling_reference",
					[...path, "instrument", "assetId"],
					`Track ${track.id} references missing asset ${instrument.assetId}`,
				),
			);
		}
		// A sample window collapses to silence — or plays backwards — unless its
		// end is strictly after its start.
		const start =
			instrument.parameters[bareParameterId(SAMPLER_SAMPLE_START.id)];
		const end = instrument.parameters[bareParameterId(SAMPLER_SAMPLE_END.id)];
		if (start !== undefined && end !== undefined && end <= start) {
			issues.push(
				issue(
					"invalid_parameter",
					[...path, "instrument", "parameters", "sampleEnd"],
					`Sample end ${end} must be greater than sample start ${start}`,
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
			for (const [parameterId, value] of Object.entries(pad.parameters)) {
				const definition = getParameterDefinition(`pad.${parameterId}`);
				if (definition && !isParameterValueInRange(definition, value)) {
					issues.push(
						issue(
							"invalid_parameter",
							[...padPath, "parameters", parameterId],
							`Value ${value} is outside the declared range ${definition.min}..${definition.max}`,
						),
					);
				}
			}
		});
	}
	return issues;
}

/** Validates a sparse instrument parameter map against its registered definitions. */
function checkInstrumentParameters(
	kind: NonNullable<Track["instrument"]>["kind"],
	parameters: Readonly<Record<string, number>>,
	path: ReadonlyArray<string | number>,
): DomainIssue[] {
	const issues: DomainIssue[] = [];
	for (const [parameterId, value] of Object.entries(parameters)) {
		const definition = getParameterDefinition(`${kind}.${parameterId}`);
		if (definition && !isParameterValueInRange(definition, value)) {
			issues.push(
				issue(
					"invalid_parameter",
					[...path, parameterId],
					`Value ${value} is outside the declared range ${definition.min}..${definition.max}`,
				),
			);
		}
	}
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
		// A registered device type owns a known parameter set; an unregistered
		// type (forward-compatible passthrough, LOOP-009) declares none, so its
		// stored parameters are accepted as opaque finite numbers.
		const declared = new Set(
			deviceParameters(device.type).map((definition) =>
				bareParameterId(definition.id),
			),
		);
		const typeIsRegistered = declared.size > 0;
		for (const [parameterId, value] of Object.entries(device.parameters)) {
			if (typeIsRegistered && !declared.has(parameterId)) {
				issues.push(
					issue(
						"invalid_parameter",
						[...path, index, "parameters", parameterId],
						`Device type "${device.type}" has no parameter "${parameterId}"`,
					),
				);
				continue;
			}
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
