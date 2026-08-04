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
	type HistoryListener,
	type RawCommandInput,
	type TransactionResult,
	type TransactionSuccess,
} from "../commands";
import type { Clip, Project } from "../domain/entities";
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
 * Autosave scope is a structural diff of the committed project against the one
 * before it (see {@link queueAutosave}): a changed `song` reference queues the
 * song tier, and each clip that was added, edited, or removed queues that clip
 * document. `LOOP-007` introduced the first UI that edits song structure
 * (tracks and the mixer), so dispatch-to-autosave had to cover the song tier
 * and multi-clip track edits, not just the single clip a note command names.
 * The same diff drives `beginGesture`'s commit path, so a piano-roll note drag
 * and a fader/pan drag share exactly one autosave mechanism.
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
		const before = this.history.project;
		const result = this.history.execute(commands);
		if (result.ok) {
			this.logFirstEdit(result);
			this.queueAutosave(result, before);
		}
		return result;
	}

	/**
	 * Opens a continuous edit gesture — a piano-roll note drag, a step-editor
	 * paint or erase stroke, a fader or pan drag — that applies each step
	 * immediately (so the UI and audio stay live) but commits as one history
	 * entry and one revision (PRD section 9.6; CLP-02 "undo groups a single drag
	 * gesture", CLP-03 for the piano roll).
	 *
	 * Autosave is deferred to `commit` and queued from a structural diff against
	 * the project as it was when the gesture began: a fader drag persists a
	 * single song write, and a stroke or note drag that touches ten steps writes
	 * the changed clip document *once*, not once per intermediate frame.
	 * `first_edit` fires for the gesture's first command. `cancel` abandons the
	 * whole gesture, so nothing is queued and nothing was persisted.
	 *
	 * The returned gesture's `commit`/`cancel` wrap the history kernel's so
	 * callers cannot forget those side effects the way a raw
	 * `history.beginGesture()` would let them.
	 */
	beginGesture(options: GestureOptions = {}): Gesture {
		const before = this.history.project;
		const gesture = this.history.beginGesture(options);
		let firstEditResult: TransactionSuccess | null = null;
		return {
			get active() {
				return gesture.active;
			},
			apply: (commands) => {
				const result = gesture.apply(commands);
				if (result.ok && !firstEditResult) firstEditResult = result;
				return result;
			},
			commit: (summary?: string) => {
				const entry = gesture.commit(summary);
				if (!entry) return entry;
				if (firstEditResult) this.logFirstEdit(firstEditResult);
				this.queueDiff(this.history.project, before);
				return entry;
			},
			cancel: () => {
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
		const before = this.history.project;
		const result = this.history.undo();
		if (result?.ok) {
			this.queueAutosave(result, before);
			this.analytics.log("undo_used", { direction: "undo", actor });
		}
		return result;
	}

	redo(actor: "user" | "assistant" = "user"): TransactionResult | null {
		const before = this.history.project;
		const result = this.history.redo();
		if (result?.ok) {
			this.logFirstEdit(result);
			this.queueAutosave(result, before);
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
		if (this.firstEditLogged) return;
		const commandId = result.commands[0]?.type;
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

	/**
	 * Queues exactly the tiers a transaction changed, by comparing the project
	 * before and after it committed.
	 *
	 * - A changed `song` reference queues the song document. `saveSong`
	 *   recomputes the metadata tier's pack-dependency list in the same
	 *   revision-checked step, so a track add/delete that drops or adds a pack
	 *   needs no separate metadata write.
	 * - A changed `metadata.addedPacks` queues a metadata patch. The shelf is the
	 *   one piece of pack state that is *maintained* rather than derived (LIB-08),
	 *   so a `pack.add` for a pack no asset uses yet changes no song and no clip —
	 *   without this branch it would never reach the repository, and the pack
	 *   would vanish on reload.
	 * - Every clip whose reference changed (added, edited) is queued, and every
	 *   clip that disappeared is queued for deletion. This is a structural diff
	 *   rather than a per-command payload scan, so it covers a note edit (one
	 *   clip changes), a track duplicate (several new clips), a track delete
	 *   (several clip deletions), and a piano-roll note drag with one path.
	 *
	 * Structural sharing makes the diff cheap: an unchanged song or clip keeps
	 * its exact object reference through the immutable edit helpers, so an edit
	 * to one track compares `false` for the song and `true` (skip) for every
	 * clip it did not touch.
	 */
	private queueAutosave(result: TransactionSuccess, before: Project): void {
		this.queueDiff(result.project, before);
	}

	private queueDiff(next: Project, before: Project): void {
		if (next.song !== before.song) {
			this.autosave.queueSong(next.song);
		}
		if (next.metadata.addedPacks !== before.metadata.addedPacks) {
			this.autosave.queueMetadata({ addedPacks: next.metadata.addedPacks });
		}
		this.queueChangedClips(next, before);
	}

	private queueChangedClips(next: Project, before: Project): void {
		if (next.clips === before.clips) return;
		const beforeById = new Map<ClipId, Clip>(
			before.clips.map((clip) => [clip.id, clip]),
		);
		for (const clip of next.clips) {
			if (beforeById.get(clip.id) !== clip) {
				this.autosave.queueClip(clip);
			}
			beforeById.delete(clip.id);
		}
		for (const clipId of beforeById.keys()) {
			this.autosave.queueClipDeletion(clipId);
		}
	}
}

export function createEditorSession(
	options: EditorSessionOptions,
): EditorSession {
	return new EditorSession(options);
}
