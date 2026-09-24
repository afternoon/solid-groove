import { For, type JSX } from "@solidjs/web";
import { HiSolidPlus } from "solid-icons/hi";
import { NEW_TRACK_KINDS, type NewTrackKindSpec } from "./trackCreation";
import "./NewTrackButtons.css";

export interface NewTrackButtonsProps {
  /** Names the group, so two of these on different views read differently. */
  readonly label: string;
  onAdd(spec: NewTrackKindSpec): void;
  /** Anything offered beside the kinds — the arrangement's Loop button. */
  readonly children?: JSX.Element;
}

/**
 * One button per instrument kind, from the shared kind table (`UI-001`, #223).
 *
 * One button per kind rather than an "Add track" plus a picker: adding a track
 * is a two-decision action ("another track", "a sampler"), and a button per
 * kind makes the second decision the click itself instead of a mode set
 * beforehand.
 *
 * The mixer and the arrangement both render this, so the kinds cannot drift
 * apart between the two surfaces, and both hand the click to the same
 * `addTrackOfKind` — there is one creation route, not one per surface.
 */
export default function NewTrackButtons(props: NewTrackButtonsProps): JSX.Element {
  return (
    <fieldset class="new-track-buttons" aria-label={props.label}>
      <For each={NEW_TRACK_KINDS}>
        {(spec) => (
          <button
            type="button"
            class="new-track-button"
            aria-label={spec.actionLabel}
            title={spec.actionLabel}
            onClick={() => props.onAdd(spec)}
          >
            <HiSolidPlus size={13} />
            <span>{spec.label}</span>
          </button>
        )}
      </For>
      {props.children}
    </fieldset>
  );
}
