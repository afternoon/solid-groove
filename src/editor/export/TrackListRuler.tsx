import type { JSX } from "@solidjs/web";
import { createSignal, For, onSettled, Show } from "solid-js";
import { detectPlatform } from "../../shortcuts/keys";
import "./TrackListRuler.css";
import { rulerBars, rulerStep } from "./trackLanes";
import { GUTTER_PX, NAME_COLUMN_PX } from "./trackLanesCanvas";
import type { PickAction } from "./trackListSelection";

/**
 * The ruler row above the Export dialog's mini-arrangement (EXP-004). Its left
 * cell is the list's status: "N of M stems" with a short hint at rest, or, while
 * tracks are picked, "N picked" with On, Off, Only these and a clear button. The
 * rest is the bar ruler, labelled over the lane area at the first of 16, 32, 64... bars that keeps
 * the labels apart.
 */

export interface TrackListRulerProps {
  readonly included: number;
  readonly total: number;
  readonly picked: number;
  readonly bars: number;
  /** Stereo mode: the cell just says "In the mix". */
  readonly readOnly?: boolean;
  /** An export is running: the picked-set buttons are off. */
  readonly disabled?: boolean;
  readonly onPickAction?: (action: PickAction) => void;
  /** The lane scroller's scrollbar, so the ruler and the lanes share one set of columns. */
  readonly scrollbarPx?: number;
}

function PickBar(props: TrackListRulerProps): JSX.Element {
  const button = (action: PickAction, label: string) => (
    <button
      type="button"
      class="track-ruler-mini"
      disabled={props.disabled}
      onClick={() => props.onPickAction?.(action)}
    >
      {label}
    </button>
  );
  return (
    <>
      <span class="track-ruler-label track-ruler-picked">{props.picked} picked</span>
      {button("on", "On")}
      {button("off", "Off")}
      {button("only", "Only these")}
      <button
        type="button"
        class="track-ruler-clear"
        aria-label="Clear picked tracks"
        onClick={() => props.onPickAction?.("clear")}
      >
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2 2l8 8M10 2l-8 8" />
        </svg>
      </button>
    </>
  );
}

function Hint(props: TrackListRulerProps): JSX.Element {
  const mod = detectPlatform() === "mac" ? "⌘" : "Ctrl";
  return (
    <>
      <span class="track-ruler-label">
        {props.included} of {props.total} stems
      </span>
      <span
        class="track-ruler-hint"
        title={`Click flips a track. Shift-click sets every track between to match. ${mod}-click picks tracks; click one of them to flip them all.`}
      >
        <kbd>⇧</kbd> range <kbd>{mod}</kbd> pick
      </span>
    </>
  );
}

export default function TrackListRuler(props: TrackListRulerProps): JSX.Element {
  let marks!: HTMLDivElement;
  const [width, setWidth] = createSignal(0);
  onSettled(() => {
    setWidth(marks.clientWidth);
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => setWidth(marks.clientWidth));
    observer.observe(marks);
    return () => observer.disconnect();
  });
  const step = () => rulerStep(props.bars, width());
  return (
    <div
      class="track-ruler"
      style={{
        "grid-template-columns": `${NAME_COLUMN_PX}px ${GUTTER_PX}px minmax(0, 1fr)`,
        "padding-right": `${props.scrollbarPx ?? 0}px`,
      }}
    >
      <div class="track-ruler-cell">
        <Show
          when={!props.readOnly}
          fallback={<span class="track-ruler-label">In the mix</span>}
        >
          <Show when={props.picked > 0} fallback={<Hint {...props} />}>
            <PickBar {...props} />
          </Show>
        </Show>
      </div>
      <div aria-hidden="true" />
      <div class="track-ruler-marks" ref={marks} aria-hidden="true">
        <For each={rulerBars(props.bars, step())}>
          {(bar) => (
            <span style={{ left: `${((bar - 1) / Math.max(1, props.bars)) * 100}%` }}>
              {bar}
            </span>
          )}
        </For>
      </div>
    </div>
  );
}
