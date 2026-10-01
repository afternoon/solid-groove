import type { JSX } from "@solidjs/web";
import { createEffect, createSignal, onSettled, Show } from "solid-js";
import "./LaneMap.css";
import { clickModifiers } from "./TrackNameList";
import type { TrackLaneView } from "./trackLanes";
import {
  drawLanes,
  type LaneBatches,
  type PrintState,
  printingSpan,
  ROW_HEIGHT_PX,
  resolveLanePalette,
} from "./trackLanesCanvas";
import type { ClickModifiers } from "./trackListSelection";

/**
 * The lane area of the Export mini-arrangement (EXP-004): each row's clips on
 * the song's bar grid, dim when left out, washed when picked. While exporting,
 * lanes print to full brightness behind a 2px playhead that crosses only the
 * printing batch's rows. A click on a lane is a click on its name. Rows are
 * immutable snapshots, so a change is a new array and a redraw.
 */

export interface LaneMapProps {
  readonly rows: readonly TrackLaneView[];
  readonly bars: number;
  readonly batches?: readonly (readonly string[])[];
  readonly doneBatches?: readonly number[];
  readonly printing?: PrintState | null;
  readonly onRowClick?: (index: number, modifiers: ClickModifiers) => void;
}

export default function LaneMap(props: LaneMapProps): JSX.Element {
  const [width, setWidth] = createSignal(0);
  const batchState = (): LaneBatches => ({
    batches: props.batches ?? [],
    doneBatches: props.doneBatches ?? [],
    printing: props.printing ?? null,
  });
  const height = () => props.rows.length * ROW_HEIGHT_PX;
  let host!: HTMLDivElement;
  let canvas!: HTMLCanvasElement;

  onSettled(() => {
    setWidth(host.clientWidth);
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => setWidth(host.clientWidth));
    observer.observe(host);
    return () => observer.disconnect();
  });

  // A canvas has no reactive inputs of its own, so every one is read here.
  createEffect(
    () => ({ rows: props.rows, bars: props.bars, width: width(), batches: batchState() }),
    ({ rows, bars, width: w, batches }) => {
      const ctx = canvas.getContext("2d");
      if (!ctx || w <= 0) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(rows.length * ROW_HEIGHT_PX * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawLanes(ctx, { width: w, rows, bars, batches, palette: resolveLanePalette() });
    },
  );

  const span = () => printingSpan(props.rows, batchState());
  const click = (event: MouseEvent) => {
    const top = canvas.getBoundingClientRect().top;
    const index = Math.floor((event.clientY - top) / ROW_HEIGHT_PX);
    if (index >= 0 && index < props.rows.length) {
      props.onRowClick?.(index, clickModifiers(event));
    }
  };

  return (
    <div class="lane-map" ref={host} style={{ height: `${height()}px` }}>
      <canvas ref={canvas} onClick={click} />
      <Show when={span()}>
        {(rows) => (
          <div
            class="lane-playhead"
            aria-hidden="true"
            style={{
              left: `${(props.printing?.fraction ?? 0) * 100}%`,
              top: `${rows().first * ROW_HEIGHT_PX}px`,
              height: `${(rows().last - rows().first + 1) * ROW_HEIGHT_PX}px`,
            }}
          />
        )}
      </Show>
    </div>
  );
}
