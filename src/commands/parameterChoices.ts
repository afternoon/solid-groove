import { DELAY_DIVISIONS, EQ_BANDS } from "../domain/devices";
import {
  type ParameterDefinition,
  SYNTH_WAVEFORM,
  SYNTH_WAVEFORMS,
} from "../domain/parameters";

/**
 * The names of a stepped mode parameter's choices: what a filter's type, a
 * delay's sync and note division, an EQ band's switch or a synth's waveform
 * reads as on screen, by the index each one stores. The index is the choice's
 * position, exactly as the audio layer reads it.
 *
 * It lives beside the commands, not the controls, because both read it: the
 * controls to label their options, and `parameter.set` to name an edit in the
 * undo history by what the user picked ("Set Division to 1/8"), never by the
 * number behind it (GRV-63).
 */
const CHOICE_LABELS: Readonly<Record<string, readonly string[]>> = {
  "filter.mode": ["Low pass", "High pass", "Band pass"],
  "delay.sync": ["Free", "Synced"],
  "delay.division": DELAY_DIVISIONS.map((division) => division.label),
  [SYNTH_WAVEFORM.id]: SYNTH_WAVEFORMS.map(
    (waveform) => waveform.charAt(0).toUpperCase() + waveform.slice(1),
  ),
  ...Object.fromEntries(EQ_BANDS.map((band) => [`eq.${band.id}On`, ["Off", "On"]])),
};

/**
 * Switches: a mode whose two choices are "off" and "on", however its options
 * are labelled. An edit to one reads "Turn Sync on", not "Set Sync to Synced".
 */
const SWITCHES: ReadonlySet<string> = new Set([
  "delay.sync",
  ...EQ_BANDS.map((band) => `eq.${band.id}On`),
]);

/** True for a stepped mode: a whole-number index the user picks by name. */
export function isModeParameter(definition: ParameterDefinition): boolean {
  return definition.step === 1 && definition.clampPolicy === "reject";
}

/**
 * The name of one choice of a mode parameter, or `null` when the parameter has
 * no named choices. Only the choice's own name: a summary decides how to say it.
 */
export function parameterChoiceLabel(
  definition: ParameterDefinition,
  value: number,
): string | null {
  return CHOICE_LABELS[definition.id]?.[value - definition.min] ?? null;
}

/**
 * The one-line history summary for setting `definition` to `value`, when the
 * parameter is a named mode: "Turn Sync on" for a switch, "Set Division to 1/8"
 * for any other choice. `null` for a parameter with no named choices.
 */
export function summarizeParameterChoice(
  definition: ParameterDefinition,
  value: number,
): string | null {
  if (!isModeParameter(definition)) return null;
  if (SWITCHES.has(definition.id)) {
    return `Turn ${definition.label} ${value > definition.min ? "on" : "off"}`;
  }
  const label = parameterChoiceLabel(definition, value);
  return label === null ? null : `Set ${definition.label} to ${label}`;
}
