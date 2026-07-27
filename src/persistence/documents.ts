import {
	type Clip,
	type Project,
	type ProjectMetadata,
	SCHEMA_VERSION,
	type Song,
} from "../domain/entities";
import type { ProjectId, TrackId } from "../domain/ids";
import type { DomainIssue, ParseResult } from "../domain/parse";
import { parseProject, parseProjectMetadata } from "../domain/parse";
import type { JsonObject, JsonValue } from "../domain/serialize";
import {
	serializeClip,
	serializeProjectMetadata,
	serializeSong,
} from "../domain/serialize";
import {
	ARRANGEMENT_CHUNK_BUDGET_BYTES,
	CLIP_DOCUMENT_BUDGET_BYTES,
	estimateDocumentBytes,
	SONG_DOCUMENT_BUDGET_BYTES,
} from "./documentSize";

/**
 * The schema-v1 Firestore document mapping (PRD section 9.9).
 *
 * This module is the checked-in mapping: it owns the collection paths, the
 * shape of every stored document, where ownership/schema version/revision and
 * timestamps live, and the rule that decides when arrangement content moves out
 * of the song document into per-track chunks. Nothing else in the codebase may
 * hand-build a Firestore path or document body for a project.
 *
 * | Path                                     | Contents                          |
 * | ---------------------------------------- | --------------------------------- |
 * | `projects/{projectId}`                   | Metadata, including the derived pack dependency list; the only tier the dashboard reads |
 * | `projects/{projectId}/song/current`      | Song structure and arrangement    |
 * | `projects/{projectId}/clips/{clipId}`    | One clip and its content          |
 * | `projects/{projectId}/arrangement/{trackId}` | One track's arrangement chunk, only when the song document exceeds its budget |
 *
 * Conventions that hold for every tier:
 *
 * - **Ownership** lives only on the metadata document (`ownerId`,
 *   `collaboratorIds`). Child documents inherit it; security rules resolve the
 *   parent rather than trusting a copy.
 * - **Schema version** is written on every document, so no tier can be read or
 *   overwritten by a reader that does not understand it.
 * - **Revision** is written on every document. The metadata document holds the
 *   project's current revision; a child document holds the revision it was
 *   written at, and arrangement chunks always share their song document's
 *   revision, so a torn multi-document write is detectable.
 * - **Timestamps** are integer epoch milliseconds, never Firestore
 *   `Timestamp`s: the domain model must never see a Firebase type, and an
 *   integer field still sorts and queries.
 * - **`projectId`** is repeated on every child document so a document copied
 *   between projects is rejected by both the rules and the decoder.
 * - **Pack dependencies** (`packDependencies`) live on the metadata document so
 *   the dashboard, export, and a missing-pack warning can answer "what does this
 *   project need?" without reading song state or clip content. The list is
 *   derived from the song's assets, so `saveSong` rewrites it in the same
 *   revision-checked step that writes the song — never a separate write that
 *   could be lost.
 */

export const PROJECTS_COLLECTION = "projects";
export const SONG_COLLECTION = "song";
/** The song tier is a single document; the collection exists for rules scoping. */
export const SONG_DOCUMENT_ID = "current";
export const CLIPS_COLLECTION = "clips";
export const ARRANGEMENT_COLLECTION = "arrangement";

export function projectDocumentPath(projectId: string): string {
	return `${PROJECTS_COLLECTION}/${projectId}`;
}

export function songDocumentPath(projectId: string): string {
	return `${projectDocumentPath(projectId)}/${SONG_COLLECTION}/${SONG_DOCUMENT_ID}`;
}

export function clipsCollectionPath(projectId: string): string {
	return `${projectDocumentPath(projectId)}/${CLIPS_COLLECTION}`;
}

export function clipDocumentPath(projectId: string, clipId: string): string {
	return `${clipsCollectionPath(projectId)}/${clipId}`;
}

export function arrangementCollectionPath(projectId: string): string {
	return `${projectDocumentPath(projectId)}/${ARRANGEMENT_COLLECTION}`;
}

export function arrangementChunkPath(
	projectId: string,
	trackId: string,
): string {
	return `${arrangementCollectionPath(projectId)}/${trackId}`;
}

/** One document as it is stored: its full path and its field map. */
export interface StoredDocument {
	readonly path: string;
	readonly data: JsonObject;
}

/** Every document that makes up one stored project. */
export interface ProjectDocuments {
	readonly metadata: StoredDocument;
	readonly song: StoredDocument;
	readonly clips: readonly StoredDocument[];
	readonly arrangement: readonly StoredDocument[];
}

export type PersistenceIssueCode =
	| DomainIssue["code"]
	| "cross_project_reference"
	| "missing_document"
	| "revision_mismatch";

export interface PersistenceIssue {
	readonly code: PersistenceIssueCode;
	readonly path: ReadonlyArray<string | number>;
	readonly message: string;
}

function issue(
	code: PersistenceIssueCode,
	path: ReadonlyArray<string | number>,
	message: string,
): PersistenceIssue {
	return { code, path, message };
}

// --- Encoding ---------------------------------------------------------

/** The metadata document: the only tier the dashboard query loads. */
export function encodeProjectMetadata(
	metadata: ProjectMetadata,
): StoredDocument {
	const { id, ...fields } = serializeProjectMetadata(metadata);
	return { path: projectDocumentPath(String(id)), data: fields };
}

export function encodeClip(
	projectId: ProjectId,
	clip: Clip,
	revision: number,
	updatedAt: number,
): StoredDocument {
	return {
		path: clipDocumentPath(projectId, clip.id),
		data: {
			projectId,
			schemaVersion: SCHEMA_VERSION,
			revision,
			updatedAt,
			...serializeClip(clip),
		},
	};
}

/**
 * The song document plus any arrangement chunks it overflowed into.
 *
 * The song document is written whole first. If it exceeds
 * `SONG_DOCUMENT_BUDGET_BYTES`, every per-track arrangement item — placements
 * and the automation lanes that target a track, a device on a track, or one of
 * its sends — moves into `arrangement/{trackId}` documents at the same
 * revision. The split is all-or-nothing so a reader has one rule to follow:
 * `arrangementChunked` decides whether the arrangement subcollection must be
 * read. Automation on returns and the master bus stays in the song document —
 * it is bounded by the number of buses and has no per-track chunk to live in.
 */
export function encodeSong(
	projectId: ProjectId,
	song: Song,
	revision: number,
	updatedAt: number,
): { song: StoredDocument; arrangement: StoredDocument[] } {
	const serialized = serializeSong(song);
	const placements = asArray(serialized.placements);
	const automation = asArray(serialized.automation);

	const envelope: JsonObject = {
		projectId,
		schemaVersion: SCHEMA_VERSION,
		revision,
		updatedAt,
	};
	const path = songDocumentPath(projectId);
	const whole: JsonObject = {
		...envelope,
		...serialized,
		arrangementChunked: false,
		chunkTrackIds: [],
	};

	if (estimateDocumentBytes(path, whole) <= SONG_DOCUMENT_BUDGET_BYTES) {
		return { song: { path, data: whole }, arrangement: [] };
	}

	const byTrack = new Map<
		string,
		{ placements: JsonValue[]; automation: JsonValue[] }
	>();
	const bucket = (trackId: string) => {
		const existing = byTrack.get(trackId);
		if (existing) return existing;
		const created = { placements: [], automation: [] };
		byTrack.set(trackId, created);
		return created;
	};

	for (const placement of placements) {
		bucket(readString(placement, "trackId")).placements.push(placement);
	}
	const sharedAutomation: JsonValue[] = [];
	for (const lane of automation) {
		const trackId = automationTrackId(lane);
		if (trackId === null) {
			sharedAutomation.push(lane);
		} else {
			bucket(trackId).automation.push(lane);
		}
	}

	// Chunk order follows the serialized track order so two encodes of the same
	// song always produce the same chunk list.
	const chunkTrackIds = asArray(serialized.tracks)
		.map((track) => readString(track, "id"))
		.filter((trackId) => byTrack.has(trackId));

	const arrangement = chunkTrackIds.map((trackId) => {
		const content = byTrack.get(trackId) ?? { placements: [], automation: [] };
		return {
			path: arrangementChunkPath(projectId, trackId),
			data: {
				...envelope,
				trackId,
				placements: content.placements,
				automation: content.automation,
			} satisfies JsonObject,
		};
	});

	return {
		song: {
			path,
			data: {
				...whole,
				placements: [],
				automation: sharedAutomation,
				arrangementChunked: true,
				chunkTrackIds,
			},
		},
		arrangement,
	};
}

/** Every document of a project, ready to be written to any store. */
export function encodeProject(project: Project): ProjectDocuments {
	const { id, revision, modifiedAt } = project.metadata;
	const { song, arrangement } = encodeSong(
		id,
		project.song,
		revision,
		modifiedAt,
	);
	return {
		metadata: encodeProjectMetadata(project.metadata),
		song,
		clips: project.clips.map((clip) =>
			encodeClip(id, clip, revision, modifiedAt),
		),
		arrangement,
	};
}

/** Documents that exceed their budget, reported before any write is attempted. */
export interface OversizedDocument {
	readonly path: string;
	readonly bytes: number;
	readonly budgetBytes: number;
}

/**
 * Checks the documents a write would produce against their budgets. A song
 * document is only oversized after chunking has already been applied, so this
 * reports the case the layout cannot split any further: one track whose own
 * arrangement no longer fits.
 */
export function findOversizedDocuments(
	documents: Pick<ProjectDocuments, "song" | "arrangement"> &
		Partial<Pick<ProjectDocuments, "clips">>,
): OversizedDocument[] {
	const oversized: OversizedDocument[] = [];
	const check = (document: StoredDocument, budgetBytes: number) => {
		const bytes = estimateDocumentBytes(document.path, document.data);
		if (bytes > budgetBytes) {
			oversized.push({ path: document.path, bytes, budgetBytes });
		}
	};
	check(documents.song, SONG_DOCUMENT_BUDGET_BYTES);
	for (const chunk of documents.arrangement) {
		check(chunk, ARRANGEMENT_CHUNK_BUDGET_BYTES);
	}
	for (const clip of documents.clips ?? []) {
		check(clip, CLIP_DOCUMENT_BUDGET_BYTES);
	}
	return oversized;
}

// --- Decoding ---------------------------------------------------------

/** The raw documents read back out of a store, before any validation. */
export interface RawProjectDocuments {
	readonly projectId: string;
	readonly metadata: unknown;
	readonly song: unknown;
	readonly clips: readonly unknown[];
	readonly arrangement?: readonly unknown[];
}

export type DecodeResult<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly issues: readonly PersistenceIssue[] };

/**
 * Rebuilds a validated `Project` from stored documents.
 *
 * Envelope fields (schema version, project ID, chunk revisions) are checked
 * first, because a document from another project or another schema version is a
 * different problem from a malformed one. The reassembled aggregate then goes
 * through `parseProject`, so persistence never invents a second, weaker notion
 * of a valid project.
 */
export function decodeProject(
	documents: RawProjectDocuments,
): DecodeResult<Project> {
	const issues: PersistenceIssue[] = [];
	const metadata = asObject(documents.metadata);
	if (!metadata) {
		return {
			ok: false,
			issues: [
				issue("missing_document", ["metadata"], "Project metadata is missing"),
			],
		};
	}
	const song = asObject(documents.song);
	if (!song) {
		return {
			ok: false,
			issues: [
				issue(
					"missing_document",
					["song"],
					`Song document ${songDocumentPath(documents.projectId)} is missing`,
				),
			],
		};
	}

	issues.push(...checkSchemaVersion(metadata, ["metadata"]));
	issues.push(...checkSchemaVersion(song, ["song"]));
	issues.push(...checkProjectId(song, documents.projectId, ["song"]));

	const songRevision = song.revision;
	const chunks = (documents.arrangement ?? []).map(asObject);
	const chunked = song.arrangementChunked === true;
	const expectedChunkIds = asArray(song.chunkTrackIds).map(String);

	const placements: JsonValue[] = [...asArray(song.placements)];
	const automation: JsonValue[] = [...asArray(song.automation)];

	if (chunked) {
		const seen = new Set<string>();
		chunks.forEach((chunk, index) => {
			const path = ["arrangement", index] as const;
			if (!chunk) {
				issues.push(
					issue("missing_document", path, "Arrangement chunk is not an object"),
				);
				return;
			}
			issues.push(...checkSchemaVersion(chunk, path));
			issues.push(...checkProjectId(chunk, documents.projectId, path));
			if (chunk.revision !== songRevision) {
				issues.push(
					issue(
						"revision_mismatch",
						[...path, "revision"],
						`Arrangement chunk for track ${String(chunk.trackId)} is at revision ${String(chunk.revision)} but the song document is at revision ${String(songRevision)}`,
					),
				);
			}
			seen.add(String(chunk.trackId));
			placements.push(...asArray(chunk.placements));
			automation.push(...asArray(chunk.automation));
		});
		for (const trackId of expectedChunkIds) {
			if (!seen.has(trackId)) {
				issues.push(
					issue(
						"missing_document",
						["arrangement", trackId],
						`Song document lists an arrangement chunk for track ${trackId} that was not read`,
					),
				);
			}
		}
	} else if (chunks.length > 0) {
		issues.push(
			issue(
				"invalid_shape",
				["arrangement"],
				"Arrangement chunks exist but the song document is not marked chunked",
			),
		);
	}

	const clips: JsonValue[] = [];
	documents.clips.forEach((raw, index) => {
		const clip = asObject(raw);
		const path = ["clips", index] as const;
		if (!clip) {
			issues.push(
				issue("invalid_shape", path, "Clip document is not an object"),
			);
			return;
		}
		issues.push(...checkSchemaVersion(clip, path));
		issues.push(...checkProjectId(clip, documents.projectId, path));
		clips.push(stripEnvelope(clip));
	});

	if (issues.length > 0) {
		return { ok: false, issues };
	}

	const aggregate = {
		// The metadata document is the domain's metadata minus its ID, which the
		// document path already carries — there is no envelope to strip.
		metadata: { id: documents.projectId, ...metadata },
		song: { ...stripSongEnvelope(song), placements, automation },
		clips,
	};

	return toDecodeResult(parseProject(aggregate));
}

function toDecodeResult(result: ParseResult<Project>): DecodeResult<Project> {
	return result.ok ? result : { ok: false, issues: result.issues };
}

/** Decodes one metadata document — the dashboard's read path. */
export function decodeProjectMetadata(
	projectId: string,
	raw: unknown,
): DecodeResult<ProjectMetadata> {
	const data = asObject(raw);
	if (!data) {
		return {
			ok: false,
			issues: [
				issue(
					"missing_document",
					[projectId],
					"Project metadata document is missing or not an object",
				),
			],
		};
	}
	const versionIssues = checkSchemaVersion(data, []);
	if (versionIssues.length > 0) {
		return { ok: false, issues: versionIssues };
	}
	// The document is validated by the same domain schema the aggregate path
	// uses, so the dashboard cannot accept metadata the editor would reject.
	const parsed = parseProjectMetadata({ id: projectId, ...data });
	return parsed.ok ? parsed : { ok: false, issues: parsed.issues };
}

// --- Helpers ----------------------------------------------------------

const ENVELOPE_FIELDS = [
	"projectId",
	"schemaVersion",
	"revision",
	"updatedAt",
] as const;

const SONG_ENVELOPE_FIELDS = [
	...ENVELOPE_FIELDS,
	"arrangementChunked",
	"chunkTrackIds",
] as const;

function stripEnvelope(data: JsonObject): JsonObject {
	return omit(data, ENVELOPE_FIELDS);
}

function stripSongEnvelope(data: JsonObject): JsonObject {
	return omit(data, SONG_ENVELOPE_FIELDS);
}

function omit(data: JsonObject, keys: readonly string[]): JsonObject {
	const result: JsonObject = {};
	for (const [key, value] of Object.entries(data)) {
		if (!keys.includes(key)) {
			result[key] = value;
		}
	}
	return result;
}

function checkSchemaVersion(
	data: JsonObject,
	path: ReadonlyArray<string | number>,
): PersistenceIssue[] {
	const version = data.schemaVersion;
	if (version === SCHEMA_VERSION) {
		return [];
	}
	return [
		issue(
			"unsupported_schema_version",
			[...path, "schemaVersion"],
			`Document declares schema version ${String(version)}; this build reads and writes version ${SCHEMA_VERSION} only`,
		),
	];
}

function checkProjectId(
	data: JsonObject,
	projectId: string,
	path: ReadonlyArray<string | number>,
): PersistenceIssue[] {
	if (data.projectId === projectId) {
		return [];
	}
	return [
		issue(
			"cross_project_reference",
			[...path, "projectId"],
			`Document belongs to project ${String(data.projectId)} but was read under ${projectId}`,
		),
	];
}

/** The track a lane is chunked under, or `null` for return/master automation. */
export function automationTrackId(lane: JsonValue): TrackId | null {
	const object = asObject(lane);
	const target = object ? asObject(object.target) : null;
	const trackId = target?.trackId;
	return typeof trackId === "string" ? (trackId as TrackId) : null;
}

function asObject(value: unknown): JsonObject | null {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as JsonObject)
		: null;
}

function asArray(value: JsonValue | undefined): JsonValue[] {
	return Array.isArray(value) ? value : [];
}

function readString(value: JsonValue, key: string): string {
	const object = asObject(value);
	return typeof object?.[key] === "string" ? object[key] : "";
}
