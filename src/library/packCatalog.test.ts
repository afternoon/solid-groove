import { describe, expect, it } from "vitest";
import { FIXTURE_PACK_INDEX_DOC } from "./__fixtures__/fixtures";
import { variedPackFetcher } from "./__fixtures__/variedPackFetcher";
import { LibraryClient } from "./libraryClient";
import {
  categoriesLabel,
  coverCategoryLine,
  familyChoices,
  heardSounds,
  type PackCatalogEntry,
  packCategories,
  packCounts,
  packFamilies,
  packHasFamily,
  packInitials,
  shelfCategoryCount,
  shelfSounds,
  watchPackCatalog,
} from "./packCatalog";

/** Resolves with the entries once every pack's manifest has loaded. */
function loadEntries(onEach?: (loaded: number) => void) {
  return new Promise<readonly PackCatalogEntry[]>((resolve) => {
    watchPackCatalog(new LibraryClient(variedPackFetcher()), (entries) => {
      onEach?.(entries.filter((entry) => entry.assets !== null).length);
      if (entries.length > 0 && entries.every((entry) => entry.assets !== null)) {
        resolve(entries);
      }
    });
  });
}

describe("packInitials", () => {
  it("takes the first letters of the first two words", () => {
    expect(packInitials("Core Electronic Drums")).toBe("CE");
    expect(packInitials("Foundation")).toBe("F");
    expect(packInitials("  — Deep  Sub ")).toBe("DS");
  });
});

describe("a pack catalog", () => {
  it("lists every pack first with no assets, then fills each in", async () => {
    const loaded: number[] = [];
    const entries = await loadEntries((n) => loaded.push(n));
    expect(entries).toHaveLength(FIXTURE_PACK_INDEX_DOC.packs.length);
    expect(loaded[0]).toBe(0);
  });

  it("stops reporting once cancelled", async () => {
    let calls = 0;
    const cancel = watchPackCatalog(new LibraryClient(variedPackFetcher()), () => {
      calls += 1;
    });
    cancel();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls).toBe(0);
  });

  it("names a cover's biggest categories and how many more it has", async () => {
    const [drums] = await loadEntries();
    const assets = drums.assets ?? [];
    const counts = packCategories(assets).map(([, n]) => n);
    expect(counts).toHaveLength(7);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
    const line = coverCategoryLine(assets);
    expect(line.split(" · ")).toHaveLength(4);
    expect(line).toMatch(new RegExp(`\\+${counts.length - 3} more$`));
  });

  it("narrows by the families a pack holds", async () => {
    const entries = await loadEntries();
    const [drums, bass] = entries;
    expect(packFamilies(drums.assets ?? [])).toContain("drums");
    expect(packHasFamily(drums, "drums")).toBe(true);
    expect(packHasFamily(bass, "drums")).toBe(false);
    expect(packHasFamily(bass, null)).toBe(true);
    expect(familyChoices(entries).map((choice) => choice.key)).toEqual(
      expect.arrayContaining(["drums", "bass"]),
    );
  });

  it("runs Hear it through one sound per category, one-shots only", async () => {
    const [drums] = await loadEntries();
    const run = heardSounds(drums.assets ?? []);
    expect(run.length).toBeGreaterThan(1);
    expect(run.length).toBeLessThanOrEqual(6);
    expect(new Set(run.map((asset) => asset.role)).size).toBe(run.length);
    expect(run.every((asset) => asset.type === "one-shot")).toBe(true);
  });
});

describe("what a pack advertises (GRV-48)", () => {
  it("counts the sounds and categories its shelf shows in the scope", async () => {
    const [drums] = await loadEntries();
    const all = drums.assets ?? [];
    // Five one-shots over five roles, a drum loop, and a kit preset.
    expect(all.map((asset) => asset.type).sort()).toEqual([
      "loop",
      "one-shot",
      "one-shot",
      "one-shot",
      "one-shot",
      "one-shot",
      "preset",
    ]);
    // From a pad: the one-shots alone.
    expect(packCounts(drums, ["one-shot"])).toEqual({ sounds: 5, categories: 5 });
    // From a loop track: the loop alone.
    expect(packCounts(drums, ["loop"])).toEqual({ sounds: 1, categories: 1 });
    // With no slot: everything the shelf has a family for, never the preset.
    expect(packCounts(drums)).toEqual({ sounds: 6, categories: 6 });
    expect(shelfSounds(all).some((asset) => asset.type === "preset")).toBe(false);
  });

  it("knows only the index's total before the manifest loads", () => {
    const [pack] = FIXTURE_PACK_INDEX_DOC.packs;
    const entry = { pack, assets: null } as unknown as PackCatalogEntry;
    expect(packCounts(entry, ["one-shot"])).toEqual({
      sounds: pack.assetCount,
      categories: null,
    });
  });

  it("counts a role two families share once per family, as the shelf's chips do", async () => {
    const [, bass] = await loadEntries();
    const [sound] = shelfSounds(bass.assets ?? [], ["one-shot"]);
    const stabs = [
      { ...sound, id: "a", family: "bass", role: "stab" },
      { ...sound, id: "b", family: "tonal", role: "stab" },
    ];
    expect(shelfCategoryCount(stabs)).toBe(2);
  });

  it("says category in the singular for one", () => {
    expect(categoriesLabel(1)).toBe("1 category");
    expect(categoriesLabel(4)).toBe("4 categories");
  });
});
