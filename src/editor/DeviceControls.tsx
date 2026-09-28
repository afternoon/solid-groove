import { For, type JSX, Show } from "@solidjs/web";
import { createMemo } from "solid-js";
import {
  createControlGesture,
  type DeviceChainTarget,
  type Gesture,
  type GestureOptions,
  type RawCommandInput,
  setParameter,
  type TransactionResult,
} from "../commands";
import { deviceParameters } from "../domain/devices";
import type { Device } from "../domain/entities";
import { bareParameterId, type ParameterDefinition } from "../domain/parameters";
import ControlGroup from "../instrument/ControlGroup";
import FillSlider from "../instrument/FillSlider";
import OptionGroup from "../instrument/OptionGroup";
import {
  deviceChoices,
  deviceParameterTarget,
  formatDeviceValue,
  readDeviceParameter,
} from "./deviceControlModel";
import "./DeviceControls.css";
import { deviceGroups } from "./deviceFaceplate";

export interface DeviceControlsProps {
  /** The chain the device is in, which decides its parameters' address. */
  readonly chain: DeviceChainTarget;
  readonly device: Device;
  dispatch(
    commands: RawCommandInput | readonly RawCommandInput[],
  ): TransactionResult | undefined;
  beginGesture(options?: GestureOptions): Gesture | undefined;
}

/**
 * One insert device's own controls, built from its parameter definitions
 * (PRD FX-01: "musically relevant controls, not a preset picker").
 *
 * Every control writes through `parameter.set` — `trackDevice` for a track's
 * inserts, `masterDevice` for the master's — the same shared command an
 * instrument slider uses, so a device edit is
 * validated, clamped by its definition, undoable and saved like any other. A
 * slider drag is one gesture (`createControlGesture`): it applies live, so the
 * fill and the audio follow the pointer, and the release commits the whole
 * drag as one history entry, one revision and one save. A mode choice is one
 * plain command.
 *
 * Element ids and radio names carry the device's id, because a chain may hold
 * two of the same device — a duplicated reverb has a second "Size".
 *
 * The controls stand in Juno-style banks (#447, `deviceFaceplate.ts`): a mode
 * is a switch as tall as the faders, and each bank's width follows its number
 * of controls, so every fader on a card sits on one pitch.
 */
export default function DeviceControls(props: DeviceControlsProps): JSX.Element {
  const command = (definition: ParameterDefinition, value: number) =>
    setParameter(
      deviceParameterTarget(props.chain, props.device.id, bareParameterId(definition.id)),
      value,
    );
  const key = (definition: ParameterDefinition) =>
    `device-${props.device.id}-${bareParameterId(definition.id)}`;

  // Grouped once per device type, not per edit: a new list on every value
  // change would remount the banks — and the slider being dragged with them.
  const type = createMemo(() => props.device.type);
  const groups = createMemo(() => deviceGroups(type(), deviceParameters(type())));

  const control = (definition: ParameterDefinition): JSX.Element => {
    const value = () => readDeviceParameter(props.device, definition);
    const choices = deviceChoices(definition);
    return (
      <Show
        when={choices}
        fallback={
          <DeviceSlider
            definition={definition}
            value={value()}
            inputId={key(definition)}
            command={(next) => command(definition, next)}
            dispatch={props.dispatch}
            beginGesture={props.beginGesture}
          />
        }
      >
        {(options) => (
          <OptionGroup
            legend={definition.label}
            radioGroup={key(definition)}
            fill
            value={value()}
            options={options()}
            onSelect={(next) => props.dispatch(command(definition, next))}
          />
        )}
      </Show>
    );
  };

  return (
    <div class="device-controls">
      <For each={groups()}>
        {(group) => (
          <ControlGroup
            title={group.title}
            plainTitle
            class={
              group.parameters.some((d) => deviceChoices(d)) ? "device-switch" : undefined
            }
            style={{ "--controls": String(group.parameters.length) }}
          >
            <For each={group.parameters}>{(definition) => control(definition)}</For>
          </ControlGroup>
        )}
      </For>
    </div>
  );
}

function DeviceSlider(props: {
  readonly definition: ParameterDefinition;
  readonly value: number;
  readonly inputId: string;
  command(value: number): RawCommandInput;
  dispatch(
    commands: RawCommandInput | readonly RawCommandInput[],
  ): TransactionResult | undefined;
  beginGesture(options?: GestureOptions): Gesture | undefined;
}): JSX.Element {
  const control = createControlGesture({
    beginGesture: (options) => props.beginGesture(options),
    dispatch: (commands) => props.dispatch(commands),
    summary: () => `Set ${props.definition.label}`,
    command: (next) => props.command(next),
  });
  return (
    <div class="device-control">
      <FillSlider
        definition={props.definition}
        value={props.value}
        inputId={props.inputId}
        displayValue={formatDeviceValue(props.definition, props.value)}
        onInput={(next) => control.input(next)}
        onCommit={(next) => control.commit(next)}
      />
    </div>
  );
}
