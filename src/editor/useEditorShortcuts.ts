import type { Accessor } from "solid-js";
import type { PlacementEditingActions } from "../arrangement/ArrangementView";
import type { EventId } from "../domain/ids";
import { focusKeepsKey, SOUNDS_KEY_ACTIONS } from "../library/soundKeys";
import {
  type ShortcutContext,
  type ShortcutHandlers,
  shortcutLabel,
  useShortcuts,
} from "../shortcuts";
import { isTextEntry } from "../shortcuts/textEntry";
import { arrangementHasFocus } from "./arrangementFocus";
import type { EditorViewName } from "./editorViews";
import type { LibraryActions } from "./LibraryModal";
import type { PianoRollActions } from "./pianoRoll/rollActions";
import type { UseEditorSessionResult } from "./useEditorSession";
import type { ProjectAudioControls } from "./useProjectAudio";
import { focusedValueField } from "./valueFieldFocus";

export interface UseEditorShortcutsOptions {
  readonly audio: ProjectAudioControls;
  readonly session: UseEditorSessionResult;
  readonly showPianoRoll: Accessor<boolean>;
  readonly pianoRollActions: Accessor<PianoRollActions | null>;
  readonly selectedNoteIds: Accessor<readonly EventId[]>;
  readonly deleteSelection: () => void;
  /** Selects every note in the clip the step grid shows (#835): `undefined`
   * when there is no clip to select in. */
  readonly selectAllSteps: () => (() => void) | undefined;
  readonly guideOpen: Accessor<boolean>;
  readonly setGuideOpen: (open: boolean) => void;
  /** Whether the Export dialog is open (`EXP-004`): a modal, so it takes the keyboard. */
  readonly exportOpen: Accessor<boolean>;
  /** Whether the `UI-001` library modal is open, and how to close it. */
  readonly libraryOpen: Accessor<boolean>;
  readonly closeLibrary: () => void;
  /** The open library modal's actions (`LIB-010`), or null while it is closed. */
  readonly libraryActions: Accessor<LibraryActions | null>;
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
  /** Switches the editor to a view (`UI-001`), through the same path the dock
   * takes — so `1`/`2`/`3` and the dock cannot reach different states. */
  readonly selectView: (view: EditorViewName) => void;
  /** Whether the `UI-001` sequence editor is open over the current view. */
  readonly sequenceEditorOpen: () => boolean;
  readonly closeSequenceEditor: () => void;
  /** Flips whether the transport obeys the song's loop brace (`LOOP-018`),
   * through the same command path as the header's loop button. */
  readonly toggleLooping: () => void;
  /** Whether the ruler's loop brace has keyboard focus (`LOOP-018`). Turns the
   * `loop_brace` context on, so `Left`/`Right` (and their `Shift` forms) move
   * and resize the brace instead of meaning what they do elsewhere. */
  readonly loopBraceFocused: Accessor<boolean>;
  /** Move the brace by whole bars; a resize moves its end edge. Each is one
   * command through the same path as a drag. */
  readonly moveLoop: (bars: number) => void;
  readonly resizeLoop: (bars: number) => void;
  /** The track selection's `-1`/`+1` step (`track.select_previous`/`_next`):
   * `undefined` when there is no track that way (the ends, or a view where the
   * arrows keep another meaning), so the key is left to the browser. */
  readonly adjacentTrack: (by: -1 | 1) => (() => void) | undefined;
  /** Deletes the selected track (#537): `undefined` where a track is not the
   * selection (the mixer, the sequence editor, an empty project). */
  readonly deleteSelectedTrack: () => (() => void) | undefined;
  /** Drops the user's choice of track (#960), so Delete no longer removes it:
   * `undefined` while no track is chosen. Escape and any Delete that removes
   * something inside the track call it. */
  readonly dropTrackChoice: () => (() => void) | undefined;
}

/** Controls that use the vertical arrows themselves, so a track step must not
 * steal them while one has focus (text entry is already left alone). */
const OWN_ARROWS =
  'input[type="range"], [role="slider"], [role="listbox"], [role="menu"]';
const focusKeepsArrows = (): boolean =>
  document.activeElement?.matches(OWN_ARROWS) ?? false;

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
    selectAllSteps,
    guideOpen,
    setGuideOpen,
    exportOpen,
    libraryOpen,
    closeLibrary,
    libraryActions,
    arrangementEditingActions,
    hasArrangementSelection,
    selectView,
    sequenceEditorOpen,
    closeSequenceEditor,
    toggleLooping,
    loopBraceFocused,
    moveLoop,
    resizeLoop,
    adjacentTrack,
    deleteSelectedTrack,
    dropTrackChoice,
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

  /** The piano roll's operations while it is on screen, else null. */
  const roll = (): PianoRollActions | null =>
    showPianoRoll() ? pianoRollActions() : null;
  /** Whether the roll on screen has notes selected, for the note moves. */
  const rollHasSelection = (): boolean => roll()?.hasSelection() ?? false;

  /**
   * Which surface Delete acts on (#643). While the sequence editor is open its
   * note editor owns the key outright: Delete takes its selected notes or
   * steps, and with none selected does nothing, rather than reaching past it
   * to the clip or track it was opened on.
   */
  const deleteOwner = (): SelectionOwner | null => {
    if (!sequenceEditorOpen()) return selectionOwner();
    if (showPianoRoll()) return rollHasSelection() ? "piano_roll" : null;
    return selectedNoteIds().length > 0 ? "step_editor" : null;
  };
  /** A note move: enabled while the roll holds a selection (ARR-010). */
  const noteMove = (run: (actions: PianoRollActions) => void) => ({
    run: () => {
      const actions = roll();
      if (actions) run(actions);
    },
    isEnabled: rollHasSelection,
  });

  /** Whether the sequence editor is showing the step grid, not the roll. */
  const stepGridOpen = (): boolean => sequenceEditorOpen() && !showPianoRoll();

  /** Whether a clip is being dragged in the arrangement right now. */
  const arrangementDragging = (): boolean =>
    arrangementEditingActions()?.isDragging() ?? false;

  /**
   * Whether the arrangement has focus (#835): it is the view on screen (its
   * actions exist only while it is mounted), no sequence editor is open over
   * it, and focus is not in a text field, dialog or popover. Select all and
   * Escape act on its clips only then, whatever it has selected.
   */
  const arrangementFocused = (): boolean =>
    arrangementEditingActions() !== null &&
    !sequenceEditorOpen() &&
    arrangementHasFocus();

  /** Whether Escape has an arrangement selection to clear (#835). */
  const arrangementClearable = (): boolean =>
    arrangementFocused() &&
    !(arrangementEditingActions()?.isBanding() ?? false) &&
    arrangementEditingActions()?.getArrangementSelection() != null;

  /** Whether Escape has a chosen track to let go of (#960), outside a text field. */
  const trackChoiceDroppable = (): boolean =>
    dropTrackChoice() !== undefined && !isTextEntry(document.activeElement);

  // The KEY-01 registry owns every mapping; this component only says which
  // actions exist here and what they do. An action the slice does not
  // implement yet simply has no handler and never fires.
  const inLibrary = (run: (actions: LibraryActions) => void) => ({
    run: () => {
      const actions = libraryActions();
      if (actions) run(actions);
    },
    isEnabled: () => libraryActions() !== null,
  });
  // Enter and Space stand down for a focused control, which takes the key
  // itself (#860); otherwise they act on the selected sound and stop there.
  const onSelectedSound = (run: (actions: LibraryActions) => void) => ({
    ...inLibrary(run),
    isEnabled: () => libraryActions() !== null && !focusKeepsKey(),
  });

  const handlers = (): ShortcutHandlers => ({
    "transport.play_stop": { run: () => void audio.toggle() },
    // Shift+Space resumes from where playback last stopped, exactly as the
    // registry describes it — not a second play/stop toggle.
    "transport.continue": { run: () => void audio.continueFromStop() },
    "transport.metronome": { run: () => audio.toggleMetronome() },
    "transport.toggle_loop": { run: () => toggleLooping() },
    // The focused brace's keys (`LOOP-018`), live only in `loop_brace`.
    "arrangement.loop_move_earlier": { run: () => moveLoop(-1) },
    "arrangement.loop_move_later": { run: () => moveLoop(1) },
    "arrangement.loop_shorten": { run: () => resizeLoop(-1) },
    "arrangement.loop_lengthen": { run: () => resizeLoop(1) },
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
    // (PRD KEY-02). The selected track is the last resort (#537): a selection
    // of notes or clips is more specific and keeps the key, so the track goes
    // only when nothing inside it is selected.
    "edit.delete": {
      run: () => {
        const owner = deleteOwner();
        if (owner === "piano_roll") pianoRollActions()?.deleteSelection();
        else if (owner === "arrangement") arrangementEditingActions()?.deleteSelection();
        else if (owner === "step_editor") deleteSelection();
        else if (!sequenceEditorOpen()) deleteSelectedTrack()?.();
        // Removing what was selected inside a track spends the key: the next
        // Delete must not fall through to the whole track (#960).
        if (owner !== null) dropTrackChoice()?.();
      },
      isEnabled: () =>
        deleteOwner() !== null ||
        (!sequenceEditorOpen() && deleteSelectedTrack() !== undefined),
    },
    // The three views (UI-001). No `isEnabled`: a view is always reachable,
    // and asking for the one you are on is a no-op inside `selectView`.
    "view.show_arrangement": { run: () => selectView("arrangement") },
    "view.show_instrument": { run: () => selectView("instrument") },
    "view.show_mixer": { run: () => selectView("mixer") },
    // In the library, `?` lists the library's own keys rather than the guide (#813).
    "help.shortcut_guide": {
      run: () => {
        const actions = libraryActions();
        if (libraryOpen() && actions) actions.toggleKeys();
        else setGuideOpen(true);
      },
    },
    // Up/Down walk the selected track in the arrangement and instrument views.
    // Plain arrows only: Alt+Up/Down stay `device.move_*` (exact-modifier
    // matching), and a fader or list that has focus keeps its own arrows.
    "track.select_previous": {
      run: () => adjacentTrack(-1)?.(),
      isEnabled: () => !focusKeepsArrows() && adjacentTrack(-1) !== undefined,
    },
    "track.select_next": {
      run: () => adjacentTrack(1)?.(),
      isEnabled: () => !focusKeepsArrows() && adjacentTrack(1) !== undefined,
    },
    // Frames the arrangement's selection (#292), the toolbar button's twin.
    // The arrangement is on screen in every editor state, so this is live
    // whenever it has something to frame.
    "view.zoom_to_selection": {
      run: () => arrangementEditingActions()?.zoomToSelection(),
      isEnabled: () => arrangementEditingActions()?.canZoomToSelection() ?? false,
    },
    // The zoom group's twins (#494). No `isEnabled`: the actions are null while
    // no arrangement is mounted, and the handler then does nothing.
    "view.zoom_to_arrangement": {
      run: () => arrangementEditingActions()?.zoomToArrangement(),
    },
    "view.scroll_to_playhead": {
      run: () => arrangementEditingActions()?.scrollToPlayhead(),
    },
    "view.zoom_in": { run: () => arrangementEditingActions()?.zoomIn() },
    "view.zoom_out": { run: () => arrangementEditingActions()?.zoomOut() },
    // The library modal's own keys, live only in the `library` context.
    "library.all_sounds": inLibrary((a) => a.showView("all")),
    "library.favourites": inLibrary((a) => a.showView("favourites")),
    "library.browse_packs": inLibrary((a) => a.showView("packs")),
    "library.insert": onSelectedSound((a) => void a.insertSelected()),
    ...Object.fromEntries(
      SOUNDS_KEY_ACTIONS.map((id) => [id, inLibrary((a) => a.press(id))]),
    ),
    "library.audition": onSelectedSound((a) => a.press("library.audition")),
    "library.back": inLibrary((a) => a.back()),
    // Escape closes the innermost surface: the guide, then the library's keys
    // sheet (#813), then the library, then
    // the sequence editor underneath both. Nothing here compares a key — this
    // is the registry's `view.close_surface`, like every other close. A clip
    // drag in flight is innermost of all: Escape cancels it (ARR-011). The
    // sequence editor closes on Escape whichever editor it shows, and from a
    // focused Transform value field too: every dialog does (#650). Last of
    // all, with no surface open, it clears the arrangement's selection (#835).
    "view.close_surface": {
      run: () => {
        if (arrangementDragging()) arrangementEditingActions()?.cancelDrag();
        else if (guideOpen()) setGuideOpen(false);
        else if (libraryOpen()) {
          if (!libraryActions()?.closeKeys()) closeLibrary();
        } else if (sequenceEditorOpen()) closeSequenceEditor();
        else {
          arrangementEditingActions()?.clearSelection();
          // "No selection" means no track for Delete either (#960).
          dropTrackChoice()?.();
        }
      },
      // The Export dialog closes itself on Escape, and nothing beneath it should.
      isEnabled: () =>
        !exportOpen() &&
        (arrangementDragging() ||
          guideOpen() ||
          libraryOpen() ||
          sequenceEditorOpen() ||
          arrangementClearable() ||
          trackChoiceDroppable()),
    },
    // A focused Transform value field (ARR-010): ↑/↓ nudge it, in place of
    // the roll's note moves, which its context replaces.
    "value.nudge_up": {
      run: () => focusedValueField()?.nudge(1),
      isEnabled: () => focusedValueField() !== null,
    },
    "value.nudge_down": {
      run: () => focusedValueField()?.nudge(-1),
      isEnabled: () => focusedValueField() !== null,
    },
    // The piano roll's note moves (ARR-010): arrows step through the rows the
    // roll shows and through steps; Shift moves by octaves or changes length.
    "note.move_up": noteMove((actions) => actions.moveRows(-1)),
    "note.move_down": noteMove((actions) => actions.moveRows(1)),
    "note.octave_up": noteMove((actions) => actions.moveOctaves(1)),
    "note.octave_down": noteMove((actions) => actions.moveOctaves(-1)),
    "note.move_earlier": noteMove((actions) => actions.moveSteps(-1)),
    "note.move_later": noteMove((actions) => actions.moveSteps(1)),
    "note.shorten": noteMove((actions) => actions.resizeSteps(-1)),
    "note.lengthen": noteMove((actions) => actions.resizeSteps(1)),
    // The piano roll's remaining note operations, dispatched by the registry
    // (KEY-01), not by a listener the roll owns. Each is enabled only while the
    // roll is showing; duplicate additionally needs a selection.
    //
    // Cmd/Ctrl+D in the arrangement makes an *independent* copy (#493): a fork
    // the user can edit on its own. A linked copy is made by dragging a clip's
    // right edge past its end instead, so the two are different gestures and
    // neither needs a toolbar to state which will run.
    "edit.duplicate": {
      run: () => {
        const owner = selectionOwner();
        if (owner === "piano_roll") pianoRollActions()?.duplicateSelection();
        else if (owner === "arrangement")
          arrangementEditingActions()?.duplicate("independent");
      },
      isEnabled: () => {
        const owner = selectionOwner();
        return owner === "piano_roll" || owner === "arrangement";
      },
    },
    // Select all: the open piano roll's notes, as before; otherwise, with the
    // arrangement focused, every clip in the song (#835) — even with nothing
    // selected, so the browser never selects the page's text instead.
    // Select all acts on the open note editor, the roll or the step grid,
    // and otherwise on the focused arrangement's clips (#835).
    "edit.select_all": {
      run: () => {
        const actions = pianoRollActions();
        if (actions) actions.selectAll();
        else if (stepGridOpen()) selectAllSteps()?.();
        else arrangementEditingActions()?.selectAll();
      },
      isEnabled: () =>
        pianoRollActions() !== null ||
        (stepGridOpen() && selectAllSteps() !== undefined) ||
        arrangementFocused(),
    },
    // Cut and copy act on the piano roll's notes while it holds a selection
    // (ARR-010), and otherwise on the arrangement's clips (ARR-002) — whichever
    // editor is mounted below it (#258).
    "edit.cut": {
      run: () => {
        if (rollHasSelection()) roll()?.cut();
        else arrangementEditingActions()?.cut();
      },
      isEnabled: () => rollHasSelection() || hasArrangementSelection(),
    },
    "edit.copy": {
      run: () => {
        if (rollHasSelection()) roll()?.copy();
        else arrangementEditingActions()?.copy();
      },
      isEnabled: () => rollHasSelection() || hasArrangementSelection(),
    },
    "edit.paste": {
      // Copied notes paste into the roll on screen at its insert marker. Clips
      // paste at the arrangement selection's start (#292), or the playhead
      // when nothing is selected, gated on the clipboard alone (#258).
      run: () => {
        if (roll()?.hasClipboard()) roll()?.paste();
        else arrangementEditingActions()?.paste(audio.positionTicks());
      },
      isEnabled: () =>
        (roll()?.hasClipboard() ?? false) ||
        (arrangementEditingActions()?.getClipboard().length ?? 0) > 0,
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
  //
  // A point, an empty range or a held clipboard keeps it active too (#292):
  // each covers no clip, but paste still has somewhere to go. Cut clears the
  // clips it took, and a click in empty space sets a point, so gating on
  // covered clips alone left Mod+V dead after either. Every other arrangement
  // edit keeps its own `isEnabled` on covered clips, so none of them fires.
  //
  // So does the arrangement having focus (#835), where Select all has to work
  // with nothing selected at all.
  const arrangementContextLive = (): boolean => {
    const actions = arrangementEditingActions();
    return (
      hasArrangementSelection() ||
      arrangementFocused() ||
      (actions !== null &&
        (actions.getArrangementSelection() !== null || actions.getClipboard().length > 0))
    );
  };

  const editorContexts = (): readonly ShortcutContext[] => {
    // A focused value field takes the arrows from the note editors
    // (`DISJOINT_CONTEXTS`); its text keeps every other key anyway.
    const base: readonly ShortcutContext[] = focusedValueField()
      ? ["editor", "value_field"]
      : showPianoRoll()
        ? ["editor", "step_editor", "piano_roll", "selection"]
        : ["editor", "step_editor"];
    // A live placement selection makes the arrangement's own mappings active
    // whichever editor is mounted below it (#258), not only when that editor
    // happens to be the step grid.
    const withArrangement: readonly ShortcutContext[] = arrangementContextLive()
      ? [...base, "arrangement"]
      : base;
    // The sequence editor is a window over the page, but deliberately not the
    // `dialog` context: the transport, the note shortcuts and the view
    // switches all keep working while a producer programs in it (`UI-001`).
    const withSequence: readonly ShortcutContext[] = sequenceEditorOpen()
      ? [...withArrangement, "sequence_editor"]
      : withArrangement;
    const withGesture: readonly ShortcutContext[] = arrangementDragging()
      ? [...withSequence, "gesture"]
      : withSequence;
    return loopBraceFocused() ? [...withGesture, "loop_brace"] : withGesture;
  };

  // While a modal is open it is the only active context, so nothing behind it
  // can fire — including playback and selection (PRD KEY-02).
  const contexts = (): readonly ShortcutContext[] => {
    if (guideOpen() || exportOpen()) return ["dialog"];
    // The library is a modal with keys of its own, live only while it is open.
    return libraryOpen() ? ["dialog", "library"] : editorContexts();
  };

  const shortcuts = useShortcuts({ handlers, contexts });
  const keyHint = (action: Parameters<typeof shortcutLabel>[0]) =>
    shortcutLabel(action, shortcuts.platform);

  return { shortcuts, editorContexts, keyHint };
}
