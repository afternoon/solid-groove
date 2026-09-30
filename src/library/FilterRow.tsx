import { For, type JSX, Show } from "@solidjs/web";
import { HiSolidChevronDown } from "solid-icons/hi";
import { ariaBool } from "../shared/aria";
import type { ShortcutActionId } from "../shortcuts";
import { type GenreCount, LOOP_BARS_CHOICES, type TempoFilter } from "./filters";
import { roleLabel as genreLabel } from "./shelf";
import "./SoundsView.css";

/**
 * The Sounds view's filter row (LIB-010): a Genre multi-select menu with counts
 * so it can grow without taking a row, under Loops the Tempo window and the
 * Bars count, and the live result count. Every value is the caller's: this
 * only draws the controls.
 */
export default function FilterRow(props: {
  genres: readonly GenreCount[];
  selectedGenres: readonly string[];
  menuOpen: boolean;
  loops: boolean;
  tempo: TempoFilter;
  songBpm: number;
  bars: number | null;
  count: number;
  /** Key badge text for a registry action, from the registry. */
  keyLabel?(action: ShortcutActionId): string | undefined;
  onMenuOpen(open: boolean): void;
  onGenre(genre: string): void;
  onTempo(tempo: TempoFilter): void;
  onBars(bars: number | null): void;
}): JSX.Element {
  const label = () => {
    const [first, ...rest] = props.selectedGenres;
    if (first === undefined) return "Any genre";
    const name = genreLabel(first);
    return rest.length > 0 ? `${name} +${rest.length}` : name;
  };
  return (
    <div class="filter-row">
      <div class="filter-genre">
        <button
          type="button"
          class="filter-button"
          aria-haspopup="true"
          aria-expanded={ariaBool(props.menuOpen)}
          onClick={() => props.onMenuOpen(!props.menuOpen)}
        >
          {label()} <HiSolidChevronDown size={12} />
          <Show when={props.keyLabel?.("library.genre_menu")}>
            {(key) => <kbd>{key()}</kbd>}
          </Show>
        </button>
        <Show when={props.menuOpen}>
          <fieldset class="filter-menu" aria-label="Genres">
            <For each={props.genres}>
              {(entry) => (
                <label class="filter-option">
                  <input
                    type="checkbox"
                    checked={props.selectedGenres.includes(entry.genre)}
                    onChange={() => props.onGenre(entry.genre)}
                  />
                  {genreLabel(entry.genre)} <span class="shelf-count">{entry.count}</span>
                </label>
              )}
            </For>
          </fieldset>
        </Show>
      </div>
      <Show when={props.loops}>
        <fieldset class="filter-group" aria-label="Tempo">
          <button
            type="button"
            class="filter-button"
            aria-pressed={ariaBool(props.tempo === "near")}
            onClick={() => props.onTempo("near")}
          >
            Near {props.songBpm}
            <Show when={props.keyLabel?.("library.loop_tempo")}>
              {(key) => <kbd>{key()}</kbd>}
            </Show>
          </button>
          <button
            type="button"
            class="filter-button"
            aria-pressed={ariaBool(props.tempo === "any")}
            onClick={() => props.onTempo("any")}
          >
            Any tempo
          </button>
        </fieldset>
        <fieldset class="filter-group" aria-label="Bars">
          <For each={LOOP_BARS_CHOICES}>
            {(bars) => (
              <button
                type="button"
                class="filter-button"
                aria-pressed={ariaBool(props.bars === bars)}
                onClick={() => props.onBars(bars)}
              >
                {bars === null ? "Any bars" : `${bars} bar${bars === 1 ? "" : "s"}`}
              </button>
            )}
          </For>
        </fieldset>
      </Show>
      <span class="filter-count" aria-live="polite">
        {props.count} {props.count === 1 ? "sound" : "sounds"}
      </span>
    </div>
  );
}
