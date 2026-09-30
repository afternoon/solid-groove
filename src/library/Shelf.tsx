import { For, type JSX } from "@solidjs/web";
import { HiSolidChevronLeft, HiSolidChevronRight } from "solid-icons/hi";
import { ariaBool } from "../shared/aria";
import { familyLabel, type ShelfEntry, type ShelfFamily } from "./shelf";
import "./SoundsView.css";

/**
 * The library's two-level shelf (LIB-010): families as tiles with counts, then
 * the chosen family's categories as chips in one scrolling row, with arrows
 * for the ones past the edge. Only entries with sounds arrive here, so there is
 * nothing to hide.
 */
export default function Shelf(props: {
  families: readonly ShelfEntry<ShelfFamily>[];
  family: ShelfFamily;
  roles: readonly ShelfEntry<string>[];
  role: string | null;
  onFamily(family: ShelfFamily): void;
  onRole(role: string | null): void;
}): JSX.Element {
  let chips: HTMLDivElement | undefined;
  const scroll = (direction: 1 | -1) =>
    chips?.scrollBy?.({ left: direction * 240, behavior: "smooth" });

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
          </button>
          <For each={props.roles}>
            {(entry) => (
              <button
                type="button"
                class="shelf-chip"
                aria-pressed={ariaBool(props.role === entry.key)}
                onClick={() => props.onRole(entry.key)}
              >
                {entry.label} <span class="shelf-count">{entry.count}</span>
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
