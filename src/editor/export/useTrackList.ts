import { createMemo, createSignal } from "solid-js";
import type { Project } from "../../domain/entities";
import type { TrackId } from "../../domain/ids";
import { deriveTrackLaneRows, songLengthBars, type TrackLaneView } from "./trackLanes";
import type { ClickModifiers } from "./trackListSelection";
import {
  applyPickAction,
  clickRow,
  EMPTY_TRACK_LIST,
  isIncluded,
  type PickAction,
  type TrackListState,
} from "./trackListSelection";

/**
 * The Export dialog's track list as reactive state (EXP-004): the pure
 * `trackListSelection` model held in a signal, and the rows the lanes draw. The
 * dialog owns one of these.
 */

export interface UseTrackListOptions {
  readonly project: () => Project;
}

export function useTrackList(options: UseTrackListOptions) {
  const rows = createMemo(() => deriveTrackLaneRows(options.project()));
  const bars = createMemo(() => songLengthBars(rows()));
  const [state, setState] = createSignal<TrackListState>(EMPTY_TRACK_LIST);

  const views = createMemo((): TrackLaneView[] => {
    const current = state();
    return rows().map((row) => ({
      ...row,
      included: isIncluded(current, row),
      picked: current.picked.has(row.id),
    }));
  });
  /** The tracks a stem export includes, in track order; returns always ride along. */
  const trackIds = createMemo(() => {
    const current = state();
    return rows()
      .filter((row) => !row.fixed && isIncluded(current, row))
      .map((row) => row.id as TrackId);
  });

  return {
    rows: views,
    bars,
    trackIds,
    focusId: () => state().focus,
    click(index: number, modifiers: ClickModifiers): void {
      const row = rows()[index];
      if (row) setState(clickRow(state(), rows(), row.id, modifiers));
    },
    pick(action: PickAction): void {
      setState(applyPickAction(state(), rows(), action));
    },
  };
}

export type TrackList = ReturnType<typeof useTrackList>;
