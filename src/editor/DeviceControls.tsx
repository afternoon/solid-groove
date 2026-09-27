import { For, type JSX, Show } from "@solidjs/web";
import {
  createControlGesture,
  type Gesture,
  type GestureOptions,
  type RawCommandInput,
  setParameter,
  type TransactionResult,
} from "../commands";
import { deviceParameters } from "../domain/devices";
import type { Device } from "../domain/entities";
import type { TrackId } from "../domain/ids";
import { bareParameterId, type ParameterDefinition } from "../domain/parameters";
import FillSlider from "../instrument/FillSlider";
import { formatInstrumentValue } from "../instrument/formatValue";
import OptionGroup from "../instrument/OptionGroup";
import { deviceChoices, readDeviceParameter } from "./deviceControlModel";
import "./DeviceControls.css";

export interface DeviceControlsProps {
  readonly trackId: TrackId;
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
 * Every control writes through `parameter.set` in the `trackDevice` scope, the
 * same shared command an instrument slider uses, so a device edit is
 * validated, clamped by its definition, undoable and saved like any other. A
 * slider drag is one gesture (`createControlGesture`): it applies live, so the
 * fill and the audio follow the pointer, and the release commits the whole
 * drag as one history entry, one revision and one save. A mode choice is one
 * plain command.
 *
 * Element ids and radio names carry the device's id, because a chain may hold
 * two of the same device — a duplicated reverb has a second "Size".
 */
export default function DeviceControls(props: DeviceControlsProps): JSX.Element {
  const command = (definition: ParameterDefinition, value: number) =>
    setParameter(
      {
        scope: "trackDevice",
        trackId: props.trackId,
        deviceId: props.device.id,
        parameterId: bareParameterId(definition.id),
      },
      value,
    );
  const key = (definition: ParameterDefinition) =>
    `device-${props.device.id}-${bareParameterId(definition.id)}`;

  return (
    <div class="device-controls">
      <For each={deviceParameters(props.device.type)}>
        {(definition) => {
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
                <div class="device-choice">
                  <span class="device-choice-label" aria-hidden="true">
                    {definition.label}
                  </span>
                  <OptionGroup
                    legend={definition.label}
                    radioGroup={key(definition)}
                    value={value()}
                    options={options()}
                    onSelect={(next) => props.dispatch(command(definition, next))}
                  />
                </div>
              )}
            </Show>
          );
        }}
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
    <FillSlider
      definition={props.definition}
      value={props.value}
      inputId={props.inputId}
      displayValue={formatInstrumentValue(props.definition, props.value)}
      onInput={(next) => control.input(next)}
      onCommit={(next) => control.commit(next)}
    />
  );
}
