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
 * It holds the arrangement's one selection (#292, `src/selection/arrangement.ts`):
 * an insertion point, or whole clips. A drag in empty space sweeps a band,
 * and on release the band becomes every clip it touched, or nothing. Every
 * edit acts on the selected clips, whole: nothing is trimmed.
 */

import type { Analytics } from "../analytics/analytics";
import { overwritePlacements } from "../commands/definitions/placements";
import { executeTransaction } from "../commands/execute";
import type { RawCommandInput } from "../commands/types";
import type { Project } from "../domain/entities";
import type { IdFactory, PlacementId } from "../domain/ids";
import {
  type ArrangementBand,
  type ArrangementPosition,
  type ArrangementSelection,
  bandBetween,
  barStartPoint,
  clipsSelection,
  placementsTouchedBy,
  reconcileArrangementSelection,
  selectedPlacementIds,
  selectionSpan,
  type TickSpan,
} from "../selection";
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
  /** Pressed on a clip inside a larger selection: a release without a move
   * narrows the selection to that clip, as a click on it would (#292). */
  readonly narrowOnClick: boolean;
}

export function createPlacementEditing(options: PlacementEditingOptions) {
  let selection: ArrangementSelection | null = null;
  // A drag in empty space while its pointer is down: where it was pressed, and
  // the band it has swept so far (null until the pointer first moves).
  let band: { anchor: ArrangementPosition; swept: ArrangementBand | null } | null = null;
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

  /** The selected clips, in song order, which every edit acts on. */
  function covered(): PlacementId[] {
    const current = project();
    return current ? selectedPlacementIds(selection, current) : [];
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

  /** A click in empty space: the point at the start of the bar clicked in. */
  function placePoint(position: ArrangementPosition): void {
    setSelection(barStartPoint(position));
  }

  /** Drops what the project no longer contains (e.g. after an undo). */
  function reconcile(): void {
    const current = project();
    if (current) setSelection(reconcileArrangementSelection(selection, current));
  }

  /** The selected clips' extent, for zoom to selection. Null for a point. */
  function span(): TickSpan | null {
    const current = project();
    return current ? selectionSpan(selection, current) : null;
  }

  // --- Band: a drag in empty space ------------------------------------------

  /** A press in empty space that may become a drag. Nothing changes until the
   * pointer moves: a press released in place is a click, not a band. */
  function beginBand(position: ArrangementPosition): void {
    band = { anchor: position, swept: null };
  }

  /** The pointer moved: the band runs from the press to here, across every
   * track between, free and unsnapped. What was selected is let go. */
  function updateBand(position: ArrangementPosition): void {
    const current = project();
    if (!band || !current) return;
    const swept = bandBetween(current, band.anchor, position);
    if (!swept) return;
    band.swept = swept;
    selection = null;
    changed();
  }

  /** The clips the band in flight touches, drawn as selected while it moves. */
  function bandPlacementIds(): PlacementId[] {
    const current = project();
    return band?.swept && current ? placementsTouchedBy(band.swept, current) : [];
  }

  /**
   * Release: the selection becomes every clip the band touched, as whole
   * clips, or nothing when it touched none. Returns false when the pointer
   * never moved, so the caller can treat the press as a click.
   */
  function endBand(): boolean {
    if (!band) return false;
    const swept = band.swept;
    const touched = bandPlacementIds();
    band = null;
    if (!swept) return false;
    selection = clipsSelection(touched);
    changed();
    options.analytics?.logFeatureFirstUse("arrangement_selection");
    return true;
  }

  function cancelBand(): void {
    if (!band) return;
    band = null;
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
    const held = covered();
    if (!held.includes(placementId)) select(placementId);
    drag = {
      placementId,
      handle,
      grabOffsetTicks: pointerTicks - placement.startTicks,
      gesture: options.beginGesture?.(
        handle === "body" ? "Move placement" : "Resize placement",
      ),
      applied: false,
      narrowOnClick: held.length > 1 && held.includes(placementId),
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
    if (!drag.applied && drag.narrowOnClick) select(drag.placementId);
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
    const applied = run(deletePlacements(current, covered()));
    if (applied) clearSelection();
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

  const copy = (): boolean => {
    const current = project();
    const ids = covered();
    if (!current || ids.length === 0) return false;
    clipboard = copyPlacements(current, ids);
    changed();
    return clipboard.length > 0;
  };

  const cut = (): boolean => {
    const current = project();
    const ids = covered();
    if (!current || ids.length === 0) return false;
    const result = cutPlacements(current, ids);
    if (!run(result.commands)) return false;
    clipboard = result.clipboard;
    clearSelection();
    return true;
  };

  const paste = (targetTicks: number): boolean => {
    const current = project();
    return current
      ? run(pastePlacements(current, clipboard, targetTicks, options.ids))
      : false;
  };

  return {
    /** The selected clips, in song order. */
    getSelection: (): readonly PlacementId[] => covered(),
    getArrangementSelection: (): ArrangementSelection | null => selection,
    selectionSpan: span,
    /** The band in flight, drawn dotted, or null when no drag is sweeping one. */
    getBand: (): ArrangementBand | null => band?.swept ?? null,
    bandPlacementIds,
    isBanding: (): boolean => band !== null,
    getClipboard: (): readonly PlacementClipboardEntry[] => clipboard,
    isDragging: (): boolean => drag !== null,
    hasSelection: (): boolean => covered().length > 0,
    /** The label the UI shows before a duplicate (CLP-01). */
    duplicateLabel: describeDuplicate,
    select,
    setSelection,
    clearSelection,
    placePoint,
    beginBand,
    updateBand,
    endBand,
    cancelBand,
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
