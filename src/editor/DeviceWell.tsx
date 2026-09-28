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
import DragSurface from "../instrument/DragSurface";
import FilterWell from "../instrument/FilterWell";
import Well from "../instrument/Well";
import {
  deviceParameterTarget,
  formatDeviceValue,
  readDeviceParameter,
} from "./deviceControlModel";
import {
  overdriveTransfer,
  REVERB_WINDOW,
  reverbTailPath,
  reverbTiming,
  saturatorTransfer,
  transferPath,
} from "./deviceDrawings";

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

/** Normalised position of `value` along `definition`'s range. */
const along = (definition: ParameterDefinition, value: number) =>
  (value - definition.min) / (definition.max - definition.min);
/** The value at `position` (0..1) along `definition`'s range. */
const at = (definition: ParameterDefinition, position: number) =>
  definition.min + position * (definition.max - definition.min);

const WIDTH = 300;
const HEIGHT = 100;

/**
 * A well with one point to drag between two parameters, over whatever it
 * draws: left and right set `x`, up and down `y`.
 */
function PointWell(props: {
  readonly title: string;
  readonly readout: string;
  readonly scale?: readonly string[];
  readonly class: string;
  readonly x: ParameterDefinition;
  readonly y: ParameterDefinition;
  readonly values: { readonly x: number; readonly y: number };
  /**
   * Where `x`'s value sits across the well, and back, when that is not simply
   * along its range — a reverb's point sits where its tail ends.
   */
  readonly xAxis?: { at(value: number): number; value(position: number): number };
  readonly children: JSX.Element;
  command(definition: ParameterDefinition, value: number): RawCommandInput;
  dispatch(
    commands: RawCommandInput | readonly RawCommandInput[],
  ): TransactionResult | undefined;
  beginGesture(options?: GestureOptions): Gesture | undefined;
}): JSX.Element {
  return (
    <Well
      title={props.title}
      value={props.readout}
      scale={props.scale}
      class={props.class}
    >
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {props.children}
      </svg>
      <DragSurface
        grab={() => "point" as const}
        commands={(point) => [
          props.command(
            props.x,
            props.xAxis ? props.xAxis.value(point.x) : at(props.x, point.x),
          ),
          props.command(props.y, at(props.y, point.y)),
        ]}
        summary={() => `Shape ${props.title.toLowerCase()}`}
        dispatch={(commands) => props.dispatch(commands)}
        beginGesture={(options) => props.beginGesture(options)}
      >
        <i
          class="drag-handle"
          style={{
            left: `${(props.xAxis ? props.xAxis.at(props.values.x) : along(props.x, props.values.x)) * 100}%`,
            top: `${(1 - along(props.y, props.values.y)) * 100}%`,
          }}
        />
      </DragSurface>
    </Well>
  );
}

const WELL_TYPES = new Set(["filter", "overdrive", "saturator", "reverb"]);

/** Whether `device` has a well yet; one without gives its banks the card. */
export function hasDeviceWell(device: Device): boolean {
  return WELL_TYPES.has(device.type);
}

/**
 * The well that draws what a device does to the sound (#447). Its drags write
 * the same `parameter.set` the device's faders do.
 */
export default function DeviceWell(props: DeviceWellProps): JSX.Element {
  const value = (definition: ParameterDefinition) =>
    readDeviceParameter(props.device, definition);
  const command = (definition: ParameterDefinition, next: number) =>
    setParameter(
      deviceParameterTarget(props.chain, props.device.id, bareParameterId(definition.id)),
      next,
    );
  const edits = {
    command,
    dispatch: (commands: RawCommandInput | readonly RawCommandInput[]) =>
      props.dispatch(commands),
    beginGesture: (options?: GestureOptions) => props.beginGesture(options),
  };
  const type = props.device.type;
  const p = (id: string) => parameter(type, id) as ParameterDefinition;
  const show = (definition: ParameterDefinition) =>
    formatDeviceValue(definition, value(definition));

  if (type === "overdrive" || type === "saturator") {
    const x = type === "overdrive" ? p("tone") : p("character");
    const y = p("drive");
    const curve = () =>
      type === "overdrive"
        ? (input: number) => overdriveTransfer(value(y), input)
        : (input: number) => saturatorTransfer(value(y), value(x), input);
    return (
      <PointWell
        title="Transfer"
        readout={`${show(y)} drive`}
        scale={["In −1", "0", "+1"]}
        class="transfer-well"
        x={x}
        y={y}
        values={{ x: value(x), y: value(y) }}
        {...edits}
      >
        <line class="well-grid" x1={WIDTH / 2} x2={WIDTH / 2} y1="0" y2={HEIGHT} />
        <line class="well-grid" x1="0" x2={WIDTH} y1={HEIGHT / 2} y2={HEIGHT / 2} />
        <path class="well-line" d={transferPath(curve(), WIDTH, HEIGHT)} />
      </PointWell>
    );
  }

  if (type === "reverb") {
    const decay = p("decay");
    const size = p("size");
    const predelay = p("predelay");
    return (
      <PointWell
        title="Tail"
        readout={`${show(decay)} · ${show(size)}`}
        scale={["0", "2 s", "4 s", "6 s", "8 s"]}
        class="reverb-well"
        x={decay}
        y={size}
        values={{ x: value(decay), y: value(size) }}
        xAxis={{
          at: (seconds) => {
            const timing = reverbTiming(seconds, value(size), value(predelay));
            return Math.min(1, (timing.predelay + timing.decay) / REVERB_WINDOW);
          },
          value: (position) => {
            const { predelay: start } = reverbTiming(0, value(size), value(predelay));
            const seconds = (position * REVERB_WINDOW - start) / (0.5 + value(size));
            return Math.min(decay.max, Math.max(decay.min, seconds));
          },
        }}
        {...edits}
      >
        <path
          class="well-area"
          d={reverbTailPath(value(decay), value(size), value(predelay), WIDTH, HEIGHT)}
        />
        <path
          class="well-line"
          d={reverbTailPath(value(decay), value(size), value(predelay), WIDTH, HEIGHT)}
        />
      </PointWell>
    );
  }
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
