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
 * It holds the arrangement's one selection (#292): a free range or point, or
 * clicked clips (`src/selection/arrangement.ts`). Every operation acts on the
 * clips that selection covers. Delete and cut on a range take out the covered
 * time, trimming a clip it only partly covers, as in Ableton.
 */

import type { Analytics } from "../analytics/analytics";
import { overwritePlacements } from "../commands/definitions/placements";
import { executeTransaction } from "../commands/execute";
import type { RawCommandInput } from "../commands/types";
import type { Project } from "../domain/entities";
import type { IdFactory, PlacementId } from "../domain/ids";
import {
  type ArrangementPosition,
  type ArrangementSelection,
  type ArrangementSpan,
  clipsSelection,
  coveredPlacementIds,
  pointSelection,
  rangeSelection,
  reconcileArrangementSelection,
  selectionSpan,
} from "../selection";
import {
  cutPlacements,
  type PlacementClipboardEntry,
  pasteClipboard,
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
import { removePlacementRange } from "./placementRangeEdits";

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
  let selection: ArrangementSelection | null = null;
  // Where a range drag was pressed, while one is in flight.
  let rangeAnchor: ArrangementPosition | null = null;
  let clipboard: readonly PlacementClipboardEntry[] = [];
  // Where the copied stretch began, which a paste lines up with its target.
  let clipboardOrigin = 0;
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

  /** The clips the selection covers, which every operation acts on. */
  function covered(): PlacementId[] {
    const current = project();
    return current ? coveredPlacementIds(selection, current) : [];
  }

  /** Replace the one selection. The only place it is written. */
  function setSelection(next: ArrangementSelection | null): void {
    if (next === selection) return;
    selection = next;
    changed();
  }

  /** Select one clip, or with `additive` toggle it in or out of the selection. */
  function select(placementId: PlacementId, additive = false): void {
    if (!additive) {
      setSelection(clipsSelection([placementId]));
      return;
    }
    const ids = covered();
    setSelection(
      clipsSelection(
        ids.includes(placementId)
          ? ids.filter((id) => id !== placementId)
          : [...ids, placementId],
      ),
    );
  }

  function clearSelection(): void {
    setSelection(null);
  }

  /** Drops what the project no longer contains (e.g. after an undo). */
  function reconcile(): void {
    const current = project();
    if (current) setSelection(reconcileArrangementSelection(selection, current));
  }

  /** The stretch of time the selection stands for, for zoom to selection. */
  function span(): ArrangementSpan | null {
    const current = project();
    return current ? selectionSpan(selection, current) : null;
  }

  /** Press in empty space: the selection becomes a point there, and a drag
   * from it can stretch it into a range. */
  function beginRange(position: ArrangementPosition): void {
    rangeAnchor = position;
    setSelection(pointSelection(position));
  }

  /** The pointer moved during a range drag: the range runs from the press to
   * here, across every track between. Free, not snapped. */
  function updateRange(position: ArrangementPosition): void {
    const current = project();
    if (!rangeAnchor || !current) return;
    const next = rangeSelection(current, rangeAnchor, position);
    if (next) setSelection(next);
  }

  function endRange(): void {
    rangeAnchor = null;
  }

  /** The free range a delete or cut takes out, or null for a clip selection. */
  function rangeToRemove(): ArrangementSpan | null {
    return selection?.kind === "range" ? selection.span : null;
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
    const held =
      selection?.kind === "clips" && selection.placementIds.includes(placementId);
    if (!held) select(placementId);
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
    if (drag.gesture) {
      drag.gesture.apply(commands);
    } else {
      // With no gesture every step commits on its own, so each one resolves
      // its own overwrite against the project that step produces.
      const stepped = executeTransaction(current, commands, {
        commitRevision: false,
        deferredInvariants: ["placement_overlap"],
      });
      options.dispatch([...commands, ...overwriteForDrag(stepped.project)]);
    }
    drag.applied = true;
    changed();
  }

  /** The overwrite of whatever the dragged placement covers in `at` (#290). */
  function overwriteForDrag(at: Project): RawCommandInput[] {
    const placement = at.song.placements.find((p) => p.id === drag?.placementId);
    return placement
      ? overwritePlacements(at, placement, () => options.ids("placement"))
      : [];
  }

  /**
   * Ends the drag, committing the whole thing as one history entry. The
   * overwrite of whatever the dropped placement covers is resolved here, once,
   * so a neighbour the drag merely passed over is left intact (#290).
   */
  function endDrag(): void {
    if (!drag) return;
    const current = project();
    if (drag.applied && drag.gesture && current) {
      const overwrite = overwriteForDrag(current);
      if (overwrite.length > 0) drag.gesture.apply(overwrite);
    }
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

  /** Delete what is selected: a clip selection's clips, or a range's time. The
   * range stays selected, now covering nothing; a clip selection is cleared. */
  function deleteSelection(): boolean {
    const current = project();
    if (!current) return false;
    const range = rangeToRemove();
    const commands = range
      ? removePlacementRange(
          current,
          covered(),
          range.startTicks,
          range.endTicks,
          options.ids,
        ).commands
      : deletePlacements(current, covered());
    const applied = run(commands);
    if (applied && !range) clearSelection();
    return applied;
  }

  function toggleLoop(): boolean {
    const current = project();
    const ids = covered();
    if (!current || ids.length === 0) return false;
    const first = current.song.placements.find((p) => p.id === ids[0]);
    if (!first) return false;
    const looped = !first.looped;
    const commands = ids.flatMap((id) => setPlacementLooped(current, id, looped));
    return run(commands);
  }

  /** Duplicate the selection. `placement_duplicated` fires once per action,
   * carrying only which of CLP-01's two operations ran — never a name. */
  function duplicate(mode: DuplicateMode): boolean {
    const current = project();
    const ids = covered();
    if (!current || ids.length === 0) return false;
    const results = ids.map((id) => duplicatePlacement(current, id, mode, options.ids));
    const commands = results.flatMap((result) => result.commands);
    if (!run(commands)) return false;
    options.analytics?.log("placement_duplicated", { mode });
    const created = results
      .map((result) => result.placementId)
      .filter((id): id is PlacementId => id !== null);
    if (created.length > 0) setSelection(clipsSelection(created));
    return true;
  }

  // --- Clipboard ------------------------------------------------------------

  /** What a copy or cut puts on the clipboard: a range's covered pieces, or a
   * clip selection's whole clips. */
  function selectedPieces(current: Project) {
    const range = rangeToRemove();
    return range
      ? removePlacementRange(
          current,
          covered(),
          range.startTicks,
          range.endTicks,
          options.ids,
        )
      : cutPlacements(current, covered());
  }

  /** Holds what a copy or cut took, and where the selection it came from
   * began: a range's start, so its leading gap survives the paste, or the
   * first clip's. */
  function hold(entries: readonly PlacementClipboardEntry[], from: ArrangementSpan) {
    clipboard = entries;
    clipboardOrigin = from.startTicks;
  }

  const copy = (): boolean => {
    const current = project();
    const from = span();
    if (!current || !from || covered().length === 0) return false;
    hold(selectedPieces(current).clipboard, from);
    changed();
    return clipboard.length > 0;
  };

  /** Cut what is selected. The time it took stays selected, as in Ableton, so
   * a paste straight after puts it back where it was. */
  const cut = (): boolean => {
    const current = project();
    const at = span();
    if (!current || !at || covered().length === 0) return false;
    const result = selectedPieces(current);
    if (!run(result.commands)) return false;
    hold(result.clipboard, at);
    setSelection({ kind: "range", span: at });
    return true;
  };

  /**
   * Paste at the selection's start, Ableton-style: the insertion point, or the
   * start of the selected range or clips, exactly where it is. Only with
   * nothing selected does it fall back to `fallbackTicks` (the playhead),
   * snapped to a bar. Needs only a non-empty clipboard. What it pasted is
   * selected afterwards, as a duplicate's copy is.
   */
  const paste = (fallbackTicks: number): boolean => {
    const current = project();
    if (!current || clipboard.length === 0) return false;
    const at = span();
    const result = pasteClipboard(
      current,
      clipboard,
      at ? at.startTicks : fallbackTicks,
      options.ids,
      { anchorTicks: clipboardOrigin, snap: at === null },
    );
    if (!run(result.commands)) return false;
    setSelection(clipsSelection(result.placementIds));
    return true;
  };

  return {
    /** The clips the selection covers, in song order. */
    getSelection: (): readonly PlacementId[] => covered(),
    getArrangementSelection: (): ArrangementSelection | null => selection,
    selectionSpan: span,
    getClipboard: (): readonly PlacementClipboardEntry[] => clipboard,
    isDragging: (): boolean => drag !== null,
    isSelectingRange: (): boolean => rangeAnchor !== null,
    hasSelection: (): boolean => covered().length > 0,
    /** The label the UI shows before a duplicate (CLP-01). */
    duplicateLabel: describeDuplicate,
    select,
    setSelection,
    clearSelection,
    beginRange,
    updateRange,
    endRange,
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
