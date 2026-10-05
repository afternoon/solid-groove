import type { JSX } from "@solidjs/web";
import { createUniqueId, For, Show } from "solid-js";
import type { PlacementId } from "../domain/ids";
import { MASK_CONTENT } from "../monitoring/replayPrivacy";
import type { ClipListEntry } from "./clipListModel";

export interface ClipListProps {
  readonly entries: readonly ClipListEntry[];
  /** The selected clips, which the options mark `aria-selected`. */
  readonly selected: readonly PlacementId[];
  /** The clip the arrows stand on, read out as the active option. */
  readonly active: PlacementId | null;
  readonly onFocusChange: (focused: boolean) => void;
}

/**
 * The keyboard path to the arrangement's clips (#76; PRD section 8).
 *
 * The clips are canvas drawings, so only a pointer can pick one. This is their
 * DOM twin: one tab stop, a listbox of every clip in reading order, whose
 * options say which are selected. It listens to no keys itself — Up and Down
 * arrive through the registry's `clip_list` context, which the host turns on
 * while this has focus (KEY-01), and Enter, Delete, Cmd/Ctrl+D and the
 * clipboard keys act on the selection as they do after a click. The selection
 * follows the arrows, so the canvas draws where a sighted keyboard user is,
 * and the timeline is outlined while the list has focus (ArrangementView.css).
 *
 * Only there while the arrangement has clips: an empty listbox is not one.
 */
export function ClipList(props: ClipListProps): JSX.Element {
  const baseId = createUniqueId();
  const optionId = (id: PlacementId) => `${baseId}-${id}`;
  return (
    <Show when={props.entries.length > 0}>
      {/* biome-ignore lint/a11y/useAriaActivedescendantWithTabindex: it is tabbable; Solid's JSX types spell the attribute `tabindex`, which the rule does not read */}
      <div
        class={`arrangement-clip-list ${MASK_CONTENT}`}
        role="listbox"
        tabindex={0}
        aria-label="Clips"
        aria-multiselectable="true"
        aria-activedescendant={props.active ? optionId(props.active) : undefined}
        data-testid="arrangement-clip-list"
        onFocus={() => props.onFocusChange(true)}
        onBlur={() => props.onFocusChange(false)}
      >
        <For each={props.entries}>
          {(entry) => (
            // biome-ignore lint/a11y/useFocusableInteractive: an option under aria-activedescendant is reached through its listbox, never focused itself
            <div
              id={optionId(entry.id)}
              role="option"
              aria-selected={props.selected.includes(entry.id) ? "true" : "false"}
            >
              {entry.label}
            </div>
          )}
        </For>
      </div>
    </Show>
  );
}
