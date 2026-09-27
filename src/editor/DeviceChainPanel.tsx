import { For, type JSX, Show } from "@solidjs/web";
import { HiSolidPlus } from "solid-icons/hi";
import { createSignal } from "solid-js";
import { type Analytics, analytics as defaultAnalytics } from "../analytics/analytics";
import type { DeviceOperation } from "../analytics/catalog";
import type { ErrorCode } from "../analytics/errorCodes";
import {
  addDevice,
  type CommandIssueCode,
  type DeviceChainTarget,
  type Gesture,
  type GestureOptions,
  insertChain,
  type RawCommandInput,
  reorderDevice,
  type TransactionResult,
} from "../commands";
import { createDevice, type DeviceTypeId, deviceTypes } from "../domain/devices";
import type { Device, Track } from "../domain/entities";
import { createIdFactory, type DeviceId, type IdFactory } from "../domain/ids";
import { MAX_TRACK_INSERTS } from "../domain/parse";
import type { ShortcutHandlers } from "../shortcuts/ShortcutController";
import { useShortcuts } from "../shortcuts/useShortcuts";
import DeviceCard from "./DeviceCard";
import "./NewTrackButtons.css";
import "./DeviceChainPanel.css";

/** What a chain is called, to a screen reader and on screen. */
export interface DeviceChainLabels {
  /** The panel's region. */
  readonly region: string;
  readonly heading: string;
  /** The ordered list of devices. */
  readonly list: string;
  /** Shown while the chain is empty. */
  readonly empty: string;
}

export interface DeviceChainProps {
  /** Which chain this is: the address every `device.*` command carries. */
  readonly chain: DeviceChainTarget;
  readonly devices: readonly Device[];
  readonly labels: DeviceChainLabels;
  /**
   * The most devices the chain may hold, and what to say once it does. Adding
   * and duplicating stop there. A chain the domain does not bound has none.
   */
  readonly limit?: { readonly count: number; readonly note: string };
  /**
   * Receives the chain's region, so a host can move focus to it — the mixer's
   * master strip does. Given one, the region is focusable.
   */
  sectionRef?(element: HTMLElement): void;
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
 * One device chain (PRD FX-01): a track's inserts (#241, `DeviceChainPanel`)
 * or the master's (#283, `MasterPanel`). Both chains are this one component,
 * so they add, edit, reorder and report exactly alike; only their address,
 * their names and whether they are bounded differ.
 *
 * The chain is a named, ordered list, in signal order, each entry a
 * `DeviceCard`. Below the last device sits one add button per registered
 * type, the same unit the arrangement and the mixer use for adding a track
 * (`NewTrackButtons`): a button per kind makes the type the click itself
 * rather than a picker opened first. Each appends one fully defaulted device
 * through `device.add`: one transaction, one undo,
 * one save, and one `device_added` — plus the account's first
 * `feature_first_use` for `device_chain`. A bounded chain stops adding and
 * duplicating at its `limit` rather than offering a command the domain will
 * refuse.
 *
 * Reordering is a drag from a card's header or background into a slot above
 * or below another card — the chain previews the new order while the card is
 * held, every slot including the one it started in, and a drop outside the
 * chain leaves it as it was — or Alt/Option+Up/Down on a focused device
 * name (the registry's `device.move_*`). Each move is one `device.reorder`,
 * and `DeviceChain` relinks the audio without rebuilding a node, so a move
 * during playback is click-free.
 *
 * A refused edit is the chain's principal failure, so it is reported rather
 * than swallowed: `device_edit_failed`, with the operation and a stable code
 * and no chain, track, project or device identity.
 *
 * Cards are keyed on the device's id, not its object: every parameter edit
 * produces a new device object, and a card rebuilt under a live drag would
 * lose the very slider the pointer is moving.
 */
export function DeviceChain(props: DeviceChainProps): JSX.Element {
  const ids = () => props.ids ?? defaultIds;
  const analytics = () => props.analytics ?? defaultAnalytics;
  const devices = () => [...props.devices].sort((a, b) => a.order - b.order);
  const full = () => props.limit !== undefined && devices().length >= props.limit.count;

  /** Every chain edit, the cards' included, reporting the ones refused. */
  function edit(
    commands: RawCommandInput | readonly RawCommandInput[],
  ): TransactionResult | undefined {
    const result = props.dispatch(commands);
    if (result?.ok) return result;
    const first = Array.isArray(commands) ? commands[0] : commands;
    const operation = DEVICE_OPERATION_BY_COMMAND[(first as RawCommandInput)?.type];
    if (operation) {
      analytics().log("device_edit_failed", {
        operation,
        error_code: errorCodeOf(result),
      });
    }
    return result;
  }
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
    const held = dragging();
    const to = preview();
    if (held === null || to === null) return index;
    const shown = devices()
      .map((device) => device.id)
      .filter((entry) => entry !== held);
    shown.splice(to, 0, held);
    return shown.indexOf(id);
  }

  /**
   * The slot a drag over `over` offers: just above it in its upper half, just
   * below it in its lower half, counted among the other devices. With three
   * devices that is three slots, the one the held device started in included.
   */
  function slotAt(over: DeviceId, event: DragEvent): number {
    const others = devices().filter((device) => device.id !== dragged);
    const at = others.findIndex((device) => device.id === over);
    const box = (event.currentTarget as Element).getBoundingClientRect();
    return event.clientY < box.top + box.height / 2 ? at : at + 1;
  }

  function endDrag(): void {
    dragged = null;
    landing = null;
    setDragging(null);
    setPreview(null);
  }
  const [focused, setFocused] = createSignal<DeviceId | null>(null);

  function move(id: DeviceId, to: number): void {
    edit(reorderDevice(props.chain, id, to));
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
    const result = edit(addDevice(props.chain, device));
    if (!result?.ok) return;
    analytics().log("device_added", { device_type: type, chain: props.chain.chain });
    analytics().logFeatureFirstUse("device_chain");
  }

  return (
    <section
      ref={(element) => props.sectionRef?.(element)}
      class="device-chain"
      aria-label={props.labels.region}
      tabindex={props.sectionRef ? "-1" : undefined}
    >
      <header class="device-chain-head">
        <h3 class="device-chain-heading">{props.labels.heading}</h3>
      </header>
      <Show when={devices().length === 0}>
        <p class="device-chain-note">{props.labels.empty}</p>
      </Show>
      <ol class="device-chain-list" aria-label={props.labels.list}>
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
                // The held card itself is a valid place to drop, where the
                // preview already shows it; over it, the slot stays as it is.
                event.preventDefault();
                if (dragged === device().id) return;
                landing = slotAt(device().id, event);
                setPreview(landing);
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
                chain={props.chain}
                device={device()}
                canDuplicate={!full()}
                newDeviceId={() => ids()("device")}
                dispatch={edit}
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
      <Show when={full() && props.limit}>
        {(limit) => <p class="device-chain-note">{limit().note}</p>}
      </Show>
    </section>
  );
}

/** Which `device.*` command is which reportable edit. */
const DEVICE_OPERATION_BY_COMMAND: Readonly<Record<string, DeviceOperation>> = {
  "device.add": "add",
  "device.remove": "remove",
  "device.reorder": "reorder",
  "device.duplicate": "duplicate",
  "device.setBypass": "bypass",
  "device.reset": "reset",
};

/**
 * `revision_conflict` is the one refusal that is not the chain's bug — the
 * project moved on underneath it. Anything else means the chain offered an
 * edit the project could not satisfy, which is `internal`.
 */
function errorCodeOf(result: TransactionResult | undefined): ErrorCode {
  if (!result || result.ok) return "unknown";
  const code: CommandIssueCode | undefined = result.issues[0]?.code;
  return code === "revision_conflict" ? "revision_conflict" : "internal";
}

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

const LABELS: DeviceChainLabels = {
  region: "Device chain",
  heading: "Device chain",
  list: "Device chain",
  empty: "No devices on this track yet.",
};

const LIMIT = {
  count: MAX_TRACK_INSERTS,
  note: `A track holds up to ${MAX_TRACK_INSERTS} devices. Remove one to add another.`,
};

/**
 * The selected track's insert chain (#241, PRD FX-01), in the slot UI-001
 * reserved for it in the Instrument view: the shared `DeviceChain`, addressed
 * to the track and bounded at `MAX_TRACK_INSERTS`.
 */
export default function DeviceChainPanel(props: DeviceChainPanelProps): JSX.Element {
  return (
    <DeviceChain
      chain={insertChain(props.track.id)}
      devices={props.track.devices}
      labels={LABELS}
      limit={LIMIT}
      dispatch={props.dispatch}
      beginGesture={props.beginGesture}
      analytics={props.analytics}
      ids={props.ids}
    />
  );
}
