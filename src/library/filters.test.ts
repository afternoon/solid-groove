import { describe, expect, it } from "vitest";
import { loopAsset as loop, libraryAsset as sound } from "./__fixtures__/assets";
import {
  defaultFilters,
  filterSounds,
  genreCounts,
  roleJumps,
  scopeAssets,
} from "./filters";

describe("filters", () => {
  const house = sound({ genres: ["house"] });
  const techno = sound({ genres: ["techno", "house"] });
  const bare = sound({ genres: [] });
  const near = loop({ bpm: 124, bars: 4 });
  const edge = loop({ bpm: 134, bars: 2 });
  const far = loop({ bpm: 135, bars: 8 });
  const unknown = loop({ bpm: null, bars: 1 });
  const all = [house, techno, bare, near, edge, far, unknown];
  const base = defaultFilters(124);

  it("passes everything by default", () => {
    expect(filterSounds(all, base)).toHaveLength(all.length);
  });
  it("matches any selected genre", () => {
    expect(filterSounds(all, { ...base, genres: ["techno"] })).toEqual([techno]);
    expect(filterSounds(all, { ...base, genres: ["techno", "house"] })).toEqual([
      house,
      techno,
    ]);
  });
  it("keeps loops within 10 BPM of the song, inclusive, and drops unknown tempo", () => {
    const got = filterSounds(all, { ...base, tempo: "near" });
    expect(got).toContain(near);
    expect(got).toContain(edge);
    expect(got).not.toContain(far);
    expect(got).not.toContain(unknown);
  });
  it("never removes one-shots by tempo or bars", () => {
    const got = filterSounds(all, { ...base, tempo: "near", bars: 4 });
    expect(got).toEqual([house, techno, bare, near]);
  });
  it("filters loops by bars", () => {
    expect(filterSounds([near, edge, far], { ...base, bars: 2 })).toEqual([edge]);
  });
  it("searches with the shared text rule", () => {
    const kick = sound({ name: "Boom" });
    const snare = sound({ role: "snare", name: "Snap" });
    expect(filterSounds([kick, snare], { ...base, query: " SNA " })).toEqual([snare]);
  });
  it("counts genres, most first then by name, once per sound", () => {
    expect(
      genreCounts([house, techno, sound({ genres: ["trap", "trap"] }), bare]),
    ).toEqual([
      { genre: "house", count: 2 },
      { genre: "techno", count: 1 },
      { genre: "trap", count: 1 },
    ]);
  });
});

describe("role jumps", () => {
  const sounds = [
    sound({ role: "closed-hat" }),
    sound({ role: "open-hat" }),
    sound({ role: "kick" }),
    loop({ role: "top-loop" }),
  ];
  it("offers roles whose label contains the query and have sounds", () => {
    expect(roleJumps(sounds, "hat").map((j) => [j.family, j.role, j.label])).toEqual([
      ["drums", "closed-hat", "Closed hat"],
      ["drums", "open-hat", "Open hat"],
    ]);
  });
  it("skips roles with no sounds and empty queries", () => {
    expect(roleJumps(sounds, "snare")).toEqual([]);
    expect(roleJumps(sounds, "  ")).toEqual([]);
  });
  it("finds loop roles under Loops", () => {
    expect(roleJumps(sounds, "top")).toEqual([
      { family: "loops", role: "top-loop", label: "Top loop" },
    ]);
  });
});

describe("scope", () => {
  const a = sound({ packId: "pak_a" });
  const b = sound({ packId: "pak_b" });
  it("all returns everything", () => {
    expect(scopeAssets([a, b], { kind: "all" })).toEqual([a, b]);
  });
  it("favourites returns only the given IDs", () => {
    expect(
      scopeAssets([a, b], { kind: "favourites", assetIds: new Set([b.id]) }),
    ).toEqual([b]);
    expect(scopeAssets([a, b], { kind: "favourites", assetIds: new Set() })).toEqual([]);
  });
  it("a pack returns only that pack's sounds", () => {
    expect(scopeAssets([a, b], { kind: "pack", packId: "pak_b" })).toEqual([b]);
  });
});
