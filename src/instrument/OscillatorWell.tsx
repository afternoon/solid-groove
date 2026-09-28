import type { JSX } from "@solidjs/web";
import type { SynthWaveform } from "../domain/parameters";
import Well from "./Well";

const WIDTH = 300;
const HEIGHT = 100;

/** One cycle of `waveform` at phase `t` (0..1), from -1 to 1. */
function sample(waveform: SynthWaveform, t: number): number {
  switch (waveform) {
    case "sine":
      return Math.sin(t * 2 * Math.PI);
    case "square":
      return t < 0.5 ? 1 : -1;
    case "sawtooth":
      return 1 - 2 * t;
    default:
      return 1 - 4 * Math.abs(t - 0.5);
  }
}

/** Two cycles of the oscillator's shape, as SVG path data. */
export function oscillatorPath(waveform: SynthWaveform, width = WIDTH, height = HEIGHT) {
  const steps = 160;
  const points: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const v = sample(waveform, ((i / steps) * 2) % 1);
    points.push(
      `${i ? "L" : "M"}${((i / steps) * width).toFixed(1)},${(height / 2 - v * height * 0.4).toFixed(1)}`,
    );
  }
  return points.join(" ");
}

/** What the oscillator puts out, drawn in a well (#447). */
export default function OscillatorWell(props: {
  readonly waveform: SynthWaveform;
  readonly label: string;
}): JSX.Element {
  return (
    <Well title="Oscillator" value={props.label} class="oscillator-well">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <line class="well-grid" x1="0" x2={WIDTH} y1={HEIGHT / 2} y2={HEIGHT / 2} />
        <path class="well-line" d={oscillatorPath(props.waveform)} />
      </svg>
    </Well>
  );
}
