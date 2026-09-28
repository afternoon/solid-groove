import { type JSX, Show } from "@solidjs/web";
import { createEffect, createSignal } from "solid-js";
import type {
  Gesture,
  GestureOptions,
  RawCommandInput,
  TransactionResult,
} from "../commands";
import type { AssetId } from "../domain/ids";
import DragSurface from "./DragSurface";
import Well from "./Well";

/**
 * Follows a sound's decoded waveform (`useProjectAudio().watchAssetPeaks`):
 * `onPeaks` gets `buckets` peaks, 0..1, when there are some. Returns the way
 * to stop.
 */
export type WatchPeaks = (
  assetId: AssetId,
  buckets: number,
  onPeaks: (peaks: Float32Array | null) => void,
) => () => void;

/** Follows `assetId`'s peaks for as long as the caller is mounted. */
export function createPeaks(
  watch: () => WatchPeaks | undefined,
  assetId: () => AssetId | null,
  buckets: number,
) {
  const [peaks, setPeaks] = createSignal<Float32Array | null>(null);
  createEffect(
    () => [watch(), assetId()] as const,
    ([follow, id]) => {
      setPeaks(null);
      if (!follow || !id) return;
      return follow(id, buckets, (next) => setPeaks(next));
    },
  );
  return peaks;
}

/**
 * SVG path data for mirrored peak bars across a `width` × `height` box — only
 * the bars whose centre falls between `from` and `to` (fractions of the width),
 * so the playing window and the rest can be drawn in different inks.
 */
export function peakBars(
  peaks: Float32Array,
  width: number,
  height: number,
  from = 0,
  to = 1,
): string {
  let d = "";
  for (let i = 0; i < peaks.length; i++) {
    const at = (i + 0.5) / peaks.length;
    if (at < from || at > to) continue;
    const x = (at * width).toFixed(1);
    const half = Math.max(0.5, peaks[i] * height * 0.47);
    d += `M${x},${(height / 2 - half).toFixed(1)}V${(height / 2 + half).toFixed(1)}`;
  }
  return d;
}

export interface SampleWellProps {
  readonly assetId: AssetId | null;
  readonly watchPeaks?: WatchPeaks;
  /** The playing window, as fractions of the sound: `start < end`. */
  readonly start: number;
  readonly end: number;
  readonly readout: JSX.Element;
  commandStart(value: number): RawCommandInput;
  commandEnd(value: number): RawCommandInput;
  dispatch(
    commands: RawCommandInput | readonly RawCommandInput[],
  ): TransactionResult | undefined;
  beginGesture(options?: GestureOptions): Gesture | undefined;
  onCommit?(): void;
}

const WIDTH = 900;
const HEIGHT = 140;
const BUCKETS = 240;
/** The narrowest window a drag can leave, so start stays before end. */
const MIN_WINDOW = 0.01;

/**
 * The loaded sound's waveform, with the part that plays lit and the rest
 * dimmed (#447). Pressing nearer the start marker moves the start, nearer the
 * end moves the end; the Start and End faders set the same two values.
 */
export default function SampleWell(props: SampleWellProps): JSX.Element {
  const peaks = createPeaks(
    () => props.watchPeaks,
    () => props.assetId,
    BUCKETS,
  );
  const bars = (from: number, to: number) => {
    const current = peaks();
    return current ? peakBars(current, WIDTH, HEIGHT, from, to) : "";
  };
  const startX = () => props.start * WIDTH;
  const endX = () => props.end * WIDTH;

  return (
    <Well title="Sample · drag start and end" value={props.readout} class="sample-well">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <line class="well-grid" x1="0" x2={WIDTH} y1={HEIGHT / 2} y2={HEIGHT / 2} />
        <path class="sample-well-bars" d={bars(0, props.start) + bars(props.end, 1)} />
        <path class="sample-well-bars playing" d={bars(props.start, props.end)} />
        <line class="sample-well-marker" x1={startX()} x2={startX()} y1="0" y2={HEIGHT} />
        <line class="sample-well-marker" x1={endX()} x2={endX()} y1="0" y2={HEIGHT} />
      </svg>
      <Show when={!props.assetId || (props.watchPeaks && !peaks())}>
        <p class="sample-well-empty">
          {props.assetId ? "Loading waveform…" : "Load a sound to see its waveform"}
        </p>
      </Show>
      <DragSurface
        grab={(point) =>
          Math.abs(point.x - props.start) <= Math.abs(point.x - props.end)
            ? "start"
            : "end"
        }
        commands={(point, edge) =>
          edge === "start"
            ? [props.commandStart(Math.min(point.x, props.end - MIN_WINDOW))]
            : [props.commandEnd(Math.max(point.x, props.start + MIN_WINDOW))]
        }
        summary={() => "Set sample window"}
        dispatch={(commands) => props.dispatch(commands)}
        beginGesture={(options) => props.beginGesture(options)}
        onCommit={() => props.onCommit?.()}
      />
    </Well>
  );
}
