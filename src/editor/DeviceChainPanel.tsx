import { For, type JSX, Show } from "@solidjs/web";
import { HiSolidPlus } from "solid-icons/hi";
import { createSignal } from "solid-js";
import { type Analytics, analytics as defaultAnalytics } from "../analytics/analytics";
import {
  addDevice,
  type Gesture,
  type GestureOptions,
  insertChain,
  type RawCommandInput,
  reorderDevice,
  type TransactionResult,
} from "../commands";
import { createDevice, type DeviceTypeId, deviceTypes } from "../domain/devices";
import type { Track } from "../domain/entities";
import { createIdFactory, type DeviceId, type IdFactory } from "../domain/ids";
import { MAX_TRACK_INSERTS } from "../domain/parse";
import type { ShortcutHandlers } from "../shortcuts/ShortcutController";
import { useShortcuts } from "../shortcuts/useShortcuts";
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
 * Where a press does not start a drag: the card's own controls. The name is a
 * button only for the keyboard, so it stays part of the handle.
 */
const NOT_A_HANDLE =
  "button:not(.device-card-grip), input, select, textarea, label, [role='slider'], [role='radio']";

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
 * Reordering is a drag from a card's header or background onto another card,
 * which takes that card's place — the chain previews the new order while the
 * card is held, and a drop outside the chain leaves it as it was — or Alt/Option+Up/Down on a focused device
 * name (the registry's `device.move_*`). Each move is one `device.reorder`,
 * and `DeviceChain` relinks the audio without rebuilding a node, so a move
 * during playback is click-free.
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
  // The drag's source and where it would land, read by the events that follow
  // `dragstart` within the same gesture: plain variables, because a signal
  // write is not readable until the next flush. The signals mirror them for
  // rendering only.
  let dragged: DeviceId | null = null;
  let landing: number | null = null;
  const [dragging, setDragging] = createSignal<DeviceId | null>(null);
  const [preview, setPreview] = createSignal<number | null>(null);

  /**
   * Where each device shows while a drag is previewed: the chain as it would
   * read after the drop. It is applied as a flex `order`, not by moving nodes,
   * because moving the dragged node mid-drag can end the browser's drag.
   */
  function shownAt(id: DeviceId, index: number): number {
    const from = devices().findIndex((device) => device.id === dragging());
    const to = preview();
    if (from < 0 || to === null) return index;
    if (id === dragging()) return to;
    if (from < to && index > from && index <= to) return index - 1;
    if (to < from && index >= to && index < from) return index + 1;
    return index;
  }

  function endDrag(): void {
    dragged = null;
    landing = null;
    setDragging(null);
    setPreview(null);
  }
  const [focused, setFocused] = createSignal<DeviceId | null>(null);

  function move(id: DeviceId, to: number): void {
    props.dispatch(reorderDevice(insertChain(props.track.id), id, to));
  }

  /** The focused device's index, and whether it can go `step` places. */
  function focusedMove(step: -1 | 1): { id: DeviceId; to: number } | undefined {
    const id = focused();
    const from = devices().findIndex((device) => device.id === id);
    if (id === null || from < 0) return undefined;
    const to = from + step;
    return to >= 0 && to < devices().length ? { id, to } : undefined;
  }

  function moveFocused(step: -1 | 1): void {
    const target = focusedMove(step);
    if (!target) return;
    // The list is keyed by id, so the same node moves; moving it can drop
    // focus, so put focus back on it once the list has settled.
    const grip = document.activeElement as HTMLElement | null;
    move(target.id, target.to);
    queueMicrotask(() => grip?.focus());
  }

  useShortcuts({
    handlers: (): ShortcutHandlers => ({
      "device.move_earlier": {
        run: () => moveFocused(-1),
        isEnabled: () => focusedMove(-1) !== undefined,
      },
      "device.move_later": {
        run: () => moveFocused(1),
        isEnabled: () => focusedMove(1) !== undefined,
      },
    }),
    contexts: () => ["editor"],
  });

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
          {(device, index) => (
            <li
              class={["device-chain-item", { dragging: dragging() === device().id }]}
              style={{ order: shownAt(device().id, index()) }}
              onPointerDown={(event) => {
                // Armed per press, so a slider drag never becomes a card drag.
                const target = event.target as Element;
                event.currentTarget.draggable = target.closest(NOT_A_HANDLE) === null;
              }}
              onDragStart={(event) => {
                if (!event.currentTarget.draggable) return event.preventDefault();
                dragged = device().id;
                setDragging(device().id);
                event.dataTransfer?.setData("text/plain", device().id);
                if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(event) => {
                if (dragged === null) return;
                // The dragged card itself is a valid place to drop: after the
                // preview moves it, it is usually what is under the pointer.
                event.preventDefault();
                if (dragged === device().id) return;
                landing = index();
                setPreview(index());
              }}
              onDrop={(event) => {
                event.preventDefault();
                const from = devices().findIndex((entry) => entry.id === dragged);
                if (dragged !== null && landing !== null && landing !== from) {
                  move(dragged, landing);
                }
                endDrag();
              }}
              onDragEnd={(event) => {
                // Also the only end of a drag dropped outside the chain,
                // which leaves it as it was.
                event.currentTarget.draggable = false;
                endDrag();
              }}
              onFocusIn={(event) => {
                const grip = (event.target as Element).closest(".device-card-grip");
                setFocused(grip ? device().id : null);
              }}
              onFocusOut={() => setFocused(null)}
            >
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
