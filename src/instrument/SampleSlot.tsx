import type { JSX } from "@solidjs/web";
import { SampleIcon } from "../components/icons";
import { MASK_CONTENT } from "../monitoring/replayPrivacy";
import "./SampleSlot.css";

export interface SampleSlotProps {
  /** What the slot is for, as its accessible name: "Sample for Kick". */
  readonly label: string;
  /** The sound loaded, or null when the slot is empty. */
  readonly name: string | null;
  /** What an empty slot says. Defaults to "No sample loaded". */
  readonly placeholder?: string;
  /** Opens the library on this slot: the library is where sounds come from. */
  onBrowse(): void;
}

/**
 * The sample slot (#447): the one way to choose a sound from the library,
 * wherever an instrument holds one — the sampler's sample, every drum pad's,
 * and a loop track's loop. A filled button with the library's sound icon,
 * naming the sound, and a caret saying it opens something.
 */
export default function SampleSlot(props: SampleSlotProps): JSX.Element {
  return (
    <button
      type="button"
      class="sample-slot"
      aria-label={props.label}
      aria-haspopup="dialog"
      onClick={() => props.onBrowse()}
    >
      <span class="sample-slot-icon">
        <SampleIcon size={14} />
      </span>
      {/* A sound's name is library copy, but a user-recorded sample lands in
          the same slot, so it is masked all the same (ADR 0002 decision 2). */}
      <span class={`sample-slot-name ${MASK_CONTENT}`}>
        {props.name ?? props.placeholder ?? "No sample loaded"}
      </span>
    </button>
  );
}
