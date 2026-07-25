import type { Clip, ProjectMetadata, Song } from "../domain/entities";
import type { ClipId, ProjectId } from "../domain/ids";
import {
	type CancelScheduled,
	type Scheduler,
	timeoutScheduler,
} from "../shared/scheduler";
import type {
	ProjectMetadataPatch,
	ProjectRepository,
	ProjectWatchEvent,
	SaveFailure,
	SaveResult,
} from "./projectRepository";

/**
 * Optimistic autosave (PRJ-03).
 *
 * Local state is authoritative while the user is editing. This controller sits
 * between the edited state and the repository and owns four behaviors:
 *
 * - **Coalescing.** Repeated edits to the same entity collapse to one queued
 *   write, so dragging a slider or typing a name produces a single document
 *   write with the final value rather than one per frame.
 * - **Revision checks.** Every write states the revision it was made against;
 *   the repository refuses a stale one, so a slow tab cannot clobber newer state.
 * - **Retryable local state.** A failed write stays queued with its value, and
 *   the status carries the failure. `retry()` or the next edit tries again;
 *   nothing is silently dropped.
 * - **Echo rejection.** A remote snapshot at or below the local revision, or
 *   one that arrives while a local edit is still queued, is ignored rather than
 *   applied over newer local state.
 *
 * It has no SolidJS dependency: `subscribe` is a plain listener that a provider
 * can adapt into a signal.
 */

export type SaveState = "idle" | "pending" | "saving" | "saved" | "failed";

export interface SaveStatus {
	readonly state: SaveState;
	/** The revision the last acknowledged write produced. */
	readonly revision: number;
	/** Entities queued but not yet written. */
	readonly pending: number;
	readonly lastSavedAt: number | null;
	readonly failure: SaveFailure | null;
}

export type RemoteOutcome =
	| "adopted"
	| "ignored_stale"
	| "ignored_local_pending"
	| "removed"
	| "error";

export interface AutosaveOptions {
	repository: ProjectRepository;
	projectId: ProjectId;
	/** The revision the loaded project is at. */
	revision: number;
	/** How long rapid edits are collected before one write. */
	coalesceMs?: number;
	scheduler?: Scheduler;
	onStatus?: (status: SaveStatus) => void;
	/** Called when a remote snapshot is newer than local state and adopted. */
	onRemoteMetadata?: (metadata: ProjectMetadata) => void;
}

type PendingEntry =
	| { kind: "song"; song: Song }
	| { kind: "clip"; clip: Clip }
	| { kind: "clipDeletion"; clipId: ClipId }
	| { kind: "metadata"; patch: ProjectMetadataPatch };

const DEFAULT_COALESCE_MS = 400;

export class ProjectAutosave {
	private readonly repository: ProjectRepository;
	private readonly projectId: ProjectId;
	private readonly coalesceMs: number;
	private readonly scheduler: Scheduler;
	private readonly listeners = new Set<(status: SaveStatus) => void>();
	private readonly onRemoteMetadata?: (metadata: ProjectMetadata) => void;
	/**
	 * Keyed so a second edit to the same entity replaces the first. Insertion
	 * order is preserved, so writes go out in the order the user made them.
	 */
	private readonly queue = new Map<string, PendingEntry>();

	private revision: number;
	private state: SaveState = "idle";
	private failure: SaveFailure | null = null;
	private lastSavedAt: number | null = null;
	private cancelScheduled: CancelScheduled | null = null;
	private inFlight: Promise<void> | null = null;
	private disposed = false;

	constructor(options: AutosaveOptions) {
		this.repository = options.repository;
		this.projectId = options.projectId;
		this.revision = options.revision;
		this.coalesceMs = options.coalesceMs ?? DEFAULT_COALESCE_MS;
		this.scheduler = options.scheduler ?? timeoutScheduler;
		this.onRemoteMetadata = options.onRemoteMetadata;
		if (options.onStatus) {
			this.listeners.add(options.onStatus);
		}
	}

	get status(): SaveStatus {
		return {
			state: this.state,
			revision: this.revision,
			pending: this.queue.size,
			lastSavedAt: this.lastSavedAt,
			failure: this.failure,
		};
	}

	subscribe(listener: (status: SaveStatus) => void): () => void {
		this.listeners.add(listener);
		listener(this.status);
		return () => this.listeners.delete(listener);
	}

	queueSong(song: Song): void {
		this.enqueue("song", { kind: "song", song });
	}

	queueClip(clip: Clip): void {
		this.enqueue(`clip:${clip.id}`, { kind: "clip", clip });
	}

	queueClipDeletion(clipId: ClipId): void {
		this.enqueue(`clip:${clipId}`, { kind: "clipDeletion", clipId });
	}

	queueMetadata(patch: ProjectMetadataPatch): void {
		const existing = this.queue.get("metadata");
		const merged =
			existing?.kind === "metadata" ? { ...existing.patch, ...patch } : patch;
		this.enqueue("metadata", { kind: "metadata", patch: merged });
	}

	/**
	 * Writes everything queued right now. Call it from a `pagehide`/`beforeunload`
	 * handler so the final value survives navigation where the browser allows it.
	 */
	async flush(): Promise<SaveStatus> {
		this.cancelPending();
		if (this.inFlight) {
			await this.inFlight;
		}
		if (this.queue.size > 0 && !this.disposed) {
			this.inFlight = this.drain();
			await this.inFlight;
			this.inFlight = null;
		}
		return this.status;
	}

	/** Retries after a failure, keeping the queued values. */
	async retry(): Promise<SaveStatus> {
		return this.flush();
	}

	/**
	 * Applies a remote snapshot, or explains why it was ignored. A snapshot at or
	 * below the local revision is this client's own echo; one that arrives while
	 * a local edit is queued would overwrite an edit the user can still see.
	 */
	applyRemote(event: ProjectWatchEvent): RemoteOutcome {
		if (event.kind === "removed") {
			return "removed";
		}
		if (event.kind === "error") {
			return "error";
		}
		if (event.metadata.revision <= this.revision) {
			return "ignored_stale";
		}
		if (this.queue.size > 0 || this.state === "saving") {
			return "ignored_local_pending";
		}
		this.revision = event.metadata.revision;
		this.onRemoteMetadata?.(event.metadata);
		this.publish();
		return "adopted";
	}

	dispose(): void {
		this.disposed = true;
		this.cancelPending();
		this.listeners.clear();
	}

	private enqueue(key: string, entry: PendingEntry): void {
		if (this.disposed) return;
		this.queue.set(key, entry);
		this.state = "pending";
		this.publish();
		this.schedule();
	}

	private schedule(): void {
		this.cancelPending();
		this.cancelScheduled = this.scheduler.schedule(() => {
			this.cancelScheduled = null;
			void this.flush();
		}, this.coalesceMs);
	}

	private cancelPending(): void {
		this.cancelScheduled?.();
		this.cancelScheduled = null;
	}

	private async drain(): Promise<void> {
		this.state = "saving";
		this.failure = null;
		this.publish();

		while (this.queue.size > 0 && !this.disposed) {
			const [key, entry] = [...this.queue.entries()][0];
			const result = await this.write(entry);
			if (!result.ok) {
				// The entry stays queued with its value so a retry — or the browser
				// coming back online — can write exactly what the user last saw.
				this.failure = result;
				this.state = "failed";
				this.publish();
				return;
			}
			this.queue.delete(key);
			this.revision = result.revision;
			this.lastSavedAt = result.modifiedAt;
		}

		if (!this.disposed) {
			this.state = "saved";
			this.publish();
		}
	}

	private write(entry: PendingEntry): Promise<SaveResult> {
		switch (entry.kind) {
			case "song":
				return this.repository.saveSong(
					this.projectId,
					entry.song,
					this.revision,
				);
			case "clip":
				return this.repository.saveClip(
					this.projectId,
					entry.clip,
					this.revision,
				);
			case "clipDeletion":
				return this.repository.deleteClip(
					this.projectId,
					entry.clipId,
					this.revision,
				);
			case "metadata":
				return this.repository.saveMetadata(
					this.projectId,
					entry.patch,
					this.revision,
				);
		}
	}

	private publish(): void {
		const status = this.status;
		for (const listener of this.listeners) {
			listener(status);
		}
	}
}

export function createProjectAutosave(
	options: AutosaveOptions,
): ProjectAutosave {
	return new ProjectAutosave(options);
}
