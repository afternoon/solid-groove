import type { JSX } from "@solidjs/web";
import {
  HiSolidArrowPath,
  HiSolidDocumentDuplicate,
  HiSolidPower,
  HiSolidTrash,
} from "solid-icons/hi";
import {
  duplicateDevice,
  type Gesture,
  type GestureOptions,
  insertChain,
  type RawCommandInput,
  removeDevice,
  resetDevice,
  setDeviceBypass,
  type TransactionResult,
} from "../commands";
import { deviceTypeDefinition } from "../domain/devices";
import type { Device } from "../domain/entities";
import type { DeviceId, TrackId } from "../domain/ids";
import { ariaBool } from "../shared/aria";
import DeviceControls from "./DeviceControls";
import "./DeviceCard.css";

export interface DeviceCardProps {
  readonly trackId: TrackId;
  readonly device: Device;
  /** False once the chain is at its insert limit, so a copy has nowhere to go. */
  readonly canDuplicate: boolean;
  /** A fresh id for a duplicate; the command carries it, so redo reproduces it. */
  newDeviceId(): DeviceId;
  dispatch(
    commands: RawCommandInput | readonly RawCommandInput[],
  ): TransactionResult | undefined;
  beginGesture(options?: GestureOptions): Gesture | undefined;
}

/**
 * One insert device on a track's chain (#241, PRD FX-01): its name, what can
 * be done to it, and its own controls.
 *
 * Every action is one existing `device.*` command, so each is one validated
 * transaction, one history entry and one save, with stable ids — the panel
 * adds no mutation path of its own. Bypass is a toggle, like a strip's Mute,
 * so its state is `aria-pressed`, and a bypassed device keeps its place and
 * its settings; it only recedes. The actions are icon buttons, like the mixer
 * strip's, named for assistive technology and in their tooltips.
 */
export default function DeviceCard(props: DeviceCardProps): JSX.Element {
  const label = () => deviceTypeDefinition(props.device.type)?.label ?? props.device.type;
  const chain = () => insertChain(props.trackId);
  const run = (command: RawCommandInput) => props.dispatch(command);

  return (
    <article class={["device-card", { bypassed: props.device.bypassed }]}>
      <header class="device-card-head">
        <h4 class="device-card-name">{label()}</h4>
        <div class="device-card-actions">
          <button
            type="button"
            class={[
              "device-card-button device-bypass",
              { active: props.device.bypassed },
            ]}
            aria-pressed={ariaBool(props.device.bypassed)}
            aria-label={`Bypass ${label()}`}
            title="Bypass"
            onClick={() =>
              run(setDeviceBypass(chain(), props.device.id, !props.device.bypassed))
            }
          >
            <HiSolidPower size={13} />
          </button>
          <button
            type="button"
            class="device-card-button"
            aria-label={`Duplicate ${label()}`}
            title="Duplicate"
            disabled={!props.canDuplicate}
            onClick={() =>
              run(duplicateDevice(chain(), props.device.id, props.newDeviceId()))
            }
          >
            <HiSolidDocumentDuplicate size={13} />
          </button>
          <button
            type="button"
            class="device-card-button"
            aria-label={`Reset ${label()}`}
            title="Reset to defaults"
            onClick={() => run(resetDevice(chain(), props.device.id))}
          >
            <HiSolidArrowPath size={13} />
          </button>
          <button
            type="button"
            class="device-card-button device-remove"
            aria-label={`Remove ${label()}`}
            title="Remove"
            onClick={() => run(removeDevice(chain(), props.device.id))}
          >
            <HiSolidTrash size={13} />
          </button>
        </div>
      </header>
      <div class="device-card-body">
        <DeviceControls
          trackId={props.trackId}
          device={props.device}
          dispatch={props.dispatch}
          beginGesture={props.beginGesture}
        />
      </div>
    </article>
  );
}
