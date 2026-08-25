import type { Accessor } from "solid-js";
import type { PlacementEditingActions } from "../arrangement/ArrangementView";
import type { EventId } from "../domain/ids";
import {
  type ShortcutContext,
  type ShortcutHandlers,
  shortcutLabel,
  useShortcuts,
} from "../shortcuts";
import type { PianoRollActions } from "./PianoRoll";
import type { UseEditorSessionResult } from "./useEditorSession";
import type { ProjectAudioControls } from "./useProjectAudio";

export interface UseEditorShortcutsOptions {
  readonly audio: ProjectAudioControls;
  readonly session: UseEditorSessionResult;
  readonly showPianoRoll: Accessor<boolean>;
  readonly pianoRollActions: Accessor<PianoRollActions | null>;
  readonly selectedNoteIds: Accessor<readonly EventId[]>;
  readonly deleteSelection: () => void;
  readonly guideOpen: Accessor<boolean>;
  readonly setGuideOpen: (open: boolean) => void;
  readonly packBrowserOpen: Accessor<boolean>;
  /** The arrangement's placement-editing operations (ARR-002), lifted from
   * `ArrangementView` the same way `pianoRollActions` is lifted from the
   * piano roll. */
  readonly arrangementEditingActions: Accessor<PlacementEditingActions | null>;
  /** Whether the arrangement (not the piano roll) currently has a placement
   * selection — gates the `arrangement` shortcut context, mirroring how
   * `selection` is only added while the piano roll shows a selection. */
  readonly hasArrangementSelection: () => boolean;
}

/**
 * Installs the editor's PRD `KEY-01` shortcut mapping: which actions this
 * slice implements, what each does, and which contexts are active.
 *
 * Split out of `EditorView` (`REFACTOR-001`) as a plain function of the same
 * dependencies `EditorView` already held (audio controls, session, the piano
 * roll's lifted state, the guide/pack-browser open signals) — not a
 * registration seam a panel contributes to. The issue's suggested "panel
 * registers its own context/handlers" seam would need each panel to publish
 * handlers the shortcut controller aggregates, which is a real architecture
 * change (today nothing but `EditorView` calls `useShortcuts`, and every
 * handler here reaches into state — `pianoRollActions`, `selectedNoteIds` —
 * that is lifted to this level for exactly that reason). Building that
 * speculatively, with only one consumer, risks the "growing inline ladder"
 * this refactor exists to avoid in a different way. This module is still the
 * complete answer to "touches the parent only at a small seam": a future
 * panel's shortcut needs land here, in one file, instead of inside
 * `EditorView.tsx` itself.
 */
export function useEditorShortcuts(options: UseEditorShortcutsOptions) {
  const {
    audio,
    session,
    showPianoRoll,
    pianoRollActions,
    selectedNoteIds,
    deleteSelection,
    guideOpen,
    setGuideOpen,
    packBrowserOpen,
    arrangementEditingActions,
    hasArrangementSelection,
  } = options;

  // The KEY-01 registry owns every mapping; this component only says which
  // actions exist here and what they do. An action the slice does not
  // implement yet simply has no handler and never fires.
  const handlers = (): ShortcutHandlers => ({
    "transport.play_stop": { run: () => void audio.toggle() },
    // Shift+Space resumes from where playback last stopped, exactly as the
    // registry describes it — not a second play/stop toggle.
    "transport.continue": { run: () => void audio.continueFromStop() },
    "transport.metronome": { run: () => audio.toggleMetronome() },
    "edit.undo": {
      run: () => session.undo(),
      isEnabled: () => session.state.canUndo,
    },
    "edit.redo": {
      run: () => session.redo(),
      isEnabled: () => session.state.canRedo,
    },
    // Delete the selected notes/placements of whichever surface currently owns
    // a selection: the piano roll keeps its own and hands the operation up
    // through `registerActions` (CLP-03), the step editor's is lifted into this
    // component (CLP-02), and the arrangement's placement selection is lifted
    // the same way (ARR-002). Each only fires when its own selection is
    // non-empty, so an empty-selection Delete leaves the browser default alone
    // (PRD KEY-02).
    "edit.delete": {
      run: () => {
        if (showPianoRoll()) pianoRollActions()?.deleteSelection();
        else if (hasArrangementSelection())
          arrangementEditingActions()?.deleteSelection();
        else deleteSelection();
      },
      isEnabled: () =>
        showPianoRoll()
          ? (pianoRollActions()?.hasSelection() ?? false)
          : hasArrangementSelection() || selectedNoteIds().length > 0,
    },
    "help.shortcut_guide": { run: () => setGuideOpen(true) },
    "view.close_surface": {
      run: () => setGuideOpen(false),
      isEnabled: () => guideOpen(),
    },
    // The piano roll's remaining note operations, dispatched by the registry
    // (KEY-01), not by a listener the roll owns. Each is enabled only while the
    // roll is showing; duplicate additionally needs a selection.
    //
    // The arrangement branch defaults a bare Cmd/Ctrl+D to a *linked*
    // duplicate rather than leaving it unimplemented. CLP-01's whole point is
    // that "reuse vs. independent variation" must be an explicit choice, not a
    // silent guess — but the registry's own `edit.duplicate` entry declares
    // `ableton: { kind: "follows" }`, and Ableton Live's own Ctrl/Cmd+D always
    // performs its linked-style duplicate with no second prompt. Matching that
    // documented parity is a defensible default; a user who wants the
    // independent copy has the two explicit `PlacementToolbar` buttons
    // (CLP-01's actual UI requirement) right above the arrangement.
    "edit.duplicate": {
      run: () => {
        if (showPianoRoll()) pianoRollActions()?.duplicateSelection();
        else if (hasArrangementSelection())
          arrangementEditingActions()?.duplicate("linked");
      },
      isEnabled: () =>
        showPianoRoll()
          ? (pianoRollActions()?.hasSelection() ?? false)
          : hasArrangementSelection(),
    },
    "edit.select_all": {
      run: () => pianoRollActions()?.selectAll(),
      isEnabled: () => pianoRollActions() !== null,
    },
    // The arrangement's clipboard (ARR-002). Only active while the arrangement
    // itself has a selection and the piano roll is not showing, matching
    // `edit.delete`/`edit.duplicate` above.
    "edit.cut": {
      run: () => arrangementEditingActions()?.cut(),
      isEnabled: () => hasArrangementSelection(),
    },
    "edit.copy": {
      run: () => arrangementEditingActions()?.copy(),
      isEnabled: () => hasArrangementSelection(),
    },
    "edit.paste": {
      // Pastes at the live playhead position, the same anchor most DAWs use
      // with no explicit target selected.
      run: () => arrangementEditingActions()?.paste(audio.positionTicks()),
      isEnabled: () =>
        !showPianoRoll() && (arrangementEditingActions()?.getClipboard().length ?? 0) > 0,
    },
  });

  // The surfaces this slice actually shows. The guide filters against these,
  // so "shortcuts valid in the current context" means the editor underneath
  // rather than the modal covering it. The piano roll adds its own contexts:
  // `piano_roll` (where `edit.delete` lives) and `selection` (where
  // `edit.duplicate`/`edit.select_all` live). `arrangement` is added only
  // while the arrangement plausibly has focus — a live placement selection —
  // the same conditional pattern `selection` already follows for the piano
  // roll, so cut/copy/paste/delete/duplicate never steal a keystroke from an
  // editor that has nothing selected.
  const editorContexts = (): readonly ShortcutContext[] => {
    if (showPianoRoll()) {
      return ["editor", "step_editor", "piano_roll", "selection"];
    }
    return hasArrangementSelection()
      ? ["editor", "step_editor", "arrangement"]
      : ["editor", "step_editor"];
  };

  // While a modal is open it is the only active context, so nothing behind it
  // can fire — including playback and selection (PRD KEY-02). The pack browser
  // is a modal surface like the guide, so it takes the keyboard the same way.
  const contexts = (): readonly ShortcutContext[] =>
    guideOpen() || packBrowserOpen() ? ["dialog"] : editorContexts();

  const shortcuts = useShortcuts({ handlers, contexts });
  const keyHint = (action: Parameters<typeof shortcutLabel>[0]) =>
    shortcutLabel(action, shortcuts.platform);

  return { shortcuts, editorContexts, keyHint };
}
