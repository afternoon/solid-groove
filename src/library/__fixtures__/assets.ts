import type { LibraryAsset } from "../manifest";

let counter = 0;

/** A hand-built one-shot kick; override what a test cares about. IDs and names are unique per call. */
export function libraryAsset(over: Partial<LibraryAsset> = {}): LibraryAsset {
  counter += 1;
  return {
    id: `ast_${counter}`,
    name: `Sound ${String(counter).padStart(3, "0")}`,
    type: "one-shot",
    family: "drums",
    role: "kick",
    genres: [],
    characters: [],
    packId: "pak_a",
    packSlug: "a",
    packName: "Pack A",
    packVersion: "1.0.0",
    url: null,
    storageKey: null,
    licence: null,
    durationSeconds: 1,
    sampleRate: null,
    channelCount: null,
    bpm: null,
    bars: null,
    peaks: null,
    ...over,
  };
}

/** A four-bar, 124 BPM full loop. */
export function loopAsset(over: Partial<LibraryAsset> = {}): LibraryAsset {
  return libraryAsset({
    type: "loop",
    role: "full-loop",
    bpm: 124,
    bars: 4,
    durationSeconds: 8,
    ...over,
  });
}
