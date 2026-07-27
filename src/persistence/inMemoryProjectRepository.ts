import type { Clip, Project, ProjectMetadata, Song } from "../domain/entities";
import type { ClipId, ProjectId } from "../domain/ids";
import { derivePackDependencies } from "../domain/packs";
import type { JsonObject } from "../domain/serialize";
import { type Clock, systemClock } from "../shared/clock";
import {
	CLIP_DOCUMENT_BUDGET_BYTES,
	estimateDocumentBytes,
} from "./documentSize";
import {
	arrangementCollectionPath,
	clipDocumentPath,
	clipsCollectionPath,
	decodeProject,
	decodeProjectMetadata,
	encodeClip,
	encodeProject,
	encodeProjectMetadata,
	encodeSong,
	findOversizedDocuments,
	PROJECTS_COLLECTION,
	projectDocumentPath,
	type StoredDocument,
	songDocumentPath,
} from "./documents";
import {
	type DerivedMetadataFields,
	type LoadResult,
	loadFailure,
	type ProjectMetadataPatch,
	type ProjectRepository,
	type ProjectWatchEvent,
	type SaveResult,
	saveFailure,
	type Unsubscribe,
} from "./projectRepository";

/**
 * The in-memory repository: a document store with the same shape as Firestore.
 *
 * It stores the *encoded* documents at their real paths and runs the same
 * encode/decode, chunking, and revision checks as the Firestore repository, so
 * the shared contract suite exercises the actual persistence logic rather than
 * a shortcut. Only the transport differs.
 *
 * It also records every write, which is how tests assert that a note edit
 * touches one clip document instead of rewriting song structure.
 */

export interface WriteRecord {
	readonly kind: "set" | "delete";
	readonly path: string;
}

/** A transient failure injected by a test, consumed by the next N writes. */
export interface InjectedFault {
	readonly count: number;
	readonly message?: string;
}

export class InMemoryProjectRepository implements ProjectRepository {
	private readonly documents = new Map<string, JsonObject>();
	private readonly listeners = new Map<
		string,
		Set<(event: ProjectWatchEvent) => void>
	>();
	private readonly writeLog: WriteRecord[] = [];
	private readonly clock: Clock;
	private remainingFaults = 0;
	private faultMessage = "Injected persistence failure";

	constructor(options: { clock?: Clock } = {}) {
		this.clock = options.clock ?? systemClock;
	}

	/** Every write since the last `clearWrites()`, in order. */
	get writes(): readonly WriteRecord[] {
		return this.writeLog;
	}

	clearWrites(): void {
		this.writeLog.length = 0;
	}

	/** Makes the next `count` writes fail as `unavailable`. */
	failNextWrites(fault: InjectedFault): void {
		this.remainingFaults = fault.count;
		if (fault.message) {
			this.faultMessage = fault.message;
		}
	}

	/** Raw document access, for tests that assert on stored shape. */
	readDocument(path: string): JsonObject | undefined {
		return this.documents.get(path);
	}

	/** Raw document write, for tests that seed malformed or foreign state. */
	writeDocument(path: string, data: JsonObject): void {
		this.documents.set(path, data);
	}

	paths(): string[] {
		return [...this.documents.keys()].sort();
	}

	async createProject(project: Project): Promise<SaveResult> {
		const path = projectDocumentPath(project.metadata.id);
		if (this.documents.has(path)) {
			return saveFailure(
				"already_exists",
				`Project ${project.metadata.id} already exists`,
			);
		}
		const documents = encodeProject(project);
		const oversized = findOversizedDocuments(documents);
		if (oversized.length > 0) {
			return tooLarge(oversized);
		}
		const fault = this.takeFault();
		if (fault) return fault;

		this.set(documents.metadata);
		this.set(documents.song);
		for (const document of [...documents.clips, ...documents.arrangement]) {
			this.set(document);
		}
		this.emitMetadata(project.metadata.id);
		return {
			ok: true,
			revision: project.metadata.revision,
			modifiedAt: project.metadata.modifiedAt,
		};
	}

	async loadProject(projectId: ProjectId): Promise<LoadResult<Project>> {
		const metadata = this.documents.get(projectDocumentPath(projectId));
		if (!metadata) {
			return loadFailure("not_found", `Project ${projectId} does not exist`);
		}
		const decoded = decodeProject({
			projectId,
			metadata,
			song: this.documents.get(songDocumentPath(projectId)),
			clips: this.collection(clipsCollectionPath(projectId)),
			arrangement: this.collection(arrangementCollectionPath(projectId)),
		});
		if (decoded.ok) {
			return { ok: true, value: decoded.value };
		}
		return loadFailure(
			decoded.issues.some(
				(issue) => issue.code === "unsupported_schema_version",
			)
				? "unsupported_schema_version"
				: "invalid_document",
			`Stored project ${projectId} is not valid schema-v1 state`,
			decoded.issues,
		);
	}

	async loadProjectMetadata(
		projectId: ProjectId,
	): Promise<LoadResult<ProjectMetadata>> {
		const raw = this.documents.get(projectDocumentPath(projectId));
		if (!raw) {
			return loadFailure("not_found", `Project ${projectId} does not exist`);
		}
		return toMetadataResult(projectId, raw);
	}

	async listProjects(ownerId: string): Promise<ProjectMetadata[]> {
		const summaries: ProjectMetadata[] = [];
		for (const [path, data] of this.documents) {
			if (!isProjectMetadataPath(path) || data.ownerId !== ownerId) {
				continue;
			}
			const decoded = decodeProjectMetadata(documentId(path), data);
			// A document that no longer parses cannot be rendered by the dashboard;
			// it is skipped rather than allowed to break the whole listing.
			if (decoded.ok) {
				summaries.push(decoded.value);
			}
		}
		return summaries.sort((a, b) => b.modifiedAt - a.modifiedAt);
	}

	async saveMetadata(
		projectId: ProjectId,
		patch: ProjectMetadataPatch,
		baseRevision: number,
	): Promise<SaveResult> {
		return this.withRevisionCheck(projectId, baseRevision, () => null, patch);
	}

	async saveSong(
		projectId: ProjectId,
		song: Song,
		baseRevision: number,
	): Promise<SaveResult> {
		return this.withRevisionCheck(
			projectId,
			baseRevision,
			(_metadata, next) => {
				const encoded = encodeSong(
					projectId,
					song,
					next.revision,
					next.modifiedAt,
				);
				const oversized = findOversizedDocuments(encoded);
				if (oversized.length > 0) {
					return tooLarge(oversized);
				}
				const keep = new Set(encoded.arrangement.map((chunk) => chunk.path));
				for (const path of this.collectionPaths(
					arrangementCollectionPath(projectId),
				)) {
					if (!keep.has(path)) {
						this.delete(path);
					}
				}
				this.set(encoded.song);
				for (const chunk of encoded.arrangement) {
					this.set(chunk);
				}
				return null;
			},
			{},
			// The song's assets are what the metadata tier's dependency list is
			// derived from, so the two are written in the same revision-checked step.
			{ packDependencies: derivePackDependencies(song) },
		);
	}

	async saveClip(
		projectId: ProjectId,
		clip: Clip,
		baseRevision: number,
	): Promise<SaveResult> {
		return this.withRevisionCheck(
			projectId,
			baseRevision,
			(_metadata, next) => {
				const document = encodeClip(
					projectId,
					clip,
					next.revision,
					next.modifiedAt,
				);
				const bytes = estimateDocumentBytes(document.path, document.data);
				if (bytes > CLIP_DOCUMENT_BUDGET_BYTES) {
					return tooLarge([
						{
							path: document.path,
							bytes,
							budgetBytes: CLIP_DOCUMENT_BUDGET_BYTES,
						},
					]);
				}
				this.set(document);
				return null;
			},
		);
	}

	async deleteClip(
		projectId: ProjectId,
		clipId: ClipId,
		baseRevision: number,
	): Promise<SaveResult> {
		return this.withRevisionCheck(projectId, baseRevision, () => {
			this.delete(clipDocumentPath(projectId, clipId));
			return null;
		});
	}

	async deleteProject(projectId: ProjectId): Promise<void> {
		const prefix = `${projectDocumentPath(projectId)}/`;
		for (const path of [...this.documents.keys()]) {
			if (path.startsWith(prefix)) {
				this.delete(path);
			}
		}
		this.delete(projectDocumentPath(projectId));
		this.emit(projectId, { kind: "removed" });
	}

	watchProject(
		projectId: ProjectId,
		listener: (event: ProjectWatchEvent) => void,
	): Unsubscribe {
		const listeners = this.listeners.get(projectId) ?? new Set();
		listeners.add(listener);
		this.listeners.set(projectId, listeners);
		return () => {
			listeners.delete(listener);
			if (listeners.size === 0) {
				this.listeners.delete(projectId);
			}
		};
	}

	// --- internals ------------------------------------------------------

	/**
	 * The shared write path: read the metadata tier, refuse a write made against
	 * a revision the store no longer holds, apply the mutation, then bump the
	 * project's revision and modified time in the same step.
	 */
	private async withRevisionCheck(
		projectId: ProjectId,
		baseRevision: number,
		mutate: (
			metadata: ProjectMetadata,
			next: { revision: number; modifiedAt: number },
		) => SaveResult | null,
		patch: ProjectMetadataPatch = {},
		derived: DerivedMetadataFields = {},
	): Promise<SaveResult> {
		const raw = this.documents.get(projectDocumentPath(projectId));
		if (!raw) {
			return saveFailure("not_found", `Project ${projectId} does not exist`);
		}
		const decoded = toMetadataResult(projectId, raw);
		if (!decoded.ok) {
			return saveFailure(
				decoded.reason === "unsupported_schema_version"
					? "unsupported_schema_version"
					: "invalid_document",
				decoded.message,
				{ issues: decoded.issues },
			);
		}
		const metadata = decoded.value;
		if (metadata.revision !== baseRevision) {
			return revisionConflict(baseRevision, metadata.revision);
		}
		const fault = this.takeFault();
		if (fault) return fault;

		const next = {
			revision: metadata.revision + 1,
			modifiedAt: this.clock.now(),
		};
		const failure = mutate(metadata, next);
		if (failure) {
			return failure;
		}
		this.set(
			encodeProjectMetadata(
				nextMetadata(metadata, patch, derived, next.revision, next.modifiedAt),
			),
		);
		this.emitMetadata(projectId);
		return { ok: true, ...next };
	}

	private takeFault(): SaveResult | null {
		if (this.remainingFaults <= 0) {
			return null;
		}
		this.remainingFaults -= 1;
		return saveFailure("unavailable", this.faultMessage);
	}

	private set(document: StoredDocument): void {
		this.documents.set(document.path, document.data);
		this.writeLog.push({ kind: "set", path: document.path });
	}

	private delete(path: string): void {
		if (this.documents.delete(path)) {
			this.writeLog.push({ kind: "delete", path });
		}
	}

	private collection(path: string): JsonObject[] {
		return this.collectionPaths(path).map(
			(documentPath) => this.documents.get(documentPath) as JsonObject,
		);
	}

	private collectionPaths(path: string): string[] {
		const prefix = `${path}/`;
		return [...this.documents.keys()]
			.filter(
				(candidate) =>
					candidate.startsWith(prefix) &&
					!candidate.slice(prefix.length).includes("/"),
			)
			.sort();
	}

	private emitMetadata(projectId: string): void {
		const raw = this.documents.get(projectDocumentPath(projectId));
		if (!raw) return;
		const decoded = decodeProjectMetadata(projectId, raw);
		this.emit(
			projectId,
			decoded.ok
				? { kind: "metadata", metadata: decoded.value }
				: { kind: "error", message: "Stored metadata is not valid schema v1" },
		);
	}

	private emit(projectId: string, event: ProjectWatchEvent): void {
		for (const listener of this.listeners.get(projectId) ?? []) {
			listener(event);
		}
	}
}

export function revisionConflict(
	baseRevision: number,
	currentRevision: number,
): SaveResult {
	return saveFailure(
		"revision_conflict",
		`Write was made against revision ${baseRevision} but the stored project is at revision ${currentRevision}`,
		{ currentRevision },
	);
}

export function tooLarge(
	oversized: readonly { path: string; bytes: number; budgetBytes: number }[],
): SaveResult {
	return saveFailure(
		"document_too_large",
		oversized
			.map(
				(entry) =>
					`${entry.path} would store ${entry.bytes} bytes, over its ${entry.budgetBytes}-byte budget`,
			)
			.join("; "),
	);
}

export function toMetadataResult(
	projectId: string,
	raw: JsonObject,
): LoadResult<ProjectMetadata> {
	const decoded = decodeProjectMetadata(projectId, raw);
	if (decoded.ok) {
		return { ok: true, value: decoded.value };
	}
	return loadFailure(
		decoded.issues.some((issue) => issue.code === "unsupported_schema_version")
			? "unsupported_schema_version"
			: "invalid_document",
		`Stored metadata for ${projectId} is not valid schema-v1 state`,
		decoded.issues,
	);
}

/**
 * The metadata document one revision-checked write produces. Shared with the
 * Firestore repository so the two stores cannot disagree about which fields a
 * patch may change, which fields the store derives, and which it carries over.
 */
export function nextMetadata(
	metadata: ProjectMetadata,
	patch: ProjectMetadataPatch,
	derived: DerivedMetadataFields,
	revision: number,
	modifiedAt: number,
): ProjectMetadata {
	return {
		...metadata,
		...definedFields(patch),
		collaboratorIds: patch.collaboratorIds
			? [...patch.collaboratorIds]
			: metadata.collaboratorIds,
		packDependencies: derived.packDependencies
			? [...derived.packDependencies]
			: metadata.packDependencies,
		revision,
		modifiedAt,
	};
}

function definedFields(patch: ProjectMetadataPatch): Partial<ProjectMetadata> {
	const fields: Partial<ProjectMetadata> = {};
	if (patch.name !== undefined) fields.name = patch.name;
	if (patch.template !== undefined) fields.template = patch.template;
	if (patch.genre !== undefined) fields.genre = patch.genre;
	return fields;
}

function isProjectMetadataPath(path: string): boolean {
	const segments = path.split("/");
	return segments.length === 2 && segments[0] === PROJECTS_COLLECTION;
}

function documentId(path: string): string {
	return path.slice(path.lastIndexOf("/") + 1);
}

export function createInMemoryProjectRepository(
	options: { clock?: Clock } = {},
): InMemoryProjectRepository {
	return new InMemoryProjectRepository(options);
}
