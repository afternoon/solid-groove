import { For, type JSX, Show } from "@solidjs/web";
import { HiSolidPlus } from "solid-icons/hi";
import { type Analytics, analytics as defaultAnalytics } from "../analytics/analytics";
import {
  addDevice,
  type Gesture,
  type GestureOptions,
  insertChain,
  type RawCommandInput,
  type TransactionResult,
} from "../commands";
import { createDevice, type DeviceTypeId, deviceTypes } from "../domain/devices";
import type { Track } from "../domain/entities";
import { createIdFactory, type IdFactory } from "../domain/ids";
import { MAX_TRACK_INSERTS } from "../domain/parse";
import DeviceCard from "./DeviceCard";
import "./NewTrackButtons.css";
import "./DeviceChainPanel.css";

export interface DeviceChainPanelProps {
  /** The selected track (#240): the panel has no selection of its own. */
  readonly track: Track;
  dispatch(
    commands: RawCommandInput | readonly RawCommandInput[],
  ): TransactionResult | undefined;
  beginGesture(options?: GestureOptions): Gesture | undefined;
  /** Defaults to the application singleton; injectable for tests. */
  readonly analytics?: Analytics;
  /** Where new device ids come from; injectable so a test is deterministic. */
  readonly ids?: IdFactory;
}

const defaultIds = createIdFactory();

/**
 * The selected track's insert chain (#241, PRD FX-01), in the slot UI-001
 * reserved for it in the Instrument view.
 *
 * The chain is a named, ordered list, in signal order, each entry a
 * `DeviceCard`. Below the last device sits one add button per registered
 * type, the same unit the arrangement and the mixer use for adding a track
 * (`NewTrackButtons`): a button per kind makes the type the click itself
 * rather than a picker opened first. Each appends one fully defaulted device
 * through `device.add`: one transaction, one undo,
 * one save, and one `device_added` — plus the account's first
 * `feature_first_use` for `device_chain`. A track holds at most
 * `MAX_TRACK_INSERTS` inserts, so adding and duplicating stop there rather
 * than offering a command the domain will refuse.
 *
 * Cards are keyed on the device's id, not its object: every parameter edit
 * produces a new device object, and a card rebuilt under a live drag would
 * lose the very slider the pointer is moving.
 */
export default function DeviceChainPanel(props: DeviceChainPanelProps): JSX.Element {
  const ids = () => props.ids ?? defaultIds;
  const analytics = () => props.analytics ?? defaultAnalytics;
  const devices = () => [...props.track.devices].sort((a, b) => a.order - b.order);
  const full = () => devices().length >= MAX_TRACK_INSERTS;

  function add(type: DeviceTypeId): void {
    const device = createDevice(ids()("device"), type, devices().length);
    const result = props.dispatch(addDevice(insertChain(props.track.id), device));
    if (!result?.ok) return;
    analytics().log("device_added", { device_type: type, chain: "insert" });
    analytics().logFeatureFirstUse("device_chain");
  }

  return (
    <section class="device-chain" aria-label="Device chain">
      <header class="device-chain-head">
        <h3 class="device-chain-heading">Device chain</h3>
      </header>
      <Show when={devices().length === 0}>
        <p class="device-chain-note">No devices on this track yet.</p>
      </Show>
      <ol class="device-chain-list" aria-label="Device chain">
        <For each={devices()} keyed={(device) => device.id}>
          {(device) => (
            <li class="device-chain-item">
              <DeviceCard
                trackId={props.track.id}
                device={device()}
                canDuplicate={!full()}
                newDeviceId={() => ids()("device")}
                dispatch={props.dispatch}
                beginGesture={props.beginGesture}
              />
            </li>
          )}
        </For>
      </ol>
      <fieldset class="new-track-buttons device-chain-adds" aria-label="Add device">
        <For each={deviceTypes()}>
          {(definition) => {
            const action = `Add ${definition.label.toLowerCase()} device`;
            return (
              <button
                type="button"
                class="new-track-button"
                aria-label={action}
                title={action}
                disabled={full()}
                onClick={() => add(definition.type)}
              >
                <HiSolidPlus size={13} />
                <span>{definition.label}</span>
              </button>
            );
          }}
        </For>
      </fieldset>
      <Show when={full()}>
        <p class="device-chain-note">
          A track holds up to {MAX_TRACK_INSERTS} devices. Remove one to add another.
        </p>
      </Show>
    </section>
  );
}
