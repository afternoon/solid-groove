import { For, type JSX } from "@solidjs/web";
import { HiSolidArrowPath, HiSolidDocumentDuplicate, HiSolidTrash } from "solid-icons/hi";
import type { DeviceOperation } from "../analytics/catalog";
import type {
  Gesture,
  GestureOptions,
  ParameterTarget,
  RawCommandInput,
  TransactionResult,
} from "../commands";
import {
  duplicateDevice,
  masterChain,
  removeDevice,
  reorderDevice,
  resetDevice,
  setDeviceBypass,
} from "../commands";
import { deviceTypeDefinition } from "../domain/devices";
import type { Device } from "../domain/entities";
import { createFactoryContext } from "../domain/factories";
import { ariaBool } from "../shared/aria";
import DeviceControls from "./DeviceControls";
import "./DevicePanel.css";

/** Mints IDs for the copies this card creates. A module singleton. */
const factoryContext = createFactoryContext();

export interface MasterDeviceProps {
  readonly device: Device;
  readonly index: number;
  readonly count: number;
  /** Dispatches one device command and reports a refusal (see `MasterPanel`). */
  edit(operation: DeviceOperation, command: RawCommandInput): boolean;
  dispatch(
    commands: RawCommandInput | readonly RawCommandInput[],
  ): TransactionResult | undefined;
  beginGesture(options?: GestureOptions): Gesture | undefined;
}

/**
 * One device on the master chain: what it is, what it does to the sound, and
 * every edit the chain allows (PRD FX-01).
 *
 * Remove, reorder, duplicate, bypass and reset are the five remaining
 * `device.*` commands, each dispatched on its own so each is one revision and
 * one undoable history entry. Its controls come from `DeviceControls`, which
 * generates them from the device's registered parameter definitions; this card
 * supplies only the `masterDevice` target that says which chain they write to.
 */
export default function MasterDevice(props: MasterDeviceProps): JSX.Element {
  const label = () => deviceTypeDefinition(props.device.type)?.label ?? props.device.type;
  /** Position, so two devices of one type still have distinct action names. */
  const at = () => `${label()}, position ${props.index + 1}`;
  const parameterTarget = (parameterId: string): ParameterTarget => ({
    scope: "masterDevice",
    deviceId: props.device.id,
    parameterId,
  });

  /** The chain actions, in the order they sit on the card. */
  const actions = (): readonly ChainAction[] => [
    {
      key: "earlier",
      label: `Move ${at()} earlier`,
      glyph: "‹",
      disabled: props.index === 0,
      run: () =>
        props.edit(
          "reorder",
          reorderDevice(masterChain, props.device.id, props.index - 1),
        ),
    },
    {
      key: "later",
      label: `Move ${at()} later`,
      glyph: "›",
      disabled: props.index >= props.count - 1,
      run: () =>
        props.edit(
          "reorder",
          reorderDevice(masterChain, props.device.id, props.index + 1),
        ),
    },
    {
      key: "bypass",
      label: `Bypass ${at()}`,
      glyph: "B",
      pressed: props.device.bypassed,
      run: () =>
        props.edit(
          "bypass",
          setDeviceBypass(masterChain, props.device.id, !props.device.bypassed),
        ),
    },
    {
      key: "reset",
      label: `Reset ${at()}`,
      glyph: <HiSolidArrowPath size={13} />,
      run: () => props.edit("reset", resetDevice(masterChain, props.device.id)),
    },
    {
      key: "duplicate",
      label: `Duplicate ${at()}`,
      glyph: <HiSolidDocumentDuplicate size={13} />,
      run: () =>
        props.edit(
          "duplicate",
          duplicateDevice(masterChain, props.device.id, factoryContext.ids("device")),
        ),
    },
    {
      key: "remove",
      label: `Remove ${at()}`,
      glyph: <HiSolidTrash size={13} />,
      run: () => props.edit("remove", removeDevice(masterChain, props.device.id)),
    },
  ];

  return (
    // A `<fieldset>` rather than a `role="group"` div: it carries the grouping
    // semantics natively, and the group is what keeps a second "Drive" one
    // link down the chain unambiguous to a screen reader.
    <fieldset
      class={["master-device", { bypassed: props.device.bypassed }]}
      aria-label={at()}
    >
      <div class="master-device-head">
        <span class="master-device-name">{label()}</span>
        <div class="master-device-actions">
          <For each={actions()}>
            {(action) => (
              <button
                type="button"
                class={["master-device-action", { active: action.pressed === true }]}
                aria-label={action.label}
                aria-pressed={
                  action.pressed === undefined ? undefined : ariaBool(action.pressed)
                }
                disabled={action.disabled}
                onClick={() => action.run()}
              >
                {action.glyph}
              </button>
            )}
          </For>
        </div>
      </div>
      <DeviceControls
        device={props.device}
        parameterTarget={parameterTarget}
        dispatch={props.dispatch}
        beginGesture={props.beginGesture}
      />
    </fieldset>
  );
}

interface ChainAction {
  readonly key: string;
  /** The accessible name; there is no visible text on these. */
  readonly label: string;
  readonly glyph: JSX.Element;
  readonly disabled?: boolean;
  /** Set only for a toggle, which is the one action that reports a state. */
  readonly pressed?: boolean;
  run(): void;
}
