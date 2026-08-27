import type { JSX } from "@solidjs/web";
import type { SynthWaveform } from "../domain/parameters";

/** Small decorative waveform glyphs for the oscillator option group (mock 05a). */
export function WaveformIcon(props: { waveform: SynthWaveform }): JSX.Element {
  const path = () => WAVEFORM_PATHS[props.waveform];
  return (
    <svg
      width="24"
      height="16"
      viewBox="0 0 24 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      aria-hidden="true"
    >
      <title>{props.waveform}</title>
      <path d={path()} />
    </svg>
  );
}

const WAVEFORM_PATHS: Record<SynthWaveform, string> = {
  sine: "M1 8 Q6 1 11 8 T21 8",
  square: "M1 12 V4 H8 V12 H15 V4 H22",
  sawtooth: "M1 12 L8 4 L8 12 L15 4 L15 12 L22 4",
  triangle: "M1 12 L6 4 L12 12 L18 4 L23 12",
};
