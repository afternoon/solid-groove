import {
	type Clip,
	clipSchema,
	type Project,
	type ProjectMetadata,
	projectMetadataSchema,
	projectSchema,
	SCHEMA_VERSION,
	type Song,
	songSchema,
} from "../entities";
import { checkClipInvariants, checkClipOwnership } from "./clip";
import {
	checkAddedPacks,
	checkMetadata,
	checkPackQualification,
} from "./packs";
import {
	claimId,
	type DomainIssue,
	DomainValidationError,
	issue,
	type ParseResult,
	parseWith,
} from "./primitives";
import { checkSongIntegrity } from "./song";

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
