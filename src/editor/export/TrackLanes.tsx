import type { JSX } from "@solidjs/web";
import { createEffect } from "solid-js";
import BatchGutter from "./BatchGutter";
import LaneMap from "./LaneMap";
import "./TrackLanes.css";
import TrackListRuler from "./TrackListRuler";
import TrackNameList from "./TrackNameList";
import type { TrackLaneView } from "./trackLanes";
import {
  GUTTER_PX,
  NAME_COLUMN_PX,
  type PrintState,
  ROW_HEIGHT_PX,
} from "./trackLanesCanvas";
import type { ClickModifiers, PickAction } from "./trackListSelection";

/**
 * The Export dialog's track list as a mini-arrangement (EXP-004, "Release"): the
 * ruler row over a scrolling body of the name listbox, the ZIP gutter and the
 * lane canvas. Presentational over the `trackListSelection` model. It has no key
 * listener: the dialog registers the list's keys in the shortcut registry and
 * learns when they apply from `onFocusChange`.
 */

export interface TrackLanesProps {
  readonly rows: readonly TrackLaneView[];
  /** The song's length in bars, which the lane area spans. */
  readonly bars: number;
  /** The row the keyboard is on. */
  readonly focusId?: string | null;
  /** Stereo mode: rows read MIX or M and ignore the pointer. */
  readonly readOnly?: boolean;
  /** An export is running: nothing can be changed. */
  readonly disabled?: boolean;
  /** Stem batches as arrays of row ids; the gutter shows with two or more. */
  readonly batches?: readonly (readonly string[])[];
  readonly doneBatches?: readonly number[];
  readonly printing?: PrintState | null;
  readonly heightPx?: number;
  /** Scroll this row to the top, e.g. a batch's first stem when it starts. */
  readonly scrollToRowId?: string | null;
  readonly onRowClick?: (index: number, modifiers: ClickModifiers) => void;
  readonly onPickAction?: (action: PickAction) => void;
  readonly onFocusChange?: (focused: boolean) => void;
}

const reducedMotion = () =>
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export default function TrackLanes(props: TrackLanesProps): JSX.Element {
  let scroller!: HTMLDivElement;

  createEffect(
    () => props.scrollToRowId ?? null,
    (id) => {
      const index = id === null ? -1 : props.rows.findIndex((row) => row.id === id);
      if (index < 0) return;
      scroller.scrollTo?.({
        top: index * ROW_HEIGHT_PX,
        behavior: reducedMotion() ? "auto" : "smooth",
      });
    },
  );

  return (
    <div class="track-lanes">
      <TrackListRuler
        included={props.rows.filter((row) => row.included).length}
        total={props.rows.length}
        picked={props.rows.filter((row) => row.picked).length}
        bars={props.bars}
        readOnly={props.readOnly}
        disabled={props.disabled}
        onPickAction={props.onPickAction}
      />
      <div
        class="track-lanes-scroll"
        ref={scroller}
        style={{
          "grid-template-columns": `${NAME_COLUMN_PX}px ${GUTTER_PX}px minmax(0, 1fr)`,
        }}
      >
        <TrackNameList
          rows={props.rows}
          focusId={props.focusId}
          readOnly={props.readOnly}
          disabled={props.disabled}
          onRowClick={props.onRowClick}
          onFocusChange={props.onFocusChange}
        />
        <BatchGutter
          rowIds={props.rows.map((row) => row.id)}
          batches={props.batches ?? []}
          doneBatches={props.doneBatches}
          printingBatch={props.printing?.batchIndex}
        />
        <LaneMap
          rows={props.rows}
          bars={props.bars}
          batches={props.batches}
          doneBatches={props.doneBatches}
          printing={props.printing}
          onRowClick={props.readOnly || props.disabled ? undefined : props.onRowClick}
        />
      </div>
    </div>
  );
}
