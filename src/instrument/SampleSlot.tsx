import type { JSX } from "@solidjs/web";
import { MASK_CONTENT } from "../monitoring/replayPrivacy";
import "./SampleSlot.css";

export interface SampleSlotProps {
  /** What the slot is for, as its accessible name: "Sample for Kick". */
  readonly label: string;
  /** The sound loaded, or null when the slot is empty. */
  readonly name: string | null;
  /** Opens the library on this slot: the library is where sounds come from. */
  onBrowse(): void;
}

/**
 * The sample slot (#447): a filled button naming the sound, with a caret,
 * that opens the library on the slot. One look for the sampler's sample and
 * every drum pad's.
 */
export default function SampleSlot(props: SampleSlotProps): JSX.Element {
  return (
    <button
      type="button"
      class="sample-slot"
      aria-label={props.label}
      onClick={() => props.onBrowse()}
    >
      {/* A sound's name is library copy, but a user-recorded sample lands in
          the same slot, so it is masked all the same (ADR 0002 decision 2). */}
      <span class={`sample-slot-name ${MASK_CONTENT}`}>
        {props.name ?? "No sample loaded"}
      </span>
    </button>
  );
}
