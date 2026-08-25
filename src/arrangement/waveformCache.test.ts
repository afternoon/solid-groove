import { describe, expect, it } from "vitest";
import { createWaveformCache, selectPeakLevel } from "./waveformCache";

describe("waveform peak generation", () => {
  it("is deterministic for the same asset id and revision", () => {
    const cache = createWaveformCache();
    const first = cache.get("ast_a", 1, 4);
    const other = createWaveformCache().get("ast_a", 1, 4);
    expect(other.levels.map((level) => Array.from(level.max))).toEqual(
      first.levels.map((level) => Array.from(level.max)),
    );
  });

  it("differs when the asset id differs", () => {
    const cache = createWaveformCache();
    const a = cache.get("ast_a", 1, 4);
    const b = cache.get("ast_b", 1, 4);
    expect(Array.from(a.levels[0].max)).not.toEqual(Array.from(b.levels[0].max));
  });

  it("differs when the revision differs (a new decode of the same asset)", () => {
    const cache = createWaveformCache();
    const revisionOne = cache.get("ast_a", 1, 4);
    const revisionTwo = cache.get("ast_a", 2, 4);
    expect(Array.from(revisionOne.levels[0].max)).not.toEqual(
      Array.from(revisionTwo.levels[0].max),
    );
  });

  it("produces multiple resolutions, finest first", () => {
    const cache = createWaveformCache();
    const peaks = cache.get("ast_a", 1, 4);
    expect(peaks.levels.length).toBeGreaterThan(1);
    for (let index = 1; index < peaks.levels.length; index += 1) {
      expect(peaks.levels[index].bucketCount).toBeLessThan(
        peaks.levels[index - 1].bucketCount,
      );
    }
  });

  it("keeps every bucket's min/max within [-1, 1]", () => {
    const cache = createWaveformCache();
    const peaks = cache.get("ast_a", 1, 4);
    for (const level of peaks.levels) {
      for (const value of level.max) {
        expect(value).toBeGreaterThanOrEqual(-1);
        expect(value).toBeLessThanOrEqual(1);
      }
      for (const value of level.min) {
        expect(value).toBeGreaterThanOrEqual(-1);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("createWaveformCache", () => {
  it("caches by (assetId, revision): a second get for the same key is the same object", () => {
    const cache = createWaveformCache();
    const first = cache.get("ast_a", 1, 4);
    const second = cache.get("ast_a", 1, 4);
    expect(second).toBe(first);
    expect(cache.entryCount).toBe(1);
  });

  it("tracks bytesUsed as entries are added", () => {
    const cache = createWaveformCache();
    expect(cache.bytesUsed).toBe(0);
    const peaks = cache.get("ast_a", 1, 4);
    expect(cache.bytesUsed).toBe(peaks.byteLength);
  });

  it("evicts least-recently-used entries once the byte budget is exceeded", () => {
    const peaks = createWaveformCache().get("ast_a", 1, 4);
    const budget = peaks.byteLength * 2 + 1; // room for two, not three
    const cache = createWaveformCache(budget);

    cache.get("ast_a", 1, 4);
    cache.get("ast_b", 1, 4);
    expect(cache.entryCount).toBe(2);

    cache.get("ast_c", 1, 4); // evicts ast_a, the least-recently-used
    expect(cache.entryCount).toBe(2);
    expect(cache.bytesUsed).toBeLessThanOrEqual(budget);
  });

  it("treats a recent get as a use, protecting it from eviction", () => {
    const peaks = createWaveformCache().get("ast_a", 1, 4);
    const budget = peaks.byteLength * 2 + 1;
    const cache = createWaveformCache(budget);

    cache.get("ast_a", 1, 4);
    cache.get("ast_b", 1, 4);
    cache.get("ast_a", 1, 4); // touch ast_a again; ast_b is now the LRU entry
    cache.get("ast_c", 1, 4); // should evict ast_b, not ast_a

    const afterA = cache.get("ast_a", 1, 4);
    expect(afterA).toEqual(peaks);
  });
});

describe("selectPeakLevel", () => {
  it("picks the level with the closest bucket count", () => {
    const peaks = createWaveformCache().get("ast_a", 1, 4);
    const finest = peaks.levels[0];
    const coarsest = peaks.levels[peaks.levels.length - 1];

    expect(selectPeakLevel(peaks, finest.bucketCount)).toBe(finest);
    expect(selectPeakLevel(peaks, coarsest.bucketCount)).toBe(coarsest);
  });
});
