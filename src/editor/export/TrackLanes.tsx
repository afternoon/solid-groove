import type { JSX } from "@solidjs/web";
import { createEffect, createSignal, onSettled } from "solid-js";
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
  /** Nothing is printing or finished: ZIPs already downloaded keep their filled
   * bracket, but their lanes are not drawn printed. */
  readonly idle?: boolean;
  readonly printing?: PrintState | null;
  /** The tallest the list grows before it scrolls; a shorter song stays short. */
  readonly maxHeightPx?: number;
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
  // The scroller's scrollbar takes room from its columns but not from the
  // ruler above it, so the ruler is padded by the same amount to stay aligned.
  const [scrollbarPx, setScrollbarPx] = createSignal(0);
  onSettled(() => {
    const measure = () => setScrollbarPx(scroller.offsetWidth - scroller.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    return () => observer.disconnect();
  });

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
        scrollbarPx={scrollbarPx()}
        onPickAction={props.onPickAction}
      />
      <div
        class="track-lanes-scroll"
        ref={scroller}
        style={{
          "grid-template-columns": `${NAME_COLUMN_PX}px ${GUTTER_PX}px minmax(0, 1fr)`,
          "max-height": props.maxHeightPx ? `${props.maxHeightPx}px` : undefined,
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
          doneBatches={props.idle ? [] : props.doneBatches}
          printing={props.printing}
          onRowClick={props.readOnly || props.disabled ? undefined : props.onRowClick}
        />
      </div>
    </div>
  );
}
