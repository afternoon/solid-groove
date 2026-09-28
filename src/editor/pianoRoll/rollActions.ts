import type { Analytics } from "../../analytics/analytics";
import type { NoteEditOperation } from "../../analytics/catalog";
import type { RawCommandInput, TransactionResult } from "../../commands";
import { addNotes, duplicateNotes, removeNotes, updateNotes } from "../../commands";
import type { Clip, NoteEvent, Project } from "../../domain/entities";
import type { EventId, IdFactory } from "../../domain/ids";
import { TICKS_PER_SIXTEENTH } from "../../domain/time";
import {
  endOfNotes,
  moveNotes,
  moveOctaves,
  type NoteUpdate,
  pastedNotes,
  pitchOf,
  resizeEnds,
} from "./edits";
import type { PianoRollRow } from "./rows";

/**
 * The roll's keyboard operations, handed to its host so the shortcut
 * registry, not the roll, owns every key (see `docs/shortcuts.md`). Each acts
 * on the selection; `has*` are what a handler's `isEnabled` reads.
 */
export interface PianoRollActions {
  deleteSelection(): void;
  /** Cmd/Ctrl+D: copies of the selection straight after it, as Ableton does. */
  duplicateSelection(): void;
  selectAll(): void;
  clearSelection(): void;
  hasSelection(): boolean;
  /** By visible rows, so in a scale by scale degree; up is negative. */
  moveRows(delta: number): void;
  moveOctaves(delta: number): void;
  moveSteps(delta: number): void;
  resizeSteps(delta: number): void;
  copy(): void;
  cut(): void;
  /** At the insert marker, pitches kept. */
  paste(): void;
  hasClipboard(): boolean;
}

export interface RollActionsHost {
  readonly clip: () => Clip;
  readonly project: () => Project;
  readonly notes: () => readonly NoteEvent[];
  readonly rows: () => readonly PianoRollRow[];
  readonly selected: () => ReadonlySet<EventId>;
  setSelection(ids: ReadonlySet<EventId>): void;
  readonly marker: () => number;
  setMarker(step: number): void;
  dispatch(
    commands: RawCommandInput | readonly RawCommandInput[],
  ): TransactionResult | undefined;
  audition(pitch: number, velocity: number): void;
  readonly analytics: () => Analytics;
  readonly ids: IdFactory;
  /** Logs one completed edit touching `count` notes. */
  onEdited(count: number): void;
}

/**
 * Copied notes, shared by every roll so a copy in one clip pastes into
 * another. Session-only: it is a view convenience, never project state.
 */
let clipboard: readonly NoteEvent[] = [];

const toStep = (ticks: number) => Math.ceil(ticks / TICKS_PER_SIXTEENTH);

export function createRollActions(host: RollActionsHost): PianoRollActions {
  const selectedNotes = () => host.notes().filter((note) => host.selected().has(note.id));

  /** Dispatches an edit, reporting a refusal as `note_edit_failed`. */
  function edit(
    command: RawCommandInput,
    count: number,
    operation: NoteEditOperation | null,
  ) {
    const result = host.dispatch(command);
    if (result && !result.ok) {
      if (operation) {
        host.analytics().log("note_edit_failed", {
          operation,
          error_code: "command_rejected",
        });
      }
      return false;
    }
    host.onEdited(count);
    return true;
  }

  /** Applies a batch of note changes, if it changes anything at all. */
  function update(
    updates: readonly NoteUpdate[],
    notes: readonly NoteEvent[],
    play: boolean,
  ) {
    const changed = updates.some((update) => {
      const note = notes.find((candidate) => candidate.id === update.eventId);
      return (
        note &&
        Object.entries(update.changes).some(
          ([key, value]) =>
            JSON.stringify(note[key as keyof NoteEvent]) !== JSON.stringify(value),
        )
      );
    });
    if (!changed) return;
    if (edit(updateNotes(host.clip().id, updates), updates.length, "nudge") && play) {
      const trigger = updates[0].changes.trigger;
      if (trigger?.kind === "pitch") host.audition(trigger.pitch, notes[0].velocity);
    }
  }

  function remove(notes: readonly NoteEvent[]): void {
    if (notes.length === 0) return;
    // A removal of notes that exist cannot be refused, so it reports nothing.
    edit(
      removeNotes(
        host.clip().id,
        notes.map((note) => note.id),
      ),
      notes.length,
      null,
    );
    host.setSelection(new Set());
  }

  function copy(): void {
    const notes = selectedNotes();
    if (notes.length === 0) return;
    clipboard = notes;
    host.setMarker(toStep(endOfNotes(notes)));
    host.analytics().logFeatureFirstUse("note_clipboard");
  }

  return {
    deleteSelection: () => remove(selectedNotes()),
    duplicateSelection() {
      const notes = selectedNotes();
      if (notes.length === 0) return;
      const start = Math.min(...notes.map((note) => note.startTicks));
      const span = endOfNotes(notes) - start;
      const command = duplicateNotes(host.ids, host.project(), {
        clipId: host.clip().id,
        eventIds: notes.map((note) => note.id),
        offsetTicks: span,
      });
      if (!edit(command, notes.length, "double")) return;
      host.setSelection(new Set(command.payload.newIds));
      host.setMarker(toStep(endOfNotes(notes) + span));
    },
    selectAll: () => host.setSelection(new Set(host.notes().map((note) => note.id))),
    clearSelection: () => host.setSelection(new Set()),
    hasSelection: () => selectedNotes().length > 0,
    moveRows(delta) {
      const notes = selectedNotes();
      update(
        moveNotes(notes, 0, delta, host.rows(), host.clip().lengthTicks),
        notes,
        true,
      );
    },
    moveOctaves(delta) {
      const notes = selectedNotes();
      update(moveOctaves(notes, delta), notes, true);
    },
    moveSteps(delta) {
      const notes = selectedNotes();
      update(
        moveNotes(notes, delta, 0, host.rows(), host.clip().lengthTicks),
        notes,
        false,
      );
    },
    resizeSteps(delta) {
      const notes = selectedNotes();
      update(resizeEnds(notes, delta, host.clip().lengthTicks), notes, false);
    },
    copy,
    cut() {
      copy();
      remove(selectedNotes());
    },
    paste() {
      const at = host.marker() * TICKS_PER_SIXTEENTH;
      const ids = clipboard.map(() => host.ids("event"));
      const pasted = pastedNotes(clipboard, at, host.clip().lengthTicks, ids);
      if (pasted.length === 0) return;
      host.analytics().logFeatureFirstUse("note_clipboard");
      if (!edit(addNotes(host.clip().id, pasted), pasted.length, "paste")) return;
      host.setSelection(new Set(pasted.map((note) => note.id)));
      host.setMarker(toStep(endOfNotes(pasted)));
      host.audition(pitchOf(pasted[0]), pasted[0].velocity);
    },
    hasClipboard: () => clipboard.length > 0,
  };
}

/** Test seam: empties the shared clipboard between tests. */
export function clearNoteClipboardForTest(): void {
  clipboard = [];
}
