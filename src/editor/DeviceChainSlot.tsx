import type { JSX } from "@solidjs/web";
import "./DeviceChainSlot.css";

export interface DeviceChainSlotProps {
  /** Names the slot — "Device chain" for a track, "Master device chain". */
  readonly label: string;
  readonly emptyMessage: string;
}

/**
 * Where a device chain will go (`UI-001`).
 *
 * `#241` fills it for a track and `#283` for the master. It is here, labelled
 * and empty, rather than absent, so the layout those tasks land in is the
 * layout that shipped — and so the Instrument view and the Mixer reserve the
 * same shape rather than each inventing one.
 *
 * Deliberately not asserted by CF-008: a flow that asserted an empty slot would
 * be asserting the absence of a feature, and would go stale the moment it
 * ships.
 */
export default function DeviceChainSlot(props: DeviceChainSlotProps): JSX.Element {
  return (
    <section class="device-chain-slot" aria-label={props.label}>
      <h3 class="device-chain-slot-heading">{props.label}</h3>
      <p class="device-chain-slot-empty">{props.emptyMessage}</p>
    </section>
  );
}
