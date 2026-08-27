import { delayDivision, FILTER_MODES } from "../domain/devices";
import { bareParameterId, type ParameterDefinition } from "../domain/parameters";
import { formatInstrumentValue } from "../instrument/formatValue";

/**
 * Human-readable values for a device's controls (PRD FX-01, FX-02, section 8).
 *
 * The master panel generates its controls from `deviceParameters(type)` alone,
 * so nothing about a device's range, default, unit, or clamping is written into
 * a component. What a definition cannot supply is what a *number* means to a
 * producer: `filter.mode` is stored as `0`, `delay.division` as an index, and a
 * compressor's ratio reads as `4:1` rather than `4`. This module is the one
 * place those readings live.
 *
 * Continuous values are formatted by `formatInstrumentValue`, which already
 * turns a parameter's unit into the "live value below" line of a fill-slider
 * (design mock `06c`) — hertz switching to kHz, sub-second times in
 * milliseconds, decibels, normalized values as a percent. It is named for the
 * surface that first needed it, but it reads nothing but the `unit` and range
 * of a `ParameterDefinition`, so a device parameter formats identically and
 * gets one vocabulary across both panels for free.
 */

/** `delay.sync`: whether the delay follows the tempo or a free time in seconds. */
const DELAY_SYNC_MODES = ["Free", "Synced"] as const;

/**
 * The discrete device parameters, by their full `type.id`.
 *
 * A stepped, `reject`-clamped, non-automatable parameter (see
 * `src/domain/devices.ts`) is an *index into a named set*, not a quantity, so
 * its slider reading has to be the name. The definition carries the step and
 * the bounds; only the names live here.
 */
const DISCRETE_READINGS: Record<string, (value: number) => string> = {
  "filter.mode": (value) => capitalize(FILTER_MODES[clampIndex(value, FILTER_MODES)]),
  "delay.sync": (value) => DELAY_SYNC_MODES[clampIndex(value, DELAY_SYNC_MODES)],
  "delay.division": (value) => delayDivision(value).label,
};

/** Whether a parameter reads as a name rather than a quantity. */
export function isDiscreteDeviceParameter(definition: ParameterDefinition): boolean {
  return definition.id in DISCRETE_READINGS;
}

/** The named options of a discrete parameter, in stored-index order. */
export function discreteDeviceOptions(
  definition: ParameterDefinition,
): readonly string[] {
  const read = DISCRETE_READINGS[definition.id];
  if (!read) return [];
  const options: string[] = [];
  for (let index = definition.min; index <= definition.max; index += 1) {
    options.push(read(index));
  }
  return options;
}

/** The live reading shown beside one device control, in its own unit. */
export function formatDeviceValue(
  definition: ParameterDefinition,
  value: number,
): string {
  const discrete = DISCRETE_READINGS[definition.id];
  if (discrete) return discrete(value);
  // A compressor's ratio is the one quantity whose unit is a relationship
  // rather than a scale: "4" is meaningless where "4.0:1" is the number every
  // compressor in the world prints.
  if (bareParameterId(definition.id) === "ratio") {
    return `${value.toFixed(1)}:1`;
  }
  return formatInstrumentValue(definition, value);
}

export type DeviceValueExtreme = "min" | "max" | null;

/**
 * Whether a value is sitting at one end of its own range (PRD FX-02).
 *
 * Extreme settings are reachable on purpose — drive, feedback, decay and
 * resonance all reach obviously destructive places — and the product's position
 * is that they are *labelled*, never quietly pulled back toward a safe sound.
 * So this reports the fact rather than acting on it, and the panel says so
 * beside the control.
 *
 * Derived entirely from the definition: a bound is a bound, and no per-device
 * table of "which knobs are dangerous" is written anywhere. A value at a bound
 * that *is* the parameter's default is not reported — `delay.spread` and
 * `overdrive.drive`'s neighbours start at their minimum, and calling a
 * factory setting extreme would make the label mean nothing.
 */
export function deviceValueExtreme(
  definition: ParameterDefinition,
  value: number,
): DeviceValueExtreme {
  if (isDiscreteDeviceParameter(definition)) return null;
  const span = definition.max - definition.min;
  if (!(span > 0) || !Number.isFinite(value)) return null;
  // A whisker of the range, so a slider dragged to the end reports the end
  // without a float comparison deciding it landed a step short.
  const epsilon = span * 0.005;
  if (near(value, definition.defaultValue, epsilon)) return null;
  if (value >= definition.max - epsilon) return "max";
  if (value <= definition.min + epsilon) return "min";
  return null;
}

/** The words shown beside a control that has been driven to a bound. */
export function deviceExtremeLabel(extreme: DeviceValueExtreme): string | null {
  if (extreme === "max") return "at maximum";
  if (extreme === "min") return "at minimum";
  return null;
}

function near(value: number, other: number, epsilon: number): boolean {
  return Math.abs(value - other) <= epsilon;
}

function clampIndex(value: number, options: readonly unknown[]): number {
  return Math.min(options.length - 1, Math.max(0, Math.round(value)));
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
