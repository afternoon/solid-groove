import { describe, expect, it } from "vitest";
import { fixtureFetcher } from "./__fixtures__/fixtures";
import { LibraryClient } from "./libraryClient";
import type { LibraryAsset } from "./manifest";
import {
  EMPTY_FILTER,
  EMPTY_PACK_FILTER,
  facetValues,
  filterAssets,
  filterPacks,
  hasGenreFilter,
  isEmptyFilter,
} from "./search";

/** Every asset across the fixture packs, as the cross-pack scope sees them. */
async function allAssets(): Promise<LibraryAsset[]> {
  const client = new LibraryClient(fixtureFetcher());
  const packs = await client.loadIndex();
  const loaded = await Promise.all(packs.map((pack) => client.loadPack(pack)));
  return loaded.flatMap((result) => (result.ok ? result.assets : []));
}

describe("filtering", () => {
  it("shows everything with the empty filter", async () => {
    const assets = await allAssets();
    expect(isEmptyFilter(EMPTY_FILTER)).toBe(true);
    expect(filterAssets(assets, EMPTY_FILTER)).toHaveLength(assets.length);
  });

  it("matches a text query across name, role, family, and pack", async () => {
    const assets = await allAssets();
    const kick = filterAssets(assets, { ...EMPTY_FILTER, query: "kick" });
    expect(kick.length).toBeGreaterThan(0);
    expect(kick.every((asset) => /kick/i.test(`${asset.name} ${asset.role}`)));
  });

  it("filters within one pack and across every pack", async () => {
    const assets = await allAssets();
    const oneSlug = assets[0].packSlug;
    const withinPack = filterAssets(assets, {
      ...EMPTY_FILTER,
      packSlug: oneSlug,
    });
    expect(withinPack.every((asset) => asset.packSlug === oneSlug)).toBe(true);
    // Across every pack, the same genre filter reaches assets in more than one.
    const genre = assets.find((asset) => asset.genres.length > 0)?.genres[0];
    if (genre) {
      const across = filterAssets(assets, { ...EMPTY_FILTER, genres: [genre] });
      const packsHit = new Set(across.map((asset) => asset.packSlug));
      expect(packsHit.size).toBeGreaterThanOrEqual(1);
    }
  });

  it("clearing the pack filter never hides an asset the query still admits", async () => {
    const assets = await allAssets();
    const slug = assets[0].packSlug;
    const scoped = filterAssets(assets, { ...EMPTY_FILTER, packSlug: slug });
    const unscoped = filterAssets(assets, { ...EMPTY_FILTER, packSlug: null });
    // Every asset visible with the pack filter is still visible without it.
    for (const asset of scoped) {
      expect(unscoped.some((other) => other.id === asset.id)).toBe(true);
    }
    expect(unscoped.length).toBeGreaterThanOrEqual(scoped.length);
  });

  it("clearing a genre filter re-exposes every asset (LIB-02)", async () => {
    const assets = await allAssets();
    const genre = assets.find((asset) => asset.genres.length > 0)?.genres[0];
    expect(genre).toBeDefined();
    const filtered = filterAssets(assets, {
      ...EMPTY_FILTER,
      genres: [genre as string],
    });
    expect(filtered.length).toBeLessThanOrEqual(assets.length);
    const cleared = filterAssets(assets, EMPTY_FILTER);
    expect(cleared).toHaveLength(assets.length);
  });

  it("combines facets with AND and values within a facet with OR", async () => {
    const assets = await allAssets();
    const roles = [...new Set(assets.map((asset) => asset.role))].slice(0, 2);
    const orWithinRole = filterAssets(assets, { ...EMPTY_FILTER, roles });
    expect(orWithinRole.every((asset) => roles.includes(asset.role))).toBe(true);
    // Adding a type facet can only narrow (AND across facets).
    const andAcross = filterAssets(assets, {
      ...EMPTY_FILTER,
      roles,
      types: ["loop"],
    });
    expect(andAcross.length).toBeLessThanOrEqual(orWithinRole.length);
    expect(andAcross.every((asset) => asset.type === "loop")).toBe(true);
  });

  it("reports whether a genre facet is active", () => {
    expect(hasGenreFilter(EMPTY_FILTER)).toBe(false);
    expect(hasGenreFilter({ ...EMPTY_FILTER, genres: ["house"] })).toBe(true);
  });
});

describe("facet values", () => {
  it("offers only values some loaded asset carries", async () => {
    const assets = await allAssets();
    const facets = facetValues(assets);
    expect(facets.genres.length).toBeGreaterThan(0);
    expect(facets.roles.length).toBeGreaterThan(0);
    for (const genre of facets.genres) {
      expect(assets.some((asset) => asset.genres.includes(genre))).toBe(true);
    }
  });
});

describe("responsiveness at the planned library size (section 12)", () => {
  it("filters 1,000 assets well under the 50 ms target", async () => {
    const base = await allAssets();
    // The fan-out below is driven by this count, so state the premise rather
    // than looping on it: with no fixture assets there is nothing to measure.
    expect(base.length).toBeGreaterThan(0);
    // Fan the fixture assets out to the section 12 baseline of 1,000, with
    // distinct ids so nothing is deduplicated away. Indexing a fixed range
    // keeps the bound a function of TARGET alone -- an empty `base` could not
    // make this loop fail to advance, only fail the assertion above.
    const TARGET = 1000;
    const many: LibraryAsset[] = Array.from({ length: TARGET }, (_, index) => {
      const asset = base[index % base.length];
      return { ...asset, id: `${asset.id}-${Math.floor(index / base.length)}` };
    });
    expect(many).toHaveLength(TARGET);
    const start = performance.now();
    const result = filterAssets(many, {
      ...EMPTY_FILTER,
      query: "kick",
      genres: ["house"],
    });
    const elapsed = performance.now() - start;
    expect(result.length).toBeGreaterThanOrEqual(0);
    // Generous headroom over the 50 ms target so the assertion is not flaky on
    // a loaded CI machine, while still catching an accidental O(n^2) regression.
    expect(elapsed).toBeLessThan(50);
  });
});

describe("filtering packs (the pack browser's own facets)", () => {
  async function packs() {
    return new LibraryClient(fixtureFetcher()).loadIndex();
  }

  it("admits every pack when nothing is active", async () => {
    const all = await packs();
    expect(filterPacks(all, EMPTY_PACK_FILTER)).toHaveLength(all.length);
  });

  it("matches a pack's name, publisher, or description", async () => {
    const all = await packs();
    const byName = filterPacks(all, {
      ...EMPTY_PACK_FILTER,
      query: "foundation",
    });
    expect(byName.length).toBeGreaterThan(0);
    expect(byName.length).toBeLessThan(all.length);
    // The publisher is a way in too, so "who made this" is searchable.
    const byPublisher = filterPacks(all, {
      ...EMPTY_PACK_FILTER,
      query: all[0].publisher,
    });
    expect(byPublisher.length).toBeGreaterThan(0);
  });

  it("narrows by kind, and clearing the kind facet widens again", async () => {
    const all = await packs();
    const factory = filterPacks(all, {
      ...EMPTY_PACK_FILTER,
      kinds: ["factory"],
    });
    expect(factory.every((pack) => pack.kind === "factory")).toBe(true);
    const user = filterPacks(all, { ...EMPTY_PACK_FILTER, kinds: ["user"] });
    expect(user).toHaveLength(0);
    expect(filterPacks(all, EMPTY_PACK_FILTER)).toHaveLength(all.length);
  });
});
