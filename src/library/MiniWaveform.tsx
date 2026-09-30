import type { JSX } from "@solidjs/web";
import { WAVEFORM_PEAK_COUNT } from "./manifest";
import "./MiniWaveform.css";

/** The viewBox is 100 wide and 20 tall, as the reference design's rows are. */
const WIDTH = 100;
const HALF = 10;
/** The flattest a bin is drawn, so a silent bin is still a hairline. */
const FLOOR = 0.05;
/** How much of the half-height a full-scale bin fills. */
const REACH = 0.95;

/** A mirrored closed path: the peaks along the top, then back along the bottom. */
export function waveformPath(peaks: readonly number[]): string {
  const last = Math.max(1, peaks.length - 1);
  const top: string[] = [];
  const bottom: string[] = [];
  peaks.forEach((peak, i) => {
    const x = ((i / last) * WIDTH).toFixed(1);
    const a = Math.max(FLOOR, peak / 255) * REACH * HALF;
    top.push(`${x},${(HALF - a).toFixed(2)}`);
    bottom.unshift(`${x},${(HALF + a).toFixed(2)}`);
  });
  return `M${top.join(" L")} L${bottom.join(" L")}Z`;
}

/** The neutral stand-in when there are no peaks: one flat bar. */
const FLAT_PATH = waveformPath(new Array<number>(WAVEFORM_PEAK_COUNT).fill(0));

/**
 * A small mirrored waveform for a library row. Purely decorative: an SVG path
 * sized by its container, hidden from assistive technology, never interactive.
 * The fill is `--waveform-fill` (default: a theme token), so a caller can set
 * it, for instance to the track colour on the selected row.
 */
export default function MiniWaveform(props: {
  peaks: readonly number[] | null;
}): JSX.Element {
  return (
    <svg
      class={["mini-waveform", { "mini-waveform-flat": props.peaks === null }]}
      viewBox={`0 0 ${WIDTH} ${HALF * 2}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path d={props.peaks ? waveformPath(props.peaks) : FLAT_PATH} />
    </svg>
  );
}
