import { For, type JSX, Show } from "@solidjs/web";
import { HiSolidChevronLeft, HiSolidChevronRight } from "solid-icons/hi";
import { createEffect, createSignal, onSettled } from "solid-js";
import { ariaBool } from "../shared/aria";
import { scrollBehavior } from "../shared/motion";
import type { ShortcutActionId } from "../shortcuts";
import { familyLabel, type ShelfEntry, type ShelfFamily } from "./shelf";
import "./SoundsView.css";

/**
 * The registry action whose key picks the nth chip: `0` is all. The digits
 * `1`-`5` are the editor's views everywhere, the library included (UI-002),
 * so a category has no digit of its own.
 */
function pickAction(index: number): ShortcutActionId | null {
  return index === 0 ? "library.pick_all" : null;
}

/** "All drums", in sentence case like every label; an acronym ("FX") keeps its capitals. */
export function allLabel(family: ShelfFamily): string {
  const label = familyLabel(family);
  return `All ${label === label.toUpperCase() ? label : label.toLowerCase()}`;
}

/**
 * A chip's boxed key badge, drawn before its label as the window's other keys
 * are. It is decoration for sighted users: the button announces the key
 * through `aria-keyshortcuts`, so the badge stays out of the accessible name.
 */
export function ChipKey(props: { label?: string }): JSX.Element {
  return (
    <Show when={props.label}>
      <span class="library-modal-key shelf-key" aria-hidden="true">
        <kbd>{props.label}</kbd>
      </span>
    </Show>
  );
}

/**
 * The library's two-level shelf (LIB-010): families as tiles with counts, then
 * the chosen family's categories as chips in one scrolling row, with arrows
 * for the ones past the edge. Every family in scope arrives, at zero when a
 * search leaves it nothing (#878); only categories with sounds do. "All"
 * carries the `0` key that picks it.
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
  const [overflows, setOverflows] = createSignal(false);
  const measure = () => {
    if (chips) setOverflows(chips.scrollWidth > chips.clientWidth);
  };
  const scroll = (direction: 1 | -1) =>
    chips?.scrollBy?.({ left: direction * 240, behavior: scrollBehavior() });
  const badge = (index: number) => {
    const action = pickAction(index);
    return action ? props.keyLabel?.(action) : undefined;
  };

  // The arrows only show when there is somewhere to scroll: re-measure when the
  // chips change, and when the window (so the row) is resized.
  createEffect(
    () => [props.family, props.roles] as const,
    () => measure(),
  );
  onSettled(() => {
    measure();
    if (typeof ResizeObserver !== "function" || !chips) return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(chips);
    return () => observer.disconnect();
  });

  const arrow = (direction: 1 | -1) => (
    <button
      type="button"
      class="shelf-arrow"
      hidden={!overflows()}
      aria-label={`Scroll categories ${direction === 1 ? "right" : "left"}`}
      onClick={() => scroll(direction)}
    >
      {direction === 1 ? (
        <HiSolidChevronRight size={12} />
      ) : (
        <HiSolidChevronLeft size={12} />
      )}
    </button>
  );

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
              <b class="shelf-family-name">{entry.label}</b>{" "}
              <small
                class="shelf-family-count"
                data-unit={entry.count === 1 ? "sound" : "sounds"}
              >
                {entry.count}
              </small>
            </button>
          )}
        </For>
      </div>
      <div class="shelf-roles">
        {arrow(-1)}
        <div class={["shelf-chips", { "shelf-chips-overflow": overflows() }]} ref={chips}>
          <button
            type="button"
            class="shelf-chip"
            aria-pressed={ariaBool(props.role === null)}
            aria-keyshortcuts={badge(0)}
            onClick={() => props.onRole(null)}
          >
            <ChipKey label={badge(0)} />
            {allLabel(props.family)}{" "}
            <span class="shelf-count">
              {props.families.find((entry) => entry.key === props.family)?.count}
            </span>
          </button>
          <For each={props.roles}>
            {(entry, index) => (
              <button
                type="button"
                class="shelf-chip"
                aria-pressed={ariaBool(props.role === entry.key)}
                aria-keyshortcuts={badge(index() + 1)}
                onClick={() => props.onRole(entry.key)}
              >
                <ChipKey label={badge(index() + 1)} />
                {entry.label} <span class="shelf-count">{entry.count}</span>
              </button>
            )}
          </For>
        </div>
        {arrow(1)}
      </div>
    </div>
  );
}
