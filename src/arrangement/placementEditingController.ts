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
import type { Placement, Project } from "../domain/entities";
import type { IdFactory, PlacementId } from "../domain/ids";
import {
  type ArrangementBand,
  type ArrangementPosition,
  type ArrangementSelection,
  bandBetween,
  barStartPoint,
  clipsSelection,
  extensionBand,
  placementsTouchedBy,
  pointSelection,
  reconcileArrangementSelection,
  selectedPlacementIds,
  selectionSpan,
  selectionStartTicks,
  type TickSpan,
} from "../selection";
import {
  copyPlacements,
  cutPlacements,
  type PlacementClipboardEntry,
  pasteClipboard,
} from "./placementClipboard";
import {
  clampCopyOffset,
  type DragCopyPlan,
  dragCopyCommands,
  dragCopyOverwrites,
  planDragCopy,
} from "./placementDragCopy";
import {
  type DuplicateMode,
  describeDuplicate,
  duplicatePlacement,
} from "./placementDuplication";
import {
  deletePlacements,
  moveSelection,
  resizePlacement,
  setPlacementLooped,
  snapToBar,
} from "./placementGeometry";
import { tileCommands, tileOverwrites, tileTarget } from "./placementTile";

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
  gesture: EditingGesture | undefined;
  applied: boolean;
  /** Pressed on a clip inside a larger selection: a release without a move
   * narrows the selection to that clip, as a click on it would (#292). */
  readonly narrowOnClick: boolean;
  /** The selection before the press, which cancelling puts back. */
  readonly before: ArrangementSelection | null;
  /** The project at the press, which a drop that changes mode resolves from. */
  readonly base: Project;
  /** The pressed clip's start at the press. */
  readonly originTicks: number;
  /** The selected clips at the press: what an Alt-drag copies (ARR-011). */
  readonly sources: readonly PlacementId[];
  /** Whether the steps applied so far copy rather than move. */
  copying: boolean;
  /** The copies, minted on the first copy step and kept for the drag. */
  plan: DragCopyPlan | null;
  /** Where the applied copies sit, as an offset; null until they exist. */
  placedAt: number | null;
  /** The body offset the pointer last asked for, snapped to a bar. */
  offsetTicks: number;
  /** The pressed clip's end at the press: past it, an end drag tiles (#493). */
  readonly originEndTicks: number;
  /** The linked copies' IDs, minted as the tiling first needs each one. */
  readonly tileIds: PlacementId[];
  /** The end the last end-drag step asked for; 0 while that step resizes. */
  tileTo: number;
  /** Which end-drag step was applied last, so a repeat of it is skipped. */
  endKey: string | null;
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

  /** Cmd-click (Ctrl-click off macOS) on a clip (#405): toggle that one clip
   * in or out of the selection, keeping the rest. */
  function toggleClip(placementId: PlacementId): void {
    select(placementId, true);
    options.analytics?.logFeatureFirstUse("arrangement_toggle_select");
  }

  /**
   * Shift-click on a clip (#405): the selection becomes every clip in the box
   * from what is selected to the clicked clip, across every track between
   * (`extensionBand`). With no clip selected it is a plain click.
   */
  function extendTo(placementId: PlacementId): void {
    const current = project();
    const box = current && extensionBand(selection, placementId, current);
    if (!current || !box) {
      select(placementId);
      return;
    }
    setSelection(clipsSelection(placementsTouchedBy(box, current)));
    options.analytics?.logFeatureFirstUse("arrangement_extend_select");
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
    if (!current || !placement) return;
    const held = covered();
    const before = selection;
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
      before,
      base: current,
      originTicks: placement.startTicks,
      sources: covered(),
      copying: false,
      plan: null,
      placedAt: null,
      offsetTicks: 0,
      originEndTicks: placement.startTicks + placement.durationTicks,
      tileIds: [],
      tileTo: 0,
      endKey: null,
    };
  }

  /**
   * One step of a drag. Applies live so the surface and audio stay in sync.
   * `copy` is whether the Alt-drag modifier is held right now (ARR-011): it
   * only changes a body drag, and it is read at every step, so the preview
   * always shows what a drop here would do.
   */
  function updateDrag(pointerTicks: number, copy = false): void {
    const current = project();
    if (!drag || !current) return;
    if (drag.handle === "body") {
      drag.offsetTicks =
        snapToBar(pointerTicks - drag.grabOffsetTicks) - drag.originTicks;
      if (copy !== drag.copying) switchMode(drag, copy);
      if (copy) {
        stepCopy(drag);
        return;
      }
    }
    if (drag.handle === "end" && stepEnd(drag, pointerTicks)) return;
    const commands =
      drag.handle === "body"
        ? moveSelection(drag.base, current, drag.sources, drag.offsetTicks)
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

  // --- Right-edge repeat (#493) ---------------------------------------------

  const tileIdAt = (state: DragState) => (index: number) => {
    while (state.tileIds.length <= index) state.tileIds.push(options.ids("placement"));
    return state.tileIds[index];
  };

  /**
   * One step of an end-edge drag: past the clip's own end it tiles linked
   * copies (the source is never lengthened); at or inside it, it trims. Each
   * change of target reapplies from the project at the press in a fresh
   * gesture. Returns false to leave the no-gesture trim to the resize path.
   */
  function stepEnd(state: DragState, pointerTicks: number): boolean {
    const target = tileTarget(pointerTicks);
    const tiling = target > state.originEndTicks;
    if (!tiling && !state.gesture) return false;
    const key = `${tiling ? "tile" : "resize"}:${snapToBar(pointerTicks)}`;
    if (key === state.endKey) return true;
    state.endKey = key;
    state.tileTo = tiling ? target : 0;
    if (!state.gesture) {
      changed(); // no gesture: the copies land at the drop
      return true;
    }
    if (state.applied) {
      state.gesture.cancel();
      state.gesture = options.beginGesture?.(
        tiling ? "Repeat placement" : "Resize placement",
      );
      state.applied = false;
    }
    const commands = tiling
      ? tileCommands(state.base, state.placementId, target, tileIdAt(state)).commands
      : resizePlacement(state.base, state.placementId, "end", pointerTicks);
    if (commands.length > 0 && state.gesture) {
      state.gesture.apply(commands);
      state.applied = true;
    }
    changed();
    return true;
  }

  /** An end-drag's drop past the clip's end: the copies land and overwrite
   * what they cover (#290), as one entry, resolved from the project at the press. */
  function dropTiles(state: DragState): void {
    const { commands, placementIds } = tileCommands(
      state.base,
      state.placementId,
      state.tileTo,
      tileIdAt(state),
    );
    const landed = executeTransaction(state.base, commands, {
      commitRevision: false,
      deferredInvariants: ["placement_overlap"],
    });
    if (commands.length === 0 || !landed.ok) {
      dropNothing(state);
      return;
    }
    const overwrite = tileOverwrites(landed.project, placementIds, () =>
      options.ids("placement"),
    );
    const shown = state.applied && state.gesture !== undefined;
    const all = shown ? overwrite : [...commands, ...overwrite];
    if (state.gesture) {
      if (all.length > 0) state.gesture.apply(all);
      state.gesture.commit("Repeat placement");
    } else {
      options.dispatch(all);
    }
    options.analytics?.log("placement_duplicated", { mode: "linked" });
  }

  // --- Alt-drag copy (ARR-011) ----------------------------------------------

  /** The copies' offset, narrowed to keep every one inside the song. */
  function copyOffset(state: DragState): number {
    state.plan ??= planDragCopy(state.base, state.sources, options.ids);
    return clampCopyOffset(state.plan, state.offsetTicks);
  }

  /** One copy step: the copies follow the pointer; the originals stay put.
   * Without a gesture nothing is shown until the drop commits it. */
  function stepCopy(state: DragState): void {
    const offset = copyOffset(state);
    if (!state.gesture || !state.plan) return;
    const commands = dragCopyCommands(state.plan, offset, state.placedAt);
    if (commands.length === 0) return;
    state.gesture.apply(commands);
    state.placedAt = offset;
    state.applied = true;
    changed();
  }

  /**
   * Alt went down or up mid-drag: undo what the other mode applied, so the
   * preview only ever shows one of them. The gesture is abandoned and a fresh
   * one opened. Without gestures each step has already committed, and the drag
   * carries on in the new mode from there.
   */
  function switchMode(state: DragState, copy: boolean): void {
    if (state.applied && state.gesture) {
      state.gesture.cancel();
      state.gesture = options.beginGesture?.(copy ? "Copy placements" : "Move placement");
      state.applied = false;
    }
    state.placedAt = null;
    state.copying = copy;
    changed();
  }

  /**
   * An Alt-drag's drop: the copies land at the drop's offset, overwrite what
   * they cover (#290), and become the selection. Resolved from the project at
   * the press, so it never reads a project the UI has not caught up with; the
   * live steps are kept when they already show exactly this, and replaced
   * when Alt went down since the last one.
   */
  function dropCopy(state: DragState): void {
    const offset = copyOffset(state);
    const plan = state.plan ?? [];
    const place = dragCopyCommands(plan, offset, null);
    const landed = executeTransaction(state.base, place, {
      commitRevision: false,
      deferredInvariants: ["placement_overlap"],
    });
    if (offset === 0 || place.length === 0 || !landed.ok) {
      dropNothing(state);
      return;
    }
    const overwrite = dragCopyOverwrites(landed.project, plan, () =>
      options.ids("placement"),
    );
    const shown = state.copying && state.placedAt === offset;
    if (state.applied && !shown) state.gesture?.cancel();
    const gesture =
      state.applied && !shown ? options.beginGesture?.("Copy placements") : state.gesture;
    const commands = shown ? overwrite : [...place, ...overwrite];
    if (gesture) {
      if (commands.length > 0) gesture.apply(commands);
      gesture.commit("Copy placements");
    } else {
      options.dispatch(commands);
    }
    setSelection(clipsSelection(plan.map((copy) => copy.placementId)));
    options.analytics?.log("placement_duplicated", { mode: "independent" });
    options.analytics?.logFeatureFirstUse("arrangement_drag_copy");
  }

  /** The overwrite of whatever the dragged placements cover in `at` (#290):
   * the pressed clip alone for a resize, every moved clip for a move (#872). */
  function overwriteForDrag(at: Project): RawCommandInput[] {
    if (!drag) return [];
    if (drag.handle === "body") {
      return tileOverwrites(at, drag.sources, () => options.ids("placement"));
    }
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
  function endDrag(copy = false): void {
    if (!drag) return;
    // Alt is read here, at the drop (ARR-011), whatever the steps did.
    const body = drag.handle === "body";
    if (body && copy) dropCopy(drag);
    else if (body && drag.copying) dropMove(drag);
    else if (drag.tileTo > 0) dropTiles(drag);
    else commitDrag(drag);
    drag = null;
    changed();
  }

  function commitDrag(state: DragState): void {
    const current = project();
    if (state.applied && state.gesture && current) {
      const overwrite = overwriteForDrag(current);
      if (overwrite.length > 0) state.gesture.apply(overwrite);
    }
    if (state.applied) state.gesture?.commit();
    else state.gesture?.cancel();
    if (!state.applied && state.narrowOnClick) select(state.placementId);
  }

  /** A release that did not move: nothing changes, as a click on the clip. */
  function dropNothing(state: DragState): void {
    state.gesture?.cancel();
    if (!state.applied && state.narrowOnClick) select(state.placementId);
  }

  /**
   * Alt let go since the last step: the drop is a plain move, which none of
   * the steps applied. Resolved from the project at the press, with its
   * overwrite (#290), as the one step of a fresh gesture.
   */
  function dropMove(state: DragState): void {
    const moved = moveSelection(state.base, state.base, state.sources, state.offsetTicks);
    const landed = executeTransaction(state.base, moved, {
      commitRevision: false,
      deferredInvariants: ["placement_overlap"],
    });
    if (moved.length === 0 || !landed.ok) {
      dropNothing(state);
      return;
    }
    const commands = [...moved, ...overwriteForDrag(landed.project)];
    if (state.applied) state.gesture?.cancel();
    const gesture = state.applied
      ? options.beginGesture?.("Move placement")
      : state.gesture;
    if (!gesture) {
      options.dispatch(commands);
      return;
    }
    gesture.apply(commands);
    gesture.commit();
  }

  /** Escape mid-drag: the project and the selection go back to the press. */
  function cancelDrag(): void {
    if (!drag) return;
    drag.gesture?.cancel();
    selection = drag.before;
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
    // The earliest clip by start time, not by song order: a clip added later
    // can start earlier, and the point must sit where the whole cut began.
    const first = current.song.placements
      .filter((p) => ids.includes(p.id))
      .reduce<Placement | undefined>(
        (earliest, p) => (!earliest || p.startTicks < earliest.startTicks ? p : earliest),
        undefined,
      );
    if (!first || !run(result.commands)) return false;
    clipboard = result.clipboard;
    // The point stays where the cut clips began, so a paste straight after
    // puts them back (#292).
    setSelection(pointSelection({ trackId: first.trackId, ticks: first.startTicks }));
    return true;
  };

  /**
   * Paste at the selection's start, Ableton-style (#292): the point, or the
   * earliest selected clip's start, exactly where it is. Only with nothing
   * selected does it fall back to `fallbackTicks` (the playhead), snapped to a
   * bar. It needs only a non-empty clipboard. What it pasted is selected
   * afterwards, as a duplicate's copy is.
   */
  const paste = (fallbackTicks: number): boolean => {
    const current = project();
    if (!current || clipboard.length === 0) return false;
    const at = selectionStartTicks(selection, current);
    const result = pasteClipboard(current, clipboard, at ?? fallbackTicks, options.ids, {
      snap: at === null,
    });
    if (!run(result.commands)) return false;
    setSelection(clipsSelection(result.placementIds));
    return true;
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
    toggleClip,
    extendTo,
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
