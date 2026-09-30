import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";
import { formatBytes, type StemSelection } from "./stemSelection";

export interface StemTrackPickerProps {
  readonly selection: StemSelection;
  readonly disabled: boolean;
}

/** The id of the words that say why Export is blocked, for `aria-describedby`. */
export const STEMS_BLOCKER_ID = "export-stems-blocker";

/**
 * The stems dialog's track checkboxes, every track checked unless the producer
 * unchecks it, with the package's estimated size and, while the selection
 * cannot be exported, the reason why. The reason's live region stays mounted
 * and only its content changes, so a screen reader announces each new reason.
 */
export default function StemTrackPicker(props: StemTrackPickerProps): JSX.Element {
  const selection = () => props.selection;
  return (
    <>
      <fieldset class="export-tracks" disabled={props.disabled}>
        <legend>Tracks</legend>
        <For each={selection().tracks()} keyed={(track) => track.id}>
          {(track) => (
            <label class="export-format">
              <input
                type="checkbox"
                checked={selection().isSelected(track().id)}
                onChange={(event) =>
                  selection().setSelected(track().id, event.currentTarget.checked)
                }
              />
              <span>{track().name}</span>
            </label>
          )}
        </For>
      </fieldset>
      <p class="export-size" aria-live="polite">
        Estimated size: about {formatBytes(selection().estimate().bytes)} of{" "}
        {formatBytes(selection().estimate().limitBytes)}.
      </p>
      <div id={STEMS_BLOCKER_ID} aria-live="polite">
        <Show when={selection().blocker()}>
          {(reason) => <p class="export-status export-error">{reason()}</p>}
        </Show>
      </div>
    </>
  );
}
