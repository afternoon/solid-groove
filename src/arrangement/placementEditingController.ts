/**
 * The arrangement's placement-editing controller (`ARR-002`; PRD CLP-01,
 * ARR-01).
 *
 * Framework-free, like `arrangementShell.ts` beside it: it owns the transient
 * state a placement gesture needs — selection, the drag in flight, the
 * clipboard — and turns pointer/keyboard intent into the pure operations in
 * `placementGeometry`/`placementDuplication`/`placementClipboard`. It never
 * mutates a project; every operation goes to the `dispatch` the editor session
 * supplies, so each gesture is one transaction, one revision, one undo entry.
 * A drag applies through a `Gesture` when available, so dragging across ten
 * bars still commits as a single entry (PRD 9.6).
 *
 * Selection lives here rather than in the shell because the shell's
 * `ArrangementSelection` is the ARR-01 *bar range* — a span of time you loop or
 * zoom to — whereas placement editing selects *entities* by ID.
 */

import type { Analytics } from "../analytics/analytics";
import type { RawCommandInput } from "../commands/types";
import type { Project } from "../domain/entities";
import type { IdFactory, PlacementId } from "../domain/ids";
import {
  copyPlacements,
  cutPlacements,
  type PlacementClipboardEntry,
  pastePlacements,
} from "./placementClipboard";
import {
  type DuplicateMode,
  describeDuplicate,
  duplicatePlacement,
} from "./placementDuplication";
import {
  deletePlacements,
  movePlacement,
  resizePlacement,
  setPlacementLooped,
} from "./placementGeometry";

/** Applies commands as one transaction; returns whether anything landed. */
export type DispatchCommands = (commands: readonly RawCommandInput[]) => void;

/** Opens a continuous gesture, or returns undefined when none is available. */
export interface EditingGesture {
  apply(commands: readonly RawCommandInput[]): void;
  commit(summary?: string): void;
  cancel(): void;
}

export interface PlacementEditingOptions {
  readonly getProject: () => Project | null;
  readonly dispatch: DispatchCommands;
  readonly beginGesture?: (summary: string) => EditingGesture | undefined;
  readonly ids: IdFactory;
  readonly analytics?: Analytics;
  /** Notified whenever selection, drag, or clipboard state changes. */
  readonly onChange?: () => void;
}

/** A drag in flight: which placement, which edge (or body), and its gesture. */
interface DragState {
  readonly placementId: PlacementId;
  readonly handle: "start" | "end" | "body";
  /** Ticks between the pointer and the placement's start. */
  readonly grabOffsetTicks: number;
  readonly gesture: EditingGesture | undefined;
  applied: boolean;
}

export function createPlacementEditing(options: PlacementEditingOptions) {
  let selected: readonly PlacementId[] = [];
  let clipboard: readonly PlacementClipboardEntry[] = [];
  let drag: DragState | null = null;

  function changed(): void {
    options.onChange?.();
  }

  function project(): Project | null {
    return options.getProject();
  }

  /** Runs an operation as one transaction, ignoring an empty command list. */
  function run(commands: readonly RawCommandInput[]): boolean {
    if (commands.length === 0) return false;
    options.dispatch(commands);
    return true;
  }

  // --- Selection ------------------------------------------------------------

  function select(placementId: PlacementId, additive = false): void {
    selected = additive
      ? selected.includes(placementId)
        ? selected.filter((id) => id !== placementId)
        : [...selected, placementId]
      : [placementId];
    changed();
  }

  function clearSelection(): void {
    if (selected.length === 0) return;
    selected = [];
    changed();
  }

  /** Drops selected IDs the project no longer contains (e.g. after an undo). */
  function reconcile(): void {
    const current = project();
    if (!current) return;
    const live = new Set(current.song.placements.map((p) => p.id));
    const next = selected.filter((id) => live.has(id));
    if (next.length === selected.length) return;
    selected = next;
    changed();
  }

  // --- Drag: move and resize ------------------------------------------------

  function beginDrag(
    placementId: PlacementId,
    handle: "start" | "end" | "body",
    pointerTicks: number,
  ): void {
    const current = project();
    const placement = current?.song.placements.find(
      (candidate) => candidate.id === placementId,
    );
    if (!placement) return;
    if (!selected.includes(placementId)) select(placementId);
    drag = {
      placementId,
      handle,
      grabOffsetTicks: pointerTicks - placement.startTicks,
      gesture: options.beginGesture?.(
        handle === "body" ? "Move placement" : "Resize placement",
      ),
      applied: false,
    };
  }

  /** One step of a drag. Applies live so the surface and audio stay in sync. */
  function updateDrag(pointerTicks: number): void {
    const current = project();
    if (!drag || !current) return;
    const commands =
      drag.handle === "body"
        ? movePlacement(current, drag.placementId, pointerTicks - drag.grabOffsetTicks)
        : resizePlacement(current, drag.placementId, drag.handle, pointerTicks);
    if (commands.length === 0) return;
    if (drag.gesture) drag.gesture.apply(commands);
    else options.dispatch(commands);
    drag.applied = true;
    changed();
  }

  /** Ends the drag, committing the whole thing as one history entry. */
  function endDrag(): void {
    if (!drag) return;
    if (drag.applied) drag.gesture?.commit();
    else drag.gesture?.cancel();
    drag = null;
    changed();
  }

  function cancelDrag(): void {
    if (!drag) return;
    drag.gesture?.cancel();
    drag = null;
    changed();
  }

  // --- Discrete operations --------------------------------------------------

  function deleteSelection(): boolean {
    const current = project();
    if (!current) return false;
    const applied = run(deletePlacements(current, selected));
    if (applied) clearSelection();
    return applied;
  }

  function toggleLoop(): boolean {
    const current = project();
    if (!current || selected.length === 0) return false;
    const first = current.song.placements.find((p) => p.id === selected[0]);
    if (!first) return false;
    const looped = !first.looped;
    const commands = selected.flatMap((id) => setPlacementLooped(current, id, looped));
    return run(commands);
  }

  /** Duplicate the selection. `placement_duplicated` fires once per action,
   * carrying only which of CLP-01's two operations ran — never a name. */
  function duplicate(mode: DuplicateMode): boolean {
    const current = project();
    if (!current || selected.length === 0) return false;
    const results = selected.map((id) =>
      duplicatePlacement(current, id, mode, options.ids),
    );
    const commands = results.flatMap((result) => result.commands);
    if (!run(commands)) return false;
    options.analytics?.log("placement_duplicated", { mode });
    const created = results
      .map((result) => result.placementId)
      .filter((id): id is PlacementId => id !== null);
    if (created.length > 0) {
      selected = created;
      changed();
    }
    return true;
  }

  // --- Clipboard ------------------------------------------------------------

  const copy = (): boolean => {
    const current = project();
    if (!current || selected.length === 0) return false;
    clipboard = copyPlacements(current, selected);
    changed();
    return clipboard.length > 0;
  };

  const cut = (): boolean => {
    const current = project();
    if (!current || selected.length === 0) return false;
    const result = cutPlacements(current, selected);
    if (!run(result.commands)) return false;
    clipboard = result.clipboard;
    clearSelection();
    return true;
  };

  /**
   * Where a paste lands: the start of the current selection when there is one,
   * and only otherwise the caller's anchor (the playhead).
   *
   * The playhead is the right anchor "with no explicit target selected", as
   * the shortcut handler's own comment puts it — but a live placement
   * selection *is* that explicit target, and ignoring it sent every paste to
   * the playhead however deliberately the user had picked a spot (#258).
   * `edit.paste` declares `ableton: { kind: "follows" }`, and Ableton pastes
   * at the selection.
   */
  function pasteAnchor(current: Project, fallbackTicks: number): number {
    if (selected.length === 0) return fallbackTicks;
    const starts = current.song.placements
      .filter((placement) => selected.includes(placement.id))
      .map((placement) => placement.startTicks);
    return starts.length === 0 ? fallbackTicks : Math.min(...starts);
  }

  const paste = (targetTicks: number): boolean => {
    const current = project();
    return current
      ? run(
          pastePlacements(
            current,
            clipboard,
            pasteAnchor(current, targetTicks),
            options.ids,
          ),
        )
      : false;
  };

  return {
    getSelection: (): readonly PlacementId[] => selected,
    getClipboard: (): readonly PlacementClipboardEntry[] => clipboard,
    isDragging: (): boolean => drag !== null,
    hasSelection: (): boolean => selected.length > 0,
    /** The label the UI shows before a duplicate (CLP-01). */
    duplicateLabel: describeDuplicate,
    select,
    clearSelection,
    reconcile,
    beginDrag,
    updateDrag,
    endDrag,
    cancelDrag,
    deleteSelection,
    toggleLoop,
    duplicate,
    copy,
    cut,
    paste,
  };
}

export type PlacementEditing = ReturnType<typeof createPlacementEditing>;
