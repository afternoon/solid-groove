import { describe, expect, it } from "vitest";
import type { LibraryAsset } from "./manifest";
import { buildLibraryTree, groupLabel } from "./tree";

function asset(overrides: Partial<LibraryAsset> & { id: string }): LibraryAsset {
  return {
    name: overrides.id,
    type: "one-shot",
    family: "drums",
    role: "kick",
    genres: [],
    characters: [],
    packId: "pak_one",
    packSlug: "pack-one",
    packName: "Pack One",
    packVersion: "1.0.0",
    url: `/audio/${overrides.id}.wav`,
    storageKey: `${overrides.id}.wav`,
    durationSeconds: 1,
    sampleRate: 48000,
    channelCount: 1,
    bpm: null,
    licence: "solid-groove-owned",
    ...overrides,
  };
}

const PACK_ONE = {
  id: "pak_one",
  slug: "pack-one",
  name: "Pack One",
  assetCount: 3,
};
const PACK_TWO = {
  id: "pak_two",
  slug: "pack-two",
  name: "Pack Two",
  assetCount: 9,
};

describe("buildLibraryTree", () => {
  it("groups a pack's assets by role", () => {
    const tree = buildLibraryTree({
      packs: [PACK_ONE],
      assetsByPack: new Map([
        [
          "pack-one",
          [
            asset({ id: "a", role: "kick", name: "Deep Kick" }),
            asset({ id: "b", role: "kick", name: "Alpha Kick" }),
            asset({ id: "c", role: "clap", name: "Wide Clap" }),
          ],
        ],
      ]),
    });
    expect(tree).toHaveLength(1);
    expect(tree[0].groups.map((group) => group.label)).toEqual(["Claps", "Kicks"]);
    // Assets sort by name inside a group, so the order does not depend on the
    // manifest's ordering.
    expect(tree[0].groups[1].assets.map((a) => a.name)).toEqual([
      "Alpha Kick",
      "Deep Kick",
    ]);
    expect(tree[0].matchCount).toBe(3);
  });

  it("prefixes the family only when a pack spans more than one", () => {
    const tree = buildLibraryTree({
      packs: [PACK_ONE],
      assetsByPack: new Map([
        [
          "pack-one",
          [
            asset({ id: "a", family: "drums", role: "kick" }),
            asset({ id: "b", family: "bass", role: "sub" }),
          ],
        ],
      ]),
    });
    expect(tree[0].groups.map((group) => group.label)).toEqual([
      "Bass · Subs",
      "Drums · Kicks",
    ]);
  });

  it("keeps a pack whose manifest has not loaded, with the index's count", () => {
    const tree = buildLibraryTree({
      packs: [PACK_ONE, PACK_TWO],
      assetsByPack: new Map([["pack-one", [asset({ id: "a" })]]]),
    });
    expect(tree[1].loaded).toBe(false);
    expect(tree[1].groups).toEqual([]);
    // Nothing was fetched for it, but the panel can still say how big it is.
    expect(tree[1].assetCount).toBe(9);
  });

  it("marks a failed pack rather than dropping it", () => {
    const tree = buildLibraryTree({
      packs: [PACK_ONE],
      assetsByPack: new Map(),
      failedSlugs: ["pack-one"],
    });
    expect(tree[0].failed).toBe(true);
  });

  it("filters by query and drops groups that no longer match", () => {
    const tree = buildLibraryTree({
      packs: [PACK_ONE],
      assetsByPack: new Map([
        [
          "pack-one",
          [
            asset({ id: "a", role: "kick", name: "Deep Kick" }),
            asset({ id: "b", role: "clap", name: "Wide Clap" }),
          ],
        ],
      ]),
      query: "clap",
    });
    expect(tree[0].groups.map((group) => group.label)).toEqual(["Claps"]);
    expect(tree[0].matchCount).toBe(1);
  });

  it("re-exposes everything when the query clears", () => {
    const assetsByPack = new Map([
      [
        "pack-one",
        [
          asset({ id: "a", role: "kick", name: "Deep Kick" }),
          asset({ id: "b", role: "clap", name: "Wide Clap" }),
        ],
      ],
    ]);
    const filtered = buildLibraryTree({
      packs: [PACK_ONE],
      assetsByPack,
      query: "clap",
    });
    const cleared = buildLibraryTree({
      packs: [PACK_ONE],
      assetsByPack,
      query: "",
    });
    expect(filtered[0].matchCount).toBe(1);
    expect(cleared[0].matchCount).toBe(2);
  });

  it("shows only the packs it was given, in the order it was given them", () => {
    const tree = buildLibraryTree({
      packs: [PACK_TWO, PACK_ONE],
      assetsByPack: new Map(),
    });
    expect(tree.map((pack) => pack.slug)).toEqual(["pack-two", "pack-one"]);
  });
});

describe("groupLabel", () => {
  it("humanizes and pluralizes a role", () => {
    expect(groupLabel("drums", "closed-hat", false)).toBe("Closed hats");
    expect(groupLabel("bass", "sub", false)).toBe("Subs");
    expect(groupLabel("drums", "full-loop", false)).toBe("Full loops");
  });

  it("leaves a mass noun alone rather than inventing a plural", () => {
    expect(groupLabel("drums", "percussion", false)).toBe("Percussion");
  });
});
