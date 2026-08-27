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
  /** Whether the arrangement currently has a placement selection — gates the
   * `arrangement` shortcut context, mirroring how `selection` is only added
   * while the piano roll shows a selection. Live whichever editor is mounted
   * below the arrangement, because the arrangement is on screen either way
   * (#258). */
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

  /**
   * Which surface a selection-scoped edit acts on right now (#258).
   *
   * Precedence, not visibility: the piano roll takes it while it is showing
   * *and* holds a note selection, otherwise the arrangement's placement
   * selection wins, and the step editor's lifted note selection is the last
   * resort (only while its grid is the one showing). Asking "is the piano roll
   * showing?" first is what broke Delete — that answers which editor is
   * mounted below the arrangement, not which surface the user selected in, so
   * a placement selected on a synth track was routed to a piano roll with
   * nothing selected and the keypress did nothing.
   */
  type SelectionOwner = "piano_roll" | "arrangement" | "step_editor";
  const selectionOwner = (): SelectionOwner | null => {
    if (showPianoRoll() && (pianoRollActions()?.hasSelection() ?? false)) {
      return "piano_roll";
    }
    if (hasArrangementSelection()) return "arrangement";
    if (!showPianoRoll() && selectedNoteIds().length > 0) return "step_editor";
    return null;
  };

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
    // the same way (ARR-002). Only fires when some surface's selection is
    // non-empty, so an empty-selection Delete leaves the browser default alone
    // (PRD KEY-02).
    "edit.delete": {
      run: () => {
        const owner = selectionOwner();
        if (owner === "piano_roll") pianoRollActions()?.deleteSelection();
        else if (owner === "arrangement") arrangementEditingActions()?.deleteSelection();
        else if (owner === "step_editor") deleteSelection();
      },
      isEnabled: () => selectionOwner() !== null,
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
        const owner = selectionOwner();
        if (owner === "piano_roll") pianoRollActions()?.duplicateSelection();
        else if (owner === "arrangement")
          arrangementEditingActions()?.duplicate("linked");
      },
      isEnabled: () => {
        const owner = selectionOwner();
        return owner === "piano_roll" || owner === "arrangement";
      },
    },
    "edit.select_all": {
      run: () => pianoRollActions()?.selectAll(),
      isEnabled: () => pianoRollActions() !== null,
    },
    // The arrangement's clipboard (ARR-002). Only active while the arrangement
    // itself has a selection — whichever editor is mounted below it, matching
    // `edit.delete`/`edit.duplicate` above (#258). Nothing is stolen from the
    // piano roll: it registers no cut/copy handler of its own.
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
      // Gated on the clipboard alone (#258), not on which editor is mounted
      // below the arrangement — the same term the rest of this block shed.
      // Nothing is stolen from the piano roll: it registers no clipboard
      // action of its own, so Mod+V has exactly one meaning in the editor.
      isEnabled: () => (arrangementEditingActions()?.getClipboard().length ?? 0) > 0,
    },
  });

  // The surfaces this slice actually shows. The guide filters against these,
  // so "shortcuts valid in the current context" means the editor underneath
  // rather than the modal covering it. The piano roll adds its own contexts:
  // `piano_roll` (where `edit.delete` lives) and `selection` (where
  // `edit.duplicate`/`edit.select_all` live). `arrangement` is added while the
  // arrangement holds a live placement selection, the same conditional pattern
  // `selection` already follows for the piano roll, so
  // cut/copy/paste/delete/duplicate never steal a keystroke from an editor
  // that has nothing selected.
  const editorContexts = (): readonly ShortcutContext[] => {
    const base: readonly ShortcutContext[] = showPianoRoll()
      ? ["editor", "step_editor", "piano_roll", "selection"]
      : ["editor", "step_editor"];
    // A live placement selection makes the arrangement's own mappings active
    // whichever editor is mounted below it (#258), not only when that editor
    // happens to be the step grid.
    return hasArrangementSelection() ? [...base, "arrangement"] : base;
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
