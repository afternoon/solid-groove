import {
	type Analytics,
	analytics as defaultAnalytics,
} from "../analytics/analytics";
import { bucketOf, projectAgeBucket } from "../analytics/buckets";
import { COMMAND_IDS, type CommandId } from "../analytics/catalog";
import {
	CommandHistory,
	type Gesture,
	type GestureOptions,
	type HistoryEntry,
	type HistoryListener,
	type RawCommandInput,
	type TransactionResult,
	type TransactionSuccess,
} from "../commands";
import type { Project } from "../domain/entities";
import type { ClipId } from "../domain/ids";
import {
	createProjectAutosave,
	type ProjectAutosave,
} from "../persistence/autosave";
import type { ProjectRepository } from "../persistence/projectRepository";
import { type Clock, systemClock } from "../shared/clock";
import type { Scheduler } from "../shared/scheduler";
import { markProjectOpened } from "./deviceProjectRecord";

export interface EditorSessionOptions {
	readonly repository: ProjectRepository;
	/** The project as it was loaded (or just created). */
	readonly project: Project;
	readonly clock?: Clock;
	readonly analytics?: Analytics;
	/** Forwarded to `ProjectAutosave`; tests inject a manual scheduler. */
	readonly scheduler?: Scheduler;
	readonly coalesceMs?: number;
	/**
	 * Where the `project_opened` first-open marker is recorded (PRD `OPS-02`).
	 * Tests inject an isolated store; defaults to `localStorage`.
	 */
	readonly deviceStorage?: Storage | null;
}

function isCommandId(value: string): value is CommandId {
	return (COMMAND_IDS as readonly string[]).includes(value);
}

/**
 * Combines the shared command/undo kernel with autosave and the repository's
 * remote watch for one open project (`FND-009`'s UI-to-command-to-audio-to-
 * persistence path).
 *
 * A dispatched command (or an undo/redo) applies through `CommandHistory` —
 * one revision, one history entry, deterministic inverse — and, for the note
 * commands this slice's step grid uses, queues exactly the clip document that
 * changed through `ProjectAutosave`. `ProjectAutosave.applyRemote` already
 * guarantees a stale or older remote echo can never move local state
 * backward (see `src/persistence/autosave.ts`); this class only wires the
 * repository's watch into it.
 *
 * Framework-free, like `CommandHistory` and `ProjectAutosave` themselves —
 * `src/editor/useEditorSession.ts` is what adapts it into Solid signals.
 *
 * Autosave scope is deliberately narrow: only a command whose payload names a
 * `clipId` (every note command does) queues that clip. A command that edits
 * `song` structure (tracks, placements, assets, ...) would need `queueSong`
 * too, but no such command is dispatched by this slice's UI — generalizing
 * dispatch-to-autosave for every future command family is `LOOP-002`'s fuller
 * autosave UX, not this task's.
 */
export class EditorSession {
	readonly repository: ProjectRepository;
	readonly history: CommandHistory;
	readonly autosave: ProjectAutosave;
	private readonly analytics: Analytics;
	private readonly clock: Clock;
	private readonly projectId: Project["metadata"]["id"];
	private readonly openedAt: number;
	private readonly unwatch: () => void;
	private firstEditLogged = false;
	private disposed = false;

	constructor(options: EditorSessionOptions) {
		this.repository = options.repository;
		this.clock = options.clock ?? systemClock;
		this.analytics = options.analytics ?? defaultAnalytics;
		this.projectId = options.project.metadata.id;
		this.openedAt = this.clock.now();
		this.history = new CommandHistory(options.project, { clock: this.clock });
		this.autosave = createProjectAutosave({
			repository: options.repository,
			projectId: this.projectId,
			revision: options.project.metadata.revision,
			analytics: this.analytics,
			scheduler: options.scheduler,
			coalesceMs: options.coalesceMs,
		});
		this.unwatch = options.repository.watchProject(this.projectId, (event) =>
			this.autosave.applyRemote(event),
		);
		this.logProjectOpened(options.project, options.deviceStorage);
	}

	get project(): Project {
		return this.history.project;
	}

	subscribe(listener: HistoryListener): () => void {
		return this.history.subscribe(listener);
	}

	/** Dispatches one command, or an atomic multi-command transaction. */
	dispatch(
		commands: RawCommandInput | readonly RawCommandInput[],
	): TransactionResult {
		const result = this.history.execute(commands);
		if (result.ok) {
			this.logFirstEdit(result);
			this.queueAutosave(result);
		}
		return result;
	}

	/**
	 * Opens a continuous gesture (a note drag in the piano roll, a fader drag)
	 * that commits as one history entry and one revision (PRD section 8). Each
	 * `apply` runs immediately so the UI and audio stay live; autosave is queued
	 * only when the gesture commits, so a clip is written once for the whole
	 * drag rather than on every intermediate frame.
	 *
	 * The returned gesture's `commit`/`cancel` wrap the history kernel's so
	 * callers cannot forget the autosave/first-edit side effects the way a raw
	 * `history.beginGesture()` would let them.
	 */
	beginGesture(options: GestureOptions = {}): Gesture {
		const gesture = this.history.beginGesture(options);
		const session = this;
		let touchedClips = false;
		return {
			get active() {
				return gesture.active;
			},
			apply(commands) {
				const result = gesture.apply(commands);
				if (result.ok && clipIdsOf(result).size > 0) {
					touchedClips = true;
				}
				return result;
			},
			commit(summary): HistoryEntry | null {
				const wasActive = gesture.active;
				const entry = gesture.commit(summary);
				if (entry) {
					session.logFirstEditForEntry(entry);
					session.queueAutosaveForClips(entry, touchedClips);
				} else if (wasActive && touchedClips) {
					// A gesture that applied a change and then reverted it (drag
					// back to the start) commits nothing, so there is no revision
					// to persist. Nothing to queue.
				}
				return entry;
			},
			cancel() {
				gesture.cancel();
			},
		};
	}

	/**
	 * `actor` is who invoked the undo, not who authored the entry being undone
	 * (`history.undo()` already replays the entry's own actor for that). Only
	 * `"user"` is reachable today — an assistant-invoked undo is `AI-003`'s
	 * `assistant_proposal_undone`, a distinct catalog event, not this one.
	 */
	undo(actor: "user" | "assistant" = "user"): TransactionResult | null {
		const result = this.history.undo();
		if (result?.ok) {
			this.queueAutosave(result);
			this.analytics.log("undo_used", { direction: "undo", actor });
		}
		return result;
	}

	redo(actor: "user" | "assistant" = "user"): TransactionResult | null {
		const result = this.history.redo();
		if (result?.ok) {
			this.logFirstEdit(result);
			this.queueAutosave(result);
			this.analytics.log("undo_used", { direction: "redo", actor });
		}
		return result;
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.unwatch();
		this.autosave.dispose();
		this.history.dispose();
	}

	/**
	 * `project_opened` (PRD `OPS-02`), fired once per `EditorSession` — i.e.
	 * once per actual open, not once per project like `first_edit`. Its
	 * parameters are not optional: they are what makes the section 11 1- and
	 * 7-day reopen measure computable.
	 */
	private logProjectOpened(
		project: Project,
		deviceStorage: Storage | null | undefined,
	): void {
		const ageMs = Math.max(0, this.clock.now() - project.metadata.createdAt);
		this.analytics.log("project_opened", {
			project_age_bucket: projectAgeBucket(ageMs),
			track_count_bucket: bucketOf("track_count", project.song.tracks.length),
			is_first_open: markProjectOpened(this.projectId, deviceStorage),
		});
	}

	private logFirstEdit(result: TransactionSuccess): void {
		this.logFirstEditForCommandId(result.commands[0]?.type);
	}

	/** The gesture path only has the committed entry, not a transaction. */
	private logFirstEditForEntry(entry: HistoryEntry): void {
		this.logFirstEditForCommandId(entry.commands[0]?.type);
	}

	private logFirstEditForCommandId(commandId: string | undefined): void {
		if (this.firstEditLogged) return;
		if (!commandId || !isCommandId(commandId)) return;
		this.firstEditLogged = true;
		const secondsSinceOpen = Math.max(
			0,
			(this.clock.now() - this.openedAt) / 1000,
		);
		// Once per project (never again on reload), not once per session — the
		// storage-backed `logOnce` key is scoped to the project rather than a
		// per-instance flag, since the marker must survive across reloads.
		this.analytics.logOnce(`first_edit:${this.projectId}`, "first_edit", {
			command_id: commandId,
			seconds_since_open_bucket: bucketOf("elapsed_seconds", secondsSinceOpen),
		});
	}

	/** Queues exactly the clip(s) a note command's payload names. */
	private queueAutosave(result: TransactionSuccess): void {
		this.queueClips(clipIdsOf(result));
	}

	/**
	 * Queues the clip(s) a committed gesture entry touched. `touched` guards the
	 * common case where the gesture applied no clip command at all, so a gesture
	 * that only moved UI state never queues a write.
	 */
	private queueAutosaveForClips(entry: HistoryEntry, touched: boolean): void {
		if (!touched) return;
		const clipIds = new Set<ClipId>();
		for (const command of entry.commands) {
			const clipId = clipIdOf(command.payload);
			if (clipId) clipIds.add(clipId);
		}
		this.queueClips(clipIds);
	}

	private queueClips(clipIds: ReadonlySet<ClipId>): void {
		for (const clipId of clipIds) {
			const clip = this.history.project.clips.find(
				(candidate) => candidate.id === clipId,
			);
			if (clip) {
				this.autosave.queueClip(clip);
			} else {
				this.autosave.queueClipDeletion(clipId);
			}
		}
	}
}

/** Distinct clip ids named by every command in a transaction. */
function clipIdsOf(result: {
	readonly commands: readonly { readonly payload: unknown }[];
}): ReadonlySet<ClipId> {
	const clipIds = new Set<ClipId>();
	for (const command of result.commands) {
		const clipId = clipIdOf(command.payload);
		if (clipId) clipIds.add(clipId);
	}
	return clipIds;
}

function clipIdOf(payload: unknown): ClipId | undefined {
	if (typeof payload !== "object" || payload === null) return undefined;
	const clipId = (payload as { clipId?: unknown }).clipId;
	return typeof clipId === "string" ? (clipId as ClipId) : undefined;
}

export function createEditorSession(
	options: EditorSessionOptions,
): EditorSession {
	return new EditorSession(options);
}
