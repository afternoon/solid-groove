import { For, type JSX, Show } from "@solidjs/web";
import type {
  Gesture,
  GestureOptions,
  ParameterTarget,
  RawCommandInput,
  TransactionResult,
} from "../commands";
import { createControlGesture, setParameter } from "../commands";
import { deviceParameters } from "../domain/devices";
import type { Device } from "../domain/entities";
import { bareParameterId, type ParameterDefinition } from "../domain/parameters";
import FillSlider from "../instrument/FillSlider";
import {
  deviceExtremeLabel,
  deviceValueExtreme,
  discreteDeviceOptions,
  formatDeviceValue,
  isDiscreteDeviceParameter,
} from "./deviceValue";
import "./DevicePanel.css";

export interface DeviceControlsProps {
  readonly device: Device;
  /**
   * Builds the `parameter.set` target for one of this device's parameters.
   *
   * The chain a device sits in is the caller's business, not this component's:
   * the master panel passes a `masterDevice` target, and the track chains
   * (#241) will pass a `trackDevice` one into the same controls. Everything
   * else — which parameters exist, their ranges, their defaults, their
   * clamping — comes from the registry.
   */
  parameterTarget(parameterId: string): ParameterTarget;
  dispatch(
    commands: RawCommandInput | readonly RawCommandInput[],
  ): TransactionResult | undefined;
  beginGesture(options?: GestureOptions): Gesture | undefined;
}

/**
 * One device's controls, generated from its parameter definitions (PRD FX-01,
 * FX-02, section 8).
 *
 * There is no per-device layout and no literal range, default, step, or unit in
 * this file: `deviceParameters(device.type)` returns the definitions in panel
 * order and each one describes itself. That is what makes the six device types
 * — and any type registered later — reachable without a component per device.
 *
 * A continuous parameter gets a fill-slider driven by `createControlGesture`,
 * so a drag applies every step live (the sound follows the pointer) and the
 * release commits the whole drag as one history entry, one revision, and one
 * save. A stepped, non-automatable parameter is an index into a named set —
 * a filter's mode, a delay's division — so it gets a select whose options are
 * those names rather than a slider through meaningless numbers.
 *
 * FX-02 is the reason a value driven to a bound is *labelled* rather than
 * eased back: `deviceValueExtreme` reports it, the readout says so, and
 * nothing here rewrites what the producer set.
 */
export default function DeviceControls(props: DeviceControlsProps): JSX.Element {
  const definitions = () => deviceParameters(props.device.type);

  const currentValue = (definition: ParameterDefinition): number =>
    props.device.parameters[bareParameterId(definition.id)] ?? definition.defaultValue;

  return (
    <div class="device-controls">
      <Show
        when={definitions().length > 0}
        fallback={
          // A device type the registry does not know still renders, because the
          // audio layer gives it an inert passthrough and the chain must stay
          // legible rather than showing an empty box with no explanation.
          <p class="device-controls-empty">This device has no controls.</p>
        }
      >
        <For each={definitions()}>
          {(definition) => (
            <Show
              when={!isDiscreteDeviceParameter(definition)}
              fallback={
                <DeviceChoice
                  definition={definition}
                  value={currentValue(definition)}
                  {...props}
                />
              }
            >
              <DeviceSlider
                definition={definition}
                value={currentValue(definition)}
                {...props}
              />
            </Show>
          )}
        </For>
      </Show>
    </div>
  );
}

interface ControlProps extends DeviceControlsProps {
  readonly definition: ParameterDefinition;
  readonly value: number;
}

/** A unique element id, since two devices of one type can share a chain. */
function controlId(props: ControlProps): string {
  return `device-${props.device.id}-${bareParameterId(props.definition.id)}`;
}

function DeviceSlider(props: ControlProps): JSX.Element {
  const parameterId = () => bareParameterId(props.definition.id);
  const extreme = () => deviceValueExtreme(props.definition, props.value);
  const control = createControlGesture({
    beginGesture: (options) => props.beginGesture(options),
    dispatch: (commands) => props.dispatch(commands),
    summary: () => `Set ${props.definition.label}`,
    command: (value) => setParameter(props.parameterTarget(parameterId()), value),
  });

  return (
    <div class="device-control">
      <FillSlider
        definition={props.definition}
        inputId={controlId(props)}
        // The parameter's own label is the accessible name. Two devices can
        // each have a "Drive", which is why every chain entry is a labelled
        // group naming its device — the name is unambiguous in context rather
        // than padded with an id no one can hear.
        ariaLabel={props.definition.label}
        value={props.value}
        displayValue={formatDeviceValue(props.definition, props.value)}
        onInput={(value) => control.input(value)}
        onCommit={(value) => control.commit(value)}
      />
      <Show when={deviceExtremeLabel(extreme())}>
        {(label) => (
          // Announced, not decorative: FX-02's position is that an extreme is
          // reachable *and said out loud*, never normalized away.
          <span class="device-control-extreme">{label()}</span>
        )}
      </Show>
    </div>
  );
}

function DeviceChoice(props: ControlProps): JSX.Element {
  const parameterId = () => bareParameterId(props.definition.id);
  const options = () => discreteDeviceOptions(props.definition);
  const selected = () => Math.round(props.value) - props.definition.min;

  return (
    <div class="device-control device-control-choice">
      <label class="device-control-label" for={controlId(props)}>
        {props.definition.label}
      </label>
      {/* A discrete choice is one command with no gesture to hold open. */}
      <select
        id={controlId(props)}
        class="device-control-select"
        value={String(selected())}
        onChange={(event) =>
          props.dispatch(
            setParameter(
              props.parameterTarget(parameterId()),
              props.definition.min + Number(event.currentTarget.value),
            ),
          )
        }
      >
        <For each={options()}>
          {(label, index) => <option value={String(index())}>{label}</option>}
        </For>
      </select>
    </div>
  );
}
