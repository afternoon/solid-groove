import type { DeviceChainTarget, ParameterTarget } from "../commands";
import { DELAY_DIVISIONS, delayDivision, deviceParameters } from "../domain/devices";
import type { Device } from "../domain/entities";
import type { DeviceId } from "../domain/ids";
import { bareParameterId, type ParameterDefinition } from "../domain/parameters";
import { formatInstrumentValue } from "../instrument/formatValue";
import { delayTime } from "./deviceDrawings";

/**
 * How one device parameter is shown (PRD FX-01: a device's own controls,
 * never a preset picker).
 *
 * The control is derived from the parameter's definition in
 * `src/domain/devices.ts`, not written per device: a continuous value is a
 * fill-slider, and a stepped mode — a filter's type, a delay's sync and note
 * division — is a named option group, because "1" is not a musical answer to
 * "which filter?". Only the *names* of those choices live here; the index each
 * one stores is its position, exactly as the audio layer reads it.
 */
const CHOICE_LABELS: Readonly<Record<string, readonly string[]>> = {
  "filter.mode": ["Low pass", "High pass", "Band pass"],
  "delay.sync": ["Free", "Synced"],
  "delay.division": DELAY_DIVISIONS.map((division) => division.label),
};

export interface DeviceChoice {
  readonly value: number;
  readonly label: string;
}

/**
 * The named choices for a stepped mode parameter, or `null` for a continuous
 * one. A stepped parameter nobody has named yet falls back to its numbers, so
 * a new device type is never left without a control.
 */
export function deviceChoices(definition: ParameterDefinition): DeviceChoice[] | null {
  const isMode = definition.step === 1 && definition.clampPolicy === "reject";
  if (!isMode) return null;
  const labels = CHOICE_LABELS[definition.id];
  const choices: DeviceChoice[] = [];
  for (let value = definition.min; value <= definition.max; value += 1) {
    choices.push({ value, label: labels?.[value - definition.min] ?? String(value) });
  }
  return choices;
}

/** A device's current value for one of its parameters, defaulted when unset. */
export function readDeviceParameter(
  device: Device,
  definition: ParameterDefinition,
): number {
  return device.parameters[bareParameterId(definition.id)] ?? definition.defaultValue;
}

/** What one device control shows: the value in use, and whether it is set by another. */
export interface DeviceControlReading {
  /** The value the device is actually using, in the parameter's own unit. */
  readonly value: number;
  /**
   * True when another setting decides the value, so the control shows it but
   * does not set it: a synced delay's time comes from its division and the
   * song tempo, and its stored free time is not in use (#865).
   */
  readonly derived: boolean;
}

/**
 * The value a device control shows. Usually the stored value; but a synced
 * delay's Time reads the time the division gives at `tempo`, computed by the
 * same `delayTime` the delay's well reads out, so the two never disagree.
 */
export function readDeviceControl(
  device: Device,
  definition: ParameterDefinition,
  tempo: number,
): DeviceControlReading {
  const stored = readDeviceParameter(device, definition);
  if (definition.id !== "delay.time") return { value: stored, derived: false };
  const setting = (id: string) => {
    const sibling = deviceParameters(device.type).find((d) => d.id === `delay.${id}`);
    return sibling ? readDeviceParameter(device, sibling) : 0;
  };
  if (setting("sync") < 0.5) return { value: stored, derived: false };
  const division = delayDivision(setting("division")).wholeNotes;
  return { value: delayTime(true, stored, division, tempo), derived: true };
}

/**
 * The `parameter.set` target for one parameter of a device in `chain`: a
 * track's inserts write through `trackDevice`, the master's through
 * `masterDevice`. The device's controls are the same component either way;
 * only this address differs. Return buses have no device parameter scope yet,
 * and no surface renders their chains.
 */
export function deviceParameterTarget(
  chain: DeviceChainTarget,
  deviceId: DeviceId,
  parameterId: string,
): ParameterTarget {
  switch (chain.chain) {
    case "insert":
      return { scope: "trackDevice", trackId: chain.trackId, deviceId, parameterId };
    case "master":
      return { scope: "masterDevice", deviceId, parameterId };
    case "return":
      throw new Error("A return bus's devices have no parameter.set scope");
  }
}

/**
 * A continuous device value in its own unit, for the slider's reading. The
 * instrument panel's formatter already speaks hertz, seconds, decibels and
 * percent; a compressor's ratio is the one device quantity whose unit is a
 * relationship, so it reads "4.0:1" as every compressor prints it.
 */
export function formatDeviceValue(
  definition: ParameterDefinition,
  value: number,
): string {
  if (bareParameterId(definition.id) === "ratio") return `${value.toFixed(1)}:1`;
  return formatInstrumentValue(definition, value);
}
