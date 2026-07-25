import type { Clip, Project, ProjectMetadata, Song } from "../domain/entities";
import type { ClipId, ProjectId } from "../domain/ids";
import type { PersistenceIssue } from "./documents";

/**
 * The repository boundary (PRD section 9.9).
 *
 * One interface, two implementations: an in-memory store for unit, component,
 * and browser tests, and a Firestore store for production. Both are exercised
 * by the same contract suite (`projectRepositoryContract.ts`), so a test that
 * passes against the fake is evidence about the real backend rather than about
 * the fake's convenience.
 *
 * Two rules shape the whole interface:
 *
 * - **Every write is revision-checked.** A caller states the revision it
 *   believes is current; the repository either applies the write and returns
 *   the new revision, or reports a conflict and changes nothing. This is what
 *   makes "remote echoes never overwrite a newer local edit" (PRJ-03)
 *   enforceable rather than aspirational.
 * - **Tiers are written independently.** A note edit calls `saveClip` and
 *   touches one clip document; it never rewrites song structure.
 */

export type Unsubscribe = () => void;

export type SaveFailureReason =
	/** The stored revision is not the one the caller wrote against. */
	| "revision_conflict"
	/** The project (or the document being updated) does not exist. */
	| "not_found"
	/** `createProject` was called for a project ID that already exists. */
	| "already_exists"
	/** The stored document declares a schema version this build cannot write. */
	| "unsupported_schema_version"
	/** The value offered is not valid schema-v1 state. */
	| "invalid_document"
	/** The write would exceed a document budget even after chunking. */
	| "document_too_large"
	/** The backend could not be reached or failed transiently. */
	| "unavailable";

export interface SaveSuccess {
	readonly ok: true;
	/** The project's revision after the write. */
	readonly revision: number;
	readonly modifiedAt: number;
}

export interface SaveFailure {
	readonly ok: false;
	readonly reason: SaveFailureReason;
	readonly message: string;
	/** Whether retrying the identical write could succeed. */
	readonly retryable: boolean;
	/** The revision the store actually holds, when the failure is a conflict. */
	readonly currentRevision?: number;
	readonly issues?: readonly PersistenceIssue[];
}

export type SaveResult = SaveSuccess | SaveFailure;

export type LoadFailureReason =
	| "not_found"
	| "invalid_document"
	| "unsupported_schema_version"
	| "unavailable";

export type LoadResult<T> =
	| { readonly ok: true; readonly value: T }
	| {
			readonly ok: false;
			readonly reason: LoadFailureReason;
			readonly message: string;
			readonly issues?: readonly PersistenceIssue[];
	  };

/** The metadata fields a user can edit without touching song or clip state. */
export interface ProjectMetadataPatch {
	readonly name?: string;
	readonly template?: string | null;
	readonly genre?: string | null;
	readonly collaboratorIds?: readonly string[];
}

export type ProjectWatchEvent =
	| { readonly kind: "metadata"; readonly metadata: ProjectMetadata }
	| { readonly kind: "removed" }
	| { readonly kind: "error"; readonly message: string };

export interface ProjectRepository {
	/** Writes every tier of a new project. Fails if the project ID is taken. */
	createProject(project: Project): Promise<SaveResult>;

	/** Reads and validates every tier, including arrangement chunks. */
	loadProject(projectId: ProjectId): Promise<LoadResult<Project>>;

	/**
	 * The dashboard query: metadata only. It must not read the song or clip
	 * tiers, so listing projects stays cheap no matter how large they are.
	 */
	listProjects(ownerId: string): Promise<ProjectMetadata[]>;

	loadProjectMetadata(
		projectId: ProjectId,
	): Promise<LoadResult<ProjectMetadata>>;

	saveMetadata(
		projectId: ProjectId,
		patch: ProjectMetadataPatch,
		baseRevision: number,
	): Promise<SaveResult>;

	/** Structural and arrangement edits; chunks overflow automatically. */
	saveSong(
		projectId: ProjectId,
		song: Song,
		baseRevision: number,
	): Promise<SaveResult>;

	/** The note-edit path: one clip document, no song rewrite. */
	saveClip(
		projectId: ProjectId,
		clip: Clip,
		baseRevision: number,
	): Promise<SaveResult>;

	deleteClip(
		projectId: ProjectId,
		clipId: ClipId,
		baseRevision: number,
	): Promise<SaveResult>;

	/** Removes every document of the project, including chunks and clips. */
	deleteProject(projectId: ProjectId): Promise<void>;

	/** Observes the metadata tier, which carries the authoritative revision. */
	watchProject(
		projectId: ProjectId,
		listener: (event: ProjectWatchEvent) => void,
	): Unsubscribe;
}

export function saveFailure(
	reason: SaveFailureReason,
	message: string,
	extra: Omit<SaveFailure, "ok" | "reason" | "message" | "retryable"> & {
		retryable?: boolean;
	} = {},
): SaveFailure {
	const { retryable, ...rest } = extra;
	return {
		ok: false,
		reason,
		message,
		retryable: retryable ?? reason === "unavailable",
		...rest,
	};
}

export function loadFailure<T>(
	reason: LoadFailureReason,
	message: string,
	issues?: readonly PersistenceIssue[],
): LoadResult<T> {
	return { ok: false, reason, message, issues };
}
