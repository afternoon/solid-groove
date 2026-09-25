import type { JSX } from "@solidjs/web";
import {
  duplicateDevice,
  type Gesture,
  type GestureOptions,
  insertChain,
  type RawCommandInput,
  removeDevice,
  reorderDevice,
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
  /** Its position in the chain, and how long the chain is. */
  readonly index: number;
  readonly count: number;
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
 * its settings; it only recedes. Reordering is a pair of buttons rather than
 * only a drag, so it is reachable from the keyboard.
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
            onClick={() =>
              run(setDeviceBypass(chain(), props.device.id, !props.device.bypassed))
            }
          >
            Bypass
          </button>
          <button
            type="button"
            class="device-card-button"
            aria-label={`Move ${label()} earlier`}
            title="Move earlier"
            disabled={props.index === 0}
            onClick={() => run(reorderDevice(chain(), props.device.id, props.index - 1))}
          >
            ↑
          </button>
          <button
            type="button"
            class="device-card-button"
            aria-label={`Move ${label()} later`}
            title="Move later"
            disabled={props.index >= props.count - 1}
            onClick={() => run(reorderDevice(chain(), props.device.id, props.index + 1))}
          >
            ↓
          </button>
          <button
            type="button"
            class="device-card-button"
            aria-label={`Duplicate ${label()}`}
            disabled={!props.canDuplicate}
            onClick={() =>
              run(duplicateDevice(chain(), props.device.id, props.newDeviceId()))
            }
          >
            Duplicate
          </button>
          <button
            type="button"
            class="device-card-button"
            aria-label={`Reset ${label()}`}
            onClick={() => run(resetDevice(chain(), props.device.id))}
          >
            Reset
          </button>
          <button
            type="button"
            class="device-card-button"
            aria-label={`Remove ${label()}`}
            onClick={() => run(removeDevice(chain(), props.device.id))}
          >
            Remove
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
