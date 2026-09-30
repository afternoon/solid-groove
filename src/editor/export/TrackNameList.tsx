import type { JSX } from "@solidjs/web";
import { createUniqueId, For } from "solid-js";
import "./TrackNameList.css";
import type { TrackLaneView } from "./trackLanes";
import type { ClickModifiers } from "./trackListSelection";

/**
 * The name column of the Export dialog's mini-arrangement (EXP-004): a
 * multi-select listbox of 24px rows, each a track colour bar, the name and an
 * ON/OFF pill. `aria-selected` is "picked"; the accessible name says whether
 * the track is included. It listens to no keys itself — they reach the list
 * through the shortcut registry, which the dialog turns on while the list has
 * focus (`onFocusChange`), the way the arrangement's loop brace does. The row
 * named by `focusId` is the listbox's active descendant.
 */

export interface TrackNameListProps {
  readonly rows: readonly TrackLaneView[];
  readonly focusId?: string | null;
  /** Stereo mode: rows read MIX, or M for a muted track, and ignore clicks. */
  readonly readOnly?: boolean;
  /** An export is running: nothing can be changed. */
  readonly disabled?: boolean;
  readonly onRowClick?: (index: number, modifiers: ClickModifiers) => void;
  readonly onFocusChange?: (focused: boolean) => void;
}

/** Cmd on macOS and Ctrl elsewhere both count as the pick modifier. */
export function clickModifiers(event: MouseEvent): ClickModifiers {
  return { shift: event.shiftKey, meta: event.metaKey || event.ctrlKey };
}

function rowLabel(row: TrackLaneView, readOnly: boolean): string {
  if (readOnly) {
    return `${row.name}, ${row.muted ? "muted, not in the mix" : "in the mix"}`;
  }
  return `${row.name}, ${row.included ? "included" : "left out"}`;
}

function pillText(row: TrackLaneView, readOnly: boolean): string {
  if (readOnly) return row.muted ? "M" : "MIX";
  return row.included ? "ON" : "OFF";
}

export default function TrackNameList(props: TrackNameListProps): JSX.Element {
  const listId = createUniqueId();
  const readOnly = () => props.readOnly === true;
  const locked = () => readOnly() || props.disabled === true;
  const domId = (id: string) => `${listId}-${id}`;
  return (
    // biome-ignore lint/a11y/useAriaActivedescendantWithTabindex: it is focusable; Solid's JSX types spell the attribute `tabindex`, which the rule does not read
    <div
      class="track-names"
      role="listbox"
      aria-multiselectable="true"
      aria-label="Tracks to export"
      aria-activedescendant={props.focusId ? domId(props.focusId) : undefined}
      tabindex={0}
      onFocus={() => props.onFocusChange?.(true)}
      onBlur={() => props.onFocusChange?.(false)}
    >
      <For each={props.rows} keyed={(row) => row.id}>
        {(row, index) => (
          // biome-ignore lint/a11y/useKeyWithClickEvents: keys reach the list through the shortcut registry's context, not a listener here
          // biome-ignore lint/a11y/useFocusableInteractive: the listbox holds focus and names the active row with aria-activedescendant
          <div
            class="track-name"
            role="option"
            id={domId(row().id)}
            data-on={readOnly() ? !row().muted : row().included}
            data-focused={props.focusId === row().id}
            aria-selected={row().picked ? "true" : "false"}
            aria-disabled={locked() ? "true" : undefined}
            aria-label={rowLabel(row(), readOnly())}
            style={{ "--track-ink": row().color ?? "var(--color-border-strong)" }}
            onClick={(event) => {
              if (!locked()) props.onRowClick?.(index(), clickModifiers(event));
            }}
          >
            <span>{row().name}</span>
            <i aria-hidden="true">{pillText(row(), readOnly())}</i>
          </div>
        )}
      </For>
    </div>
  );
}
