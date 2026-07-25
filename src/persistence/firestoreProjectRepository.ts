import {
	collection,
	deleteDoc,
	doc,
	type Firestore,
	getDoc,
	getDocs,
	onSnapshot,
	orderBy,
	query,
	runTransaction,
	type Transaction,
	where,
	writeBatch,
} from "firebase/firestore";
import type { Clip, Project, ProjectMetadata, Song } from "../domain/entities";
import type { ClipId, ProjectId } from "../domain/ids";
import type { JsonObject } from "../domain/serialize";
import { type Clock, systemClock } from "../shared/clock";
import {
	CLIP_DOCUMENT_BUDGET_BYTES,
	estimateDocumentBytes,
} from "./documentSize";
import {
	ARRANGEMENT_COLLECTION,
	arrangementChunkPath,
	CLIPS_COLLECTION,
	clipDocumentPath,
	clipsCollectionPath,
	decodeProject,
	encodeClip,
	encodeProject,
	encodeProjectMetadata,
	encodeSong,
	findOversizedDocuments,
	PROJECTS_COLLECTION,
	projectDocumentPath,
	SONG_COLLECTION,
	SONG_DOCUMENT_ID,
	type StoredDocument,
	songDocumentPath,
} from "./documents";
import {
	revisionConflict,
	toMetadataResult,
	tooLarge,
} from "./inMemoryProjectRepository";
import {
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
 * The Firestore repository.
 *
 * Every revision-checked write runs inside a Firestore transaction: the
 * metadata document is read, the caller's base revision is compared against it,
 * and the tier document plus the revision bump are committed together or not at
 * all. That is what makes a stale write from a slow tab or a re-delivered
 * offline mutation fail loudly instead of overwriting newer state.
 *
 * A `Firestore` instance is injected rather than imported from
 * `firebaseConfig`, so the emulator suite points the identical code at a local
 * emulator and the contract tests apply to the real backend.
 */
export class FirestoreProjectRepository implements ProjectRepository {
	private readonly db: Firestore;
	private readonly clock: Clock;

	constructor(db: Firestore, options: { clock?: Clock } = {}) {
		this.db = db;
		this.clock = options.clock ?? systemClock;
	}

	/**
	 * Creates a project in two steps, because the security rules resolve a child
	 * document's owner from its parent and rule `get()`s see the database as it
	 * was before the write commits. The metadata document is therefore claimed
	 * first; only then can the song, clip, and chunk documents be authorized. If
	 * the second step fails, the claimed metadata document is removed rather
	 * than left behind as a project with no song.
	 */
	async createProject(project: Project): Promise<SaveResult> {
		const documents = encodeProject(project);
		const oversized = findOversizedDocuments(documents);
		if (oversized.length > 0) {
			return tooLarge(oversized);
		}
		try {
			await runTransaction(this.db, async (tx) => {
				const metadataRef = this.ref(documents.metadata.path);
				const existing = await tx.get(metadataRef);
				if (existing.exists()) {
					throw new AbortWrite(
						saveFailure(
							"already_exists",
							`Project ${project.metadata.id} already exists`,
						),
					);
				}
				this.write(tx, documents.metadata);
			});
		} catch (error) {
			return toSaveFailure(error);
		}
		try {
			await this.commitAll([
				documents.song,
				...documents.clips,
				...documents.arrangement,
			]);
		} catch (error) {
			await deleteDoc(this.ref(documents.metadata.path)).catch(() => {});
			return toSaveFailure(error);
		}
		return {
			ok: true,
			revision: project.metadata.revision,
			modifiedAt: project.metadata.modifiedAt,
		};
	}

	/** Commits documents in batches, staying under Firestore's 500-write limit. */
	private async commitAll(documents: readonly StoredDocument[]): Promise<void> {
		for (let index = 0; index < documents.length; index += BATCH_SIZE) {
			const batch = writeBatch(this.db);
			for (const document of documents.slice(index, index + BATCH_SIZE)) {
				batch.set(this.ref(document.path), document.data);
			}
			await batch.commit();
		}
	}

	async loadProject(projectId: ProjectId): Promise<LoadResult<Project>> {
		try {
			const metadata = await this.readDocument(projectDocumentPath(projectId));
			if (!metadata) {
				return loadFailure("not_found", `Project ${projectId} does not exist`);
			}
			const [song, clips, arrangement] = await Promise.all([
				this.readDocument(songDocumentPath(projectId)),
				this.readCollection(clipsCollectionPath(projectId)),
				this.readCollection(
					`${projectDocumentPath(projectId)}/${ARRANGEMENT_COLLECTION}`,
				),
			]);
			const decoded = decodeProject({
				projectId,
				metadata,
				song,
				clips,
				arrangement,
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
		} catch (error) {
			return toLoadFailure(error, projectId);
		}
	}

	async loadProjectMetadata(
		projectId: ProjectId,
	): Promise<LoadResult<ProjectMetadata>> {
		try {
			const raw = await this.readDocument(projectDocumentPath(projectId));
			if (!raw) {
				return loadFailure("not_found", `Project ${projectId} does not exist`);
			}
			return toMetadataResult(projectId, raw);
		} catch (error) {
			return toLoadFailure(error, projectId);
		}
	}

	/**
	 * The dashboard query. It reads the metadata collection only — never the
	 * `song` or `clips` subcollections — so listing is independent of project
	 * size. `firestore.indexes.json` carries the composite index it needs.
	 */
	async listProjects(ownerId: string): Promise<ProjectMetadata[]> {
		let snapshot: Awaited<ReturnType<typeof getDocs>>;
		try {
			snapshot = await getDocs(
				query(
					collection(this.db, PROJECTS_COLLECTION),
					where("ownerId", "==", ownerId),
					orderBy("modifiedAt", "desc"),
				),
			);
		} catch (error) {
			// The rules reject a listing the caller is not entitled to rather than
			// filtering it, so asking for another user's projects is an empty list,
			// not an error the dashboard has to render.
			if (firestoreErrorCode(error) === "permission-denied") {
				return [];
			}
			throw error;
		}
		const summaries: ProjectMetadata[] = [];
		for (const document of snapshot.docs) {
			const decoded = toMetadataResult(
				document.id,
				document.data() as JsonObject,
			);
			// A document the current build cannot parse is skipped rather than
			// allowed to break the whole listing.
			if (decoded.ok) {
				summaries.push(decoded.value);
			}
		}
		return summaries;
	}

	async saveMetadata(
		projectId: ProjectId,
		patch: ProjectMetadataPatch,
		baseRevision: number,
	): Promise<SaveResult> {
		return this.withRevisionCheck(
			projectId,
			baseRevision,
			async () => {},
			patch,
		);
	}

	async saveSong(
		projectId: ProjectId,
		song: Song,
		baseRevision: number,
	): Promise<SaveResult> {
		return this.withRevisionCheck(
			projectId,
			baseRevision,
			async (tx, _metadata, next) => {
				const encoded = encodeSong(
					projectId,
					song,
					next.revision,
					next.modifiedAt,
				);
				const oversized = findOversizedDocuments(encoded);
				if (oversized.length > 0) {
					throw new AbortWrite(tooLarge(oversized));
				}
				// The previous song document lists the chunks it wrote, so stale
				// chunks are removed without a query inside the transaction.
				const previous = await tx.get(this.ref(songDocumentPath(projectId)));
				const previousChunks = previous.exists()
					? ((previous.data().chunkTrackIds as string[] | undefined) ?? [])
					: [];
				const keep = new Set(encoded.arrangement.map((chunk) => chunk.path));
				for (const trackId of previousChunks) {
					const path = arrangementChunkPath(projectId, trackId);
					if (!keep.has(path)) {
						tx.delete(this.ref(path));
					}
				}
				this.write(tx, encoded.song);
				for (const chunk of encoded.arrangement) {
					this.write(tx, chunk);
				}
			},
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
			async (tx, _metadata, next) => {
				const document = encodeClip(
					projectId,
					clip,
					next.revision,
					next.modifiedAt,
				);
				const bytes = estimateDocumentBytes(document.path, document.data);
				if (bytes > CLIP_DOCUMENT_BUDGET_BYTES) {
					throw new AbortWrite(
						tooLarge([
							{
								path: document.path,
								bytes,
								budgetBytes: CLIP_DOCUMENT_BUDGET_BYTES,
							},
						]),
					);
				}
				this.write(tx, document);
			},
		);
	}

	async deleteClip(
		projectId: ProjectId,
		clipId: ClipId,
		baseRevision: number,
	): Promise<SaveResult> {
		return this.withRevisionCheck(projectId, baseRevision, async (tx) => {
			tx.delete(this.ref(clipDocumentPath(projectId, clipId)));
		});
	}

	async deleteProject(projectId: ProjectId): Promise<void> {
		const paths = [
			...(await this.collectionPaths(clipsCollectionPath(projectId))),
			...(await this.collectionPaths(
				`${projectDocumentPath(projectId)}/${ARRANGEMENT_COLLECTION}`,
			)),
			songDocumentPath(projectId),
			projectDocumentPath(projectId),
		];
		// Firestore caps a batch at 500 writes, so a project with many chunks and
		// clips is deleted in batches rather than one oversized commit. The
		// metadata document is last: the rules resolve a child's owner from it.
		for (let index = 0; index < paths.length; index += BATCH_SIZE) {
			const batch = writeBatch(this.db);
			for (const path of paths.slice(index, index + BATCH_SIZE)) {
				batch.delete(this.ref(path));
			}
			await batch.commit();
		}
	}

	watchProject(
		projectId: ProjectId,
		listener: (event: ProjectWatchEvent) => void,
	): Unsubscribe {
		return onSnapshot(
			this.ref(projectDocumentPath(projectId)),
			(snapshot) => {
				if (!snapshot.exists()) {
					listener({ kind: "removed" });
					return;
				}
				const decoded = toMetadataResult(
					projectId,
					snapshot.data() as JsonObject,
				);
				listener(
					decoded.ok
						? { kind: "metadata", metadata: decoded.value }
						: { kind: "error", message: decoded.message },
				);
			},
			(error) => listener({ kind: "error", message: error.message }),
		);
	}

	// --- internals ------------------------------------------------------

	private async withRevisionCheck(
		projectId: ProjectId,
		baseRevision: number,
		mutate: (
			tx: Transaction,
			metadata: ProjectMetadata,
			next: WriteStamp,
		) => Promise<void>,
		patch: ProjectMetadataPatch = {},
	): Promise<SaveResult> {
		try {
			const outcome = await runTransaction<WriteStamp>(this.db, async (tx) => {
				const metadataRef = this.ref(projectDocumentPath(projectId));
				const snapshot = await tx.get(metadataRef);
				if (!snapshot.exists()) {
					throw new AbortWrite(
						saveFailure("not_found", `Project ${projectId} does not exist`),
					);
				}
				const decoded = toMetadataResult(
					projectId,
					snapshot.data() as JsonObject,
				);
				if (!decoded.ok) {
					throw new AbortWrite(
						saveFailure(
							decoded.reason === "unsupported_schema_version"
								? "unsupported_schema_version"
								: "invalid_document",
							decoded.message,
							{ issues: decoded.issues },
						),
					);
				}
				const metadata = decoded.value;
				if (metadata.revision !== baseRevision) {
					throw new AbortWrite(
						revisionConflict(baseRevision, metadata.revision),
					);
				}
				const next: WriteStamp = {
					revision: metadata.revision + 1,
					modifiedAt: this.clock.now(),
				};
				await mutate(tx, metadata, next);
				this.write(
					tx,
					encodeProjectMetadata({
						...metadata,
						...definedFields(patch),
						collaboratorIds: patch.collaboratorIds
							? [...patch.collaboratorIds]
							: metadata.collaboratorIds,
						revision: next.revision,
						modifiedAt: next.modifiedAt,
					}),
				);
				return next;
			});
			return { ok: true, ...outcome };
		} catch (error) {
			return toSaveFailure(error);
		}
	}

	private write(tx: Transaction, document: StoredDocument): void {
		tx.set(this.ref(document.path), document.data);
	}

	private ref(path: string) {
		const segments = path.split("/");
		return doc(this.db, segments[0], ...segments.slice(1));
	}

	private async readDocument(path: string): Promise<JsonObject | undefined> {
		const snapshot = await getDoc(this.ref(path));
		return snapshot.exists() ? (snapshot.data() as JsonObject) : undefined;
	}

	private async readCollection(path: string): Promise<JsonObject[]> {
		const snapshot = await getDocs(collection(this.db, path));
		return snapshot.docs.map((document) => document.data() as JsonObject);
	}

	private async collectionPaths(path: string): Promise<string[]> {
		const snapshot = await getDocs(collection(this.db, path));
		return snapshot.docs.map((document) => `${path}/${document.id}`);
	}
}

/** Firestore caps a batch at 500 writes; leave headroom under it. */
const BATCH_SIZE = 400;

/** The revision and modified time one write stamps across the tiers it touches. */
interface WriteStamp {
	readonly revision: number;
	readonly modifiedAt: number;
}

/** Carries a typed failure out of a Firestore transaction callback. */
class AbortWrite extends Error {
	readonly result: SaveResult;

	constructor(result: SaveResult) {
		super(result.ok ? "aborted" : result.message);
		this.name = "AbortWrite";
		this.result = result;
	}
}

function toSaveFailure(error: unknown): SaveResult {
	if (error instanceof AbortWrite) {
		return error.result;
	}
	const code = firestoreErrorCode(error);
	if (code === "permission-denied") {
		return saveFailure(
			"unavailable",
			"The current user is not allowed to write this project",
			{ retryable: false },
		);
	}
	return saveFailure("unavailable", messageOf(error));
}

function toLoadFailure<T>(error: unknown, projectId: string): LoadResult<T> {
	// Permission-denied is reported as not-found on read so the API never
	// confirms the existence of a project the caller may not see.
	return firestoreErrorCode(error) === "permission-denied"
		? loadFailure("not_found", `Project ${projectId} does not exist`)
		: loadFailure("unavailable", messageOf(error));
}

function firestoreErrorCode(error: unknown): string | undefined {
	return typeof error === "object" && error !== null && "code" in error
		? String((error as { code: unknown }).code)
		: undefined;
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function definedFields(patch: ProjectMetadataPatch): Partial<ProjectMetadata> {
	const fields: Partial<ProjectMetadata> = {};
	if (patch.name !== undefined) fields.name = patch.name;
	if (patch.template !== undefined) fields.template = patch.template;
	if (patch.genre !== undefined) fields.genre = patch.genre;
	return fields;
}

export function createFirestoreProjectRepository(
	db: Firestore,
	options: { clock?: Clock } = {},
): FirestoreProjectRepository {
	return new FirestoreProjectRepository(db, options);
}

export const FIRESTORE_COLLECTIONS = {
	projects: PROJECTS_COLLECTION,
	song: SONG_COLLECTION,
	songDocument: SONG_DOCUMENT_ID,
	clips: CLIPS_COLLECTION,
	arrangement: ARRANGEMENT_COLLECTION,
} as const;
