import { describe, expect, it } from "vitest";
import { FIXTURE_PACK_INDEX_DOC } from "./__fixtures__/fixtures";
import { variedPackFetcher } from "./__fixtures__/variedPackFetcher";
import { LibraryClient } from "./libraryClient";
import {
  coverCategoryLine,
  familyChoices,
  heardSounds,
  type PackCatalogEntry,
  packCategories,
  packFamilies,
  packHasFamily,
  packInitials,
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
