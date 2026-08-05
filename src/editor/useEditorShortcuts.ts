import type { Accessor } from "solid-js";
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
		// Delete the selected notes of whichever note editor is showing: the piano
		// roll keeps its own selection and hands the operation up through
		// `registerActions` (CLP-03), the step editor's is lifted into this
		// component (CLP-02). Either way it only fires when that selection is
		// non-empty, so an empty-selection Delete leaves the browser default alone
		// (PRD KEY-02).
		"edit.delete": {
			run: () => {
				if (showPianoRoll()) pianoRollActions()?.deleteSelection();
				else deleteSelection();
			},
			isEnabled: () =>
				showPianoRoll()
					? (pianoRollActions()?.hasSelection() ?? false)
					: selectedNoteIds().length > 0,
		},
		"help.shortcut_guide": { run: () => setGuideOpen(true) },
		"view.close_surface": {
			run: () => setGuideOpen(false),
			isEnabled: () => guideOpen(),
		},
		// The piano roll's remaining note operations, dispatched by the registry
		// (KEY-01), not by a listener the roll owns. Each is enabled only while the
		// roll is showing; duplicate additionally needs a selection.
		"edit.duplicate": {
			run: () => pianoRollActions()?.duplicateSelection(),
			isEnabled: () => pianoRollActions()?.hasSelection() ?? false,
		},
		"edit.select_all": {
			run: () => pianoRollActions()?.selectAll(),
			isEnabled: () => pianoRollActions() !== null,
		},
	});

	// The surfaces this slice actually shows. The guide filters against these,
	// so "shortcuts valid in the current context" means the editor underneath
	// rather than the modal covering it. The piano roll adds its own contexts:
	// `piano_roll` (where `edit.delete` lives) and `selection` (where
	// `edit.duplicate`/`edit.select_all` live).
	const editorContexts = (): readonly ShortcutContext[] =>
		showPianoRoll()
			? ["editor", "step_editor", "piano_roll", "selection"]
			: ["editor", "step_editor"];

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
