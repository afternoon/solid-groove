import { type Accessor, createSignal } from "solid-js";
import type { SoundFilters, TempoFilter } from "./filters";

/**
 * The Sounds view's filters that live beside the shelf (LIB-010): genres,
 * and under Loops the tempo window and bar count. The text query is the
 * header search's, so it is passed in when the filters are read. The rules
 * they feed are `filters.ts`'s.
 */
export function useSoundFilters(songBpm: Accessor<number>) {
  const [genres, setGenres] = createSignal<readonly string[]>([]);
  const [tempo, setTempo] = createSignal<TempoFilter>("any");
  const [bars, setBars] = createSignal<number | null>(null);

  return {
    genres,
    tempo,
    bars,
    setTempo,
    setBars,
    /** Everything `filterSounds` needs, with the header search's text. */
    read: (query: string): SoundFilters => ({
      query,
      genres: genres(),
      tempo: tempo(),
      songBpm: songBpm(),
      bars: bars(),
    }),
    toggleGenre: (genre: string) =>
      setGenres((have) =>
        have.includes(genre) ? have.filter((g) => g !== genre) : [...have, genre],
      ),
    toggleTempo: () => setTempo((now) => (now === "near" ? "any" : "near")),
    /** Whether any filter beside the search is narrowing the list. */
    active: () => genres().length > 0 || tempo() !== "any" || bars() !== null,
    clear: () => {
      setGenres([]);
      setTempo("any");
      setBars(null);
    },
  };
}
