import type { JSX } from "@solidjs/web";
import type {
  DeviceChainTarget,
  Gesture,
  GestureOptions,
  RawCommandInput,
  TransactionResult,
} from "../commands";
import { setParameter } from "../commands";
import { deviceParameters, FILTER_MODES } from "../domain/devices";
import type { Device } from "../domain/entities";
import { bareParameterId, type ParameterDefinition } from "../domain/parameters";
import FilterWell from "../instrument/FilterWell";
import {
  deviceParameterTarget,
  formatDeviceValue,
  readDeviceParameter,
} from "./deviceControlModel";

export interface DeviceWellProps {
  readonly chain: DeviceChainTarget;
  readonly device: Device;
  dispatch(
    commands: RawCommandInput | readonly RawCommandInput[],
  ): TransactionResult | undefined;
  beginGesture(options?: GestureOptions): Gesture | undefined;
}

/** A device type's parameter by its bare id. */
function parameter(type: string, id: string): ParameterDefinition | undefined {
  return deviceParameters(type).find(
    (definition) => bareParameterId(definition.id) === id,
  );
}

/**
 * The well that draws what a device does to the sound (#447), or nothing for
 * a device that has no drawing yet. Its drags write the same `parameter.set`
 * the device's faders do.
 */
export function hasDeviceWell(device: Device): boolean {
  return device.type === "filter";
}

export default function DeviceWell(props: DeviceWellProps): JSX.Element {
  const value = (definition: ParameterDefinition) =>
    readDeviceParameter(props.device, definition);
  const command = (definition: ParameterDefinition, next: number) =>
    setParameter(
      deviceParameterTarget(props.chain, props.device.id, bareParameterId(definition.id)),
      next,
    );

  const cutoff = parameter("filter", "cutoff");
  const resonance = parameter("filter", "resonance");
  const mode = parameter("filter", "mode");
  if (props.device.type !== "filter" || !cutoff || !resonance || !mode) return null;
  const shape = () => FILTER_MODES[Math.round(value(mode))] ?? "lowpass";

  return (
    <FilterWell
      shape={shape()}
      cutoff={cutoff}
      resonance={resonance}
      values={{ cutoff: value(cutoff), resonance: value(resonance) }}
      readout={`${formatDeviceValue(cutoff, value(cutoff))} · Q ${formatDeviceValue(resonance, value(resonance))}`}
      command={command}
      dispatch={(commands) => props.dispatch(commands)}
      beginGesture={(options) => props.beginGesture(options)}
    />
  );
}
