import { describe, expect, it } from "vitest";
import { libraryAsset as sound } from "./__fixtures__/assets";
import { ALL_MATCH_ON, lengthCloseness, lengthOf, similarSounds } from "./similarity";

describe("length", () => {
  it("is seconds for one-shots and bars for loops", () => {
    expect(lengthOf(sound({ durationSeconds: 0.4 }))).toBe(0.4);
    expect(lengthOf(sound({ type: "loop", bars: 4, durationSeconds: 8 }))).toBe(4);
  });
  it("scores 1 - |a-b|/max, clamped, and 0 when unknown", () => {
    expect(lengthCloseness(1, 1)).toBe(1);
    expect(lengthCloseness(1, 2)).toBe(0.5);
    expect(lengthCloseness(2, 1)).toBe(0.5);
    expect(lengthCloseness(null, 1)).toBe(0);
    expect(lengthCloseness(0, 0)).toBe(0);
  });
});

describe("similarSounds", () => {
  const ref = sound({ role: "kick", genres: ["house"], durationSeconds: 1 });

  it("scores role, genre and length as a percentage over the enabled weights", () => {
    const twin = sound({ role: "kick", genres: ["house"], durationSeconds: 1 });
    const halfLong = sound({ role: "kick", genres: [], durationSeconds: 0.5 });
    const other = sound({ role: "snare", genres: ["house"], durationSeconds: 1 });
    const got = similarSounds(ref, [twin, halfLong, other]);
    // twin 7/7; other 1+2 = 3/7; halfLong 4 + 2*0.5 = 5/7
    expect(got.map((s) => [s.asset, s.percent])).toEqual([
      [twin, 100],
      [halfLong, 71],
      [other, 43],
    ]);
  });

  it("excludes the reference and anything from another family, includes every pack", () => {
    const elsewhere = sound({ packId: "pak_z", packSlug: "z" });
    const bass = sound({ family: "bass", role: "kick" });
    const asLoop = sound({ type: "loop", bars: 1 });
    const got = similarSounds(ref, [ref, elsewhere, bass, asLoop]);
    expect(got.map((s) => s.asset)).toEqual([elsewhere]);
  });

  it("compares loops by bars, with loops only against loops", () => {
    const a = sound({ type: "loop", role: "full-loop", bars: 4, durationSeconds: 8 });
    const b = sound({ type: "loop", role: "full-loop", bars: 2, durationSeconds: 99 });
    expect(similarSounds(a, [b, ref])).toEqual([{ asset: b, percent: 71 }]);
  });

  it("re-normalises when a toggle is off", () => {
    const other = sound({ role: "snare", genres: ["house"], durationSeconds: 1 });
    expect(
      similarSounds(ref, [other], { ...ALL_MATCH_ON, category: false })[0].percent,
    ).toBe(100);
    expect(
      similarSounds(ref, [other], { category: true, genre: false, length: false })[0]
        .percent,
    ).toBe(0);
  });

  it("returns nothing when every toggle is off: there is nothing to rank on", () => {
    expect(
      similarSounds(ref, [sound()], { category: false, genre: false, length: false }),
    ).toEqual([]);
  });

  it("returns nothing for a reference the shelf cannot place", () => {
    expect(similarSounds(sound({ type: "preset" }), [sound()])).toEqual([]);
  });

  it("breaks ties by name and keeps the top N (default 16)", () => {
    const zed = sound({ name: "Zed" });
    const abe = sound({ name: "Abe" });
    expect(similarSounds(ref, [zed, abe]).map((s) => s.asset.name)).toEqual([
      "Abe",
      "Zed",
    ]);
    const many = Array.from({ length: 20 }, () => sound());
    expect(similarSounds(ref, many)).toHaveLength(16);
    expect(similarSounds(ref, many, ALL_MATCH_ON, 3)).toHaveLength(3);
  });

  it("treats a missing length as no closeness rather than failing", () => {
    const unknown = sound({ durationSeconds: null });
    expect(similarSounds(ref, [unknown])[0].percent).toBe(57);
  });
});
