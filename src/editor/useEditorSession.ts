import { type Accessor, createEffect, onCleanup } from "solid-js";
import { createStore } from "solid-js/store";
import type {
	HistorySnapshot,
	RawCommandInput,
	TransactionResult,
} from "../commands";
import type { Project } from "../domain/entities";
import type { ProjectId } from "../domain/ids";
import type { SaveStatus } from "../persistence/autosave";
import type { ProjectRepository } from "../persistence/projectRepository";
import { EditorSession } from "./EditorSession";

export interface EditorSessionState {
	readonly loading: boolean;
	readonly notFound: boolean;
	readonly error: string | null;
	readonly project: Project | null;
	readonly canUndo: boolean;
	readonly canRedo: boolean;
	readonly undoSummary: string | null;
	readonly redoSummary: string | null;
	readonly saveStatus: SaveStatus | null;
}

export interface UseEditorSessionResult {
	readonly state: EditorSessionState;
	dispatch(
		commands: RawCommandInput | readonly RawCommandInput[],
	): TransactionResult | undefined;
	undo(): TransactionResult | null | undefined;
	redo(): TransactionResult | null | undefined;
}

const INITIAL_STATE: EditorSessionState = {
	loading: true,
	notFound: false,
	error: null,
	project: null,
	canUndo: false,
	canRedo: false,
	undoSummary: null,
	redoSummary: null,
	saveStatus: null,
};

/**
 * Loads a schema-v1 project and adapts an `EditorSession` into Solid state
 * (`FND-009`).
 *
 * Re-runs whenever `projectId()` or `repository()` changes, tearing down the
 * previous session first: any debounced autosave write in flight is flushed
 * before disposal, exactly like the prototype `useProject`'s
 * `flushPendingWrite` did, so a coalesced edit made just before navigating
 * away is never dropped.
 */
export function useEditorSession(
	projectId: Accessor<string>,
	repository: Accessor<ProjectRepository | null>,
): UseEditorSessionResult {
	const [state, setState] = createStore<EditorSessionState>({
		...INITIAL_STATE,
	});
	let session: EditorSession | null = null;

	createEffect(() => {
		const id = projectId();
		const repo = repository();

		setState({ ...INITIAL_STATE, loading: true });
		session = null;

		let cancelled = false;
		let localSession: EditorSession | null = null;
		let unsubscribeHistory: (() => void) | null = null;
		let unsubscribeSave: (() => void) | null = null;

		function applySnapshot(snapshot: HistorySnapshot): void {
			setState({
				loading: false,
				notFound: false,
				error: null,
				project: snapshot.project,
				canUndo: snapshot.canUndo,
				canRedo: snapshot.canRedo,
				undoSummary: snapshot.undoSummary,
				redoSummary: snapshot.redoSummary,
			});
		}

		if (repo) {
			repo.loadProject(id as ProjectId).then((result) => {
				if (cancelled) return;
				if (!result.ok) {
					setState({
						loading: false,
						notFound: result.reason === "not_found",
						error:
							result.reason === "not_found"
								? null
								: "Something went wrong while loading this project.",
					});
					return;
				}
				localSession = new EditorSession({
					repository: repo,
					project: result.value,
				});
				session = localSession;
				unsubscribeHistory = localSession.subscribe(applySnapshot);
				unsubscribeSave = localSession.autosave.subscribe((status) =>
					setState((previous) => ({ ...previous, saveStatus: status })),
				);
				applySnapshot(localSession.history.snapshot());
			});
		}

		onCleanup(() => {
			cancelled = true;
			unsubscribeHistory?.();
			unsubscribeSave?.();
			if (localSession) {
				const disposing = localSession;
				void disposing.autosave.flush().finally(() => disposing.dispose());
			}
			if (session === localSession) {
				session = null;
			}
		});
	});

	return {
		state: state as EditorSessionState,
		dispatch: (commands) => session?.dispatch(commands),
		undo: () => session?.undo(),
		redo: () => session?.redo(),
	};
}
