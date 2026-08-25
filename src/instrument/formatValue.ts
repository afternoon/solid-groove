import {
  type ParameterDefinition,
  SYNTH_WAVEFORM,
  synthWaveform,
} from "../domain/parameters";

/**
 * Human-readable value for one instrument parameter, in its own unit — the
 * "live value below" line of a fill-slider (design mock `06c`). Small envelope
 * times read in milliseconds, frequencies switch to kHz past 1000, the
 * waveform index reads as its name, and semitone pitch carries a sign.
 */
export function formatInstrumentValue(
  definition: ParameterDefinition,
  value: number,
): string {
  if (definition.id === SYNTH_WAVEFORM.id) {
    return capitalize(synthWaveform(value));
  }
  switch (definition.unit) {
    case "hertz":
      return value >= 1000 ? `${trim(value / 1000, 1)} kHz` : `${Math.round(value)} Hz`;
    case "seconds":
      return value < 1 ? `${Math.round(value * 1000)} ms` : `${trim(value, 2)} s`;
    case "semitones": {
      const rounded = Math.round(value);
      return `${rounded > 0 ? "+" : ""}${rounded} st`;
    }
    case "decibels":
      return `${trim(value, 1)} dB`;
    case "normalized":
      // Sustain and resonance are dimensionless; start/end read as a percent.
      return definition.max <= 1 ? `${Math.round(value * 100)}%` : trim(value, 2);
    default:
      return trim(value, 2);
  }
}

function trim(value: number, places: number): string {
  return String(Number(value.toFixed(places)));
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
