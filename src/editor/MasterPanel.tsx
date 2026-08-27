import { For, type JSX, Show } from "@solidjs/web";
import { HiSolidPlus } from "solid-icons/hi";
import { createSignal } from "solid-js";
import { type Analytics, analytics as defaultAnalytics } from "../analytics/analytics";
import type { DeviceOperation } from "../analytics/catalog";
import type { ErrorCode } from "../analytics/errorCodes";
import type {
  CommandIssueCode,
  Gesture,
  GestureOptions,
  RawCommandInput,
  TransactionResult,
} from "../commands";
import { addDevice, masterChain } from "../commands";
import { createDevice, type DeviceTypeId, deviceTypes } from "../domain/devices";
import type { Project } from "../domain/entities";
import { createFactoryContext } from "../domain/factories";
import { ariaBool } from "../shared/aria";
import MasterDevice from "./MasterDevice";
import "./DevicePanel.css";

/** Mints IDs for the devices this panel creates. A module singleton. */
const factoryContext = createFactoryContext();

export interface MasterPanelProps {
  readonly project: Project;
  dispatch(
    commands: RawCommandInput | readonly RawCommandInput[],
  ): TransactionResult | undefined;
  beginGesture(options?: GestureOptions): Gesture | undefined;
  /** Defaults to the application singleton; injectable for tests. */
  readonly analytics?: Analytics;
}

/**
 * The master FX panel (PRD FX-01, section 6; LOOP-020).
 *
 * The master is the right first chain to reach: it always exists, needs no
 * selection model, and putting one effect across everything you have made is
 * the move that most changes how a loop sounds. The chain is an ordered,
 * accessible list, and the "+" offers the types the registry declares —
 * `deviceTypes()`, never a list copied into this file. Every edit is a
 * registered `device.*` command through the shared command layer: one
 * revision, one history entry, undoable, autosaved.
 */
export default function MasterPanel(props: MasterPanelProps): JSX.Element {
  const analytics = () => props.analytics ?? defaultAnalytics;
  const [addOpen, setAddOpen] = createSignal(false);
  const devices = () =>
    [...props.project.song.master.devices].sort((a, b) => a.order - b.order);

  /**
   * Dispatches one device edit and reports the failure path. A refused device
   * command is the chain's principal reliability failure, so it is logged
   * rather than swallowed — the operation and a stable code, and no chain,
   * track, project, or device identity.
   */
  function edit(operation: DeviceOperation, command: RawCommandInput): boolean {
    const result = props.dispatch(command);
    if (result?.ok) return true;
    analytics().log("device_edit_failed", {
      operation,
      error_code: errorCodeOf(result),
    });
    return false;
  }

  function add(type: DeviceTypeId): void {
    setAddOpen(false);
    const device = createDevice(factoryContext.ids("device"), type, devices().length);
    if (!edit("add", addDevice(masterChain, device))) return;
    // `device_type` is a registry key, never anything the producer typed.
    analytics().log("device_added", { device_type: type, chain: "master" });
    analytics().logFeatureFirstUse("device_chain");
  }

  return (
    <section class="master-panel" aria-label="Master effects">
      <header class="master-panel-header">
        <h3 class="master-panel-heading">Master</h3>
        <div class="master-panel-add">
          <button
            type="button"
            class="master-panel-add-button"
            aria-haspopup="menu"
            aria-expanded={ariaBool(addOpen())}
            onClick={() => setAddOpen((open) => !open)}
          >
            <HiSolidPlus size={13} />
            <span>Add device</span>
          </button>
          <Show when={addOpen()}>
            {/* The registry's own definitions: no device list to drift. */}
            <div class="master-panel-menu" role="menu" aria-label="Add device">
              <For each={deviceTypes()}>
                {(definition) => (
                  <button
                    type="button"
                    role="menuitem"
                    class="master-panel-menu-item"
                    onClick={() => add(definition.type)}
                  >
                    {definition.label}
                  </button>
                )}
              </For>
            </div>
          </Show>
        </div>
      </header>

      {/* A named list is what "the master chain, in order" has to be for a
          keyboard and a screen reader, and it stays present when empty so the
          chain is one stable landmark either way. */}
      <ul class="master-chain" aria-label="Master chain">
        <For each={devices()}>
          {(device, index) => (
            <li class="master-chain-item">
              <MasterDevice
                device={device}
                index={index()}
                count={devices().length}
                edit={edit}
                dispatch={props.dispatch}
                beginGesture={props.beginGesture}
              />
            </li>
          )}
        </For>
      </ul>
      <Show when={devices().length === 0}>
        <p class="master-chain-empty">
          Nothing on the master yet. Add a device to process the whole mix.
        </p>
      </Show>
    </section>
  );
}

/**
 * `revision_conflict` is the one refusal that is not our bug — the project
 * moved on underneath the panel. Everything else means this surface offered an
 * edit the project could not satisfy, which is `internal`.
 */
const ISSUE_ERROR_CODES: Partial<Record<CommandIssueCode, ErrorCode>> = {
  revision_conflict: "revision_conflict",
};

function errorCodeOf(result: TransactionResult | undefined): ErrorCode {
  if (!result || result.ok) return "unknown";
  return ISSUE_ERROR_CODES[result.issues[0]?.code] ?? "internal";
}
