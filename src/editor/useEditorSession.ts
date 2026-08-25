import { type Accessor, createEffect, onCleanup } from "solid-js";
import { createStore } from "solid-js/store";
import type {
  Gesture,
  GestureOptions,
  HistorySnapshot,
  RawCommandInput,
  TransactionResult,
} from "../commands";
import type { Project } from "../domain/entities";
import type { ProjectId } from "../domain/ids";
import type { SaveStatus } from "../persistence/autosave";
import type { ProjectRepository } from "../persistence/projectRepository";
import { EditorSession } from "./EditorSession";

/**
 * Attaches the PRD `PRJ-03` navigation-flush behavior for one session: a
 * queued-but-not-yet-written edit is flushed as soon as the browser signals
 * the page might not get another chance to run, not only when this Solid
 * effect tears down (in-app route changes already get that from `onCleanup`
 * below).
 *
 * `visibilitychange` to `"hidden"` is the reliable signal across desktop and
 * mobile browsers (a background tab, an app switch, a real close all fire
 * it); `pagehide` covers the same-tab navigation/close cases some browsers
 * fire without a visibility change first. Neither can guarantee the write
 * completes before the page actually goes away — that is what "where the
 * browser permits a flush" in the PRD acknowledges — but both start it as
 * early as this code can detect the moment.
 */
function watchNavigationFlush(getSession: () => EditorSession | null): void {
  if (typeof window === "undefined") return;

  function flush(): void {
    getSession()
      ?.autosave.flush()
      .catch(() => {
        // `flush()` only rejects if the repository call itself throws
        // synchronously into the promise chain; a failed write already
        // surfaces through `SaveStatus.state === "failed"`, so there is
        // nothing further to do with the rejection here.
      });
  }

  function handleVisibilityChange(): void {
    if (document.visibilityState === "hidden") flush();
  }

  document.addEventListener("visibilitychange", handleVisibilityChange);
  window.addEventListener("pagehide", flush);
  onCleanup(() => {
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    window.removeEventListener("pagehide", flush);
  });
}

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
  /**
   * Opens a continuous edit gesture — a piano-roll note drag, a step-editor
   * paint/erase stroke, a fader/pan drag — or `undefined` before a session has
   * loaded. Every step applies live; the whole gesture commits as one history
   * entry, one revision, and one autosave (PRD `CLP-02`, `CLP-03`, `TRK-02`).
   */
  beginGesture(options?: GestureOptions): Gesture | undefined;
  undo(): TransactionResult | null | undefined;
  redo(): TransactionResult | null | undefined;
  /** The explicit retry affordance PRD `PRJ-03` requires for a failed save. */
  retry(): Promise<SaveStatus> | undefined;
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
  watchNavigationFlush(() => session);

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
    beginGesture: (options) => session?.beginGesture(options),
    undo: () => session?.undo(),
    redo: () => session?.redo(),
    retry: () => session?.autosave.retry(),
  };
}
