import { For, type JSX, Show } from "@solidjs/web";
import { HiSolidChevronLeft, HiSolidChevronRight } from "solid-icons/hi";
import { ariaBool } from "../shared/aria";
import type { ShortcutActionId } from "../shortcuts";
import { familyLabel, type ShelfEntry, type ShelfFamily } from "./shelf";
import "./SoundsView.css";

/** The registry action whose key picks the nth chip: `0` is all, `1`-`9` a category. */
function pickAction(index: number): ShortcutActionId | null {
  if (index === 0) return "library.pick_all";
  return index <= 9 ? (`library.pick_${index}` as ShortcutActionId) : null;
}

/**
 * The library's two-level shelf (LIB-010): families as tiles with counts, then
 * the chosen family's categories as chips in one scrolling row, with arrows
 * for the ones past the edge. Only entries with sounds arrive here, so there is
 * nothing to hide. The first nine chips carry the digit keys that pick them.
 */
export default function Shelf(props: {
  families: readonly ShelfEntry<ShelfFamily>[];
  family: ShelfFamily;
  roles: readonly ShelfEntry<string>[];
  role: string | null;
  /** Key badge text for a registry action, from the registry. */
  keyLabel?(action: ShortcutActionId): string | undefined;
  onFamily(family: ShelfFamily): void;
  onRole(role: string | null): void;
}): JSX.Element {
  let chips: HTMLDivElement | undefined;
  const scroll = (direction: 1 | -1) =>
    chips?.scrollBy?.({ left: direction * 240, behavior: "smooth" });
  const badge = (index: number) => {
    const action = pickAction(index);
    return action ? props.keyLabel?.(action) : undefined;
  };

  return (
    <div class="shelf">
      <div class="shelf-families" role="tablist" aria-label="Families">
        <For each={props.families}>
          {(entry) => (
            <button
              type="button"
              role="tab"
              class="shelf-family"
              aria-selected={ariaBool(props.family === entry.key)}
              onClick={() => props.onFamily(entry.key)}
            >
              {entry.label} <span class="shelf-count">{entry.count}</span>
            </button>
          )}
        </For>
      </div>
      <div class="shelf-roles">
        <button
          type="button"
          class="shelf-arrow"
          aria-label="Scroll categories left"
          onClick={() => scroll(-1)}
        >
          <HiSolidChevronLeft size={14} />
        </button>
        <div class="shelf-chips" ref={chips}>
          <button
            type="button"
            class="shelf-chip"
            aria-pressed={ariaBool(props.role === null)}
            onClick={() => props.onRole(null)}
          >
            All {familyLabel(props.family)}{" "}
            <span class="shelf-count">
              {props.families.find((entry) => entry.key === props.family)?.count}
            </span>
            <Show when={badge(0)}>{(key) => <kbd>{key()}</kbd>}</Show>
          </button>
          <For each={props.roles}>
            {(entry, index) => (
              <button
                type="button"
                class="shelf-chip"
                aria-pressed={ariaBool(props.role === entry.key)}
                onClick={() => props.onRole(entry.key)}
              >
                {entry.label} <span class="shelf-count">{entry.count}</span>
                <Show when={badge(index() + 1)}>{(key) => <kbd>{key()}</kbd>}</Show>
              </button>
            )}
          </For>
        </div>
        <button
          type="button"
          class="shelf-arrow"
          aria-label="Scroll categories right"
          onClick={() => scroll(1)}
        >
          <HiSolidChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}
