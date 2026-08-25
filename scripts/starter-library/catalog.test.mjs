import { describe, expect, it } from "vitest";
import { CATALOG, catalogCounts } from "./catalog/index.mjs";
import { CHARACTERS, GENRES, INTENSITIES, isKnownRole } from "./taxonomy.mjs";
import { VOICES } from "./voices.mjs";

// The starter library is a delivery target, not an open-ended pile: the
// docs/sample-library.md section 6.2 allocation is what makes it usable rather
// than merely large.
const EXPECTED_COUNTS = {
  "drums/kick": 24,
  "drums/snare": 13,
  "drums/clap": 9,
  "drums/rim": 5,
  "drums/closed-hat": 12,
  "drums/open-hat": 7,
  "drums/cymbal": 9,
  "drums/tom": 8,
  "drums/percussion": 24,
  "bass/sub": 8,
  "bass/sustained": 5,
  "bass/reese": 4,
  "bass/stab": 4,
  "tonal/chord": 7,
  "tonal/stab": 4,
  "tonal/pluck": 4,
  "tonal/key": 4,
  "tonal/mallet": 3,
  "tonal/bell": 3,
  "texture/noise": 5,
  "texture/ambience": 4,
  "texture/drone": 4,
  "texture/mechanical": 3,
  "texture/organic": 3,
  "fx/impact": 6,
  "fx/riser": 5,
  "fx/downer": 4,
  "fx/sweep": 3,
  "fx/reverse": 3,
  "fx/glitch": 3,
};

describe("starter catalogue", () => {
  it("delivers 200 assets in the planned role allocation", () => {
    expect(CATALOG).toHaveLength(200);
    expect(catalogCounts()).toEqual(EXPECTED_COUNTS);
  });

  it("gives every asset a unique, well-formed, stable id", () => {
    const ids = CATALOG.map((asset) => asset.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^sg-one-shot-[a-z]+-[a-z-]+-\d{4}$/);
  });

  // Asset IDs are derived from position within a role group, so reordering or
  // removing an entry silently renumbers every later asset and breaks the
  // references saved in existing projects. Pinning the boundaries turns that
  // into a test failure instead of a data-loss bug.
  it("keeps id assignment stable against reordering", () => {
    const byRole = new Map();
    for (const asset of CATALOG) {
      const key = `${asset.family}/${asset.role}`;
      if (!byRole.has(key)) byRole.set(key, []);
      byRole.get(key).push(asset);
    }
    for (const [key, assets] of byRole) {
      assets.forEach((asset, index) => {
        const expected = `sg-one-shot-${key.replace("/", "-")}-${String(index + 1).padStart(4, "0")}`;
        expect(asset.id).toBe(expected);
      });
    }
    expect(CATALOG[0].id).toBe("sg-one-shot-drums-kick-0001");
    expect(CATALOG[0].name).toBe("Rounded Club Kick");
    expect(CATALOG.at(-1)?.id).toBe("sg-one-shot-fx-glitch-0003");
    expect(CATALOG.at(-1)?.name).toBe("Folded Data Glitch");
  });

  it("gives every asset a unique user-facing name", () => {
    const names = CATALOG.map((asset) => asset.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("only uses the controlled vocabulary", () => {
    for (const asset of CATALOG) {
      expect(isKnownRole(asset.family, asset.role)).toBe(true);
      expect(VOICES[asset.voice]).toBeTypeOf("function");
      expect(INTENSITIES).toContain(asset.intensity);
      expect(asset.genres.length).toBeGreaterThan(0);
      expect(asset.characters.length).toBeGreaterThan(0);
      for (const genre of asset.genres) expect(GENRES).toContain(genre);
      for (const character of asset.characters) expect(CHARACTERS).toContain(character);
    }
  });

  // PRD LIB-02: the library must support every required genre without any
  // asset being technically restricted to one.
  it("covers every required genre with usable material", () => {
    for (const genre of GENRES) {
      const tagged = CATALOG.filter((asset) => asset.genres.includes(genre));
      expect(tagged.length, `genre ${genre}`).toBeGreaterThanOrEqual(10);
      // Superficial relabelling of one narrow sound set is an explicit
      // rejection criterion, so require breadth of family too.
      const families = new Set(tagged.map((asset) => asset.family));
      expect(families.size, `genre ${genre} families`).toBeGreaterThanOrEqual(3);
    }
  });

  it("records a root note for tonal material and none for unpitched material", () => {
    for (const asset of CATALOG) {
      if (["bass", "tonal"].includes(asset.family)) {
        expect(asset.rootNote, asset.id).toMatch(/^[A-G][#b]?-?\d+$/);
      }
      if (asset.family === "fx") expect(asset.rootNote, asset.id).toBeNull();
    }
  });

  // docs/sample-library.md section 10 asks for choke relationships between
  // open and closed hat pairs to be recorded rather than inferred at runtime.
  it("marks hat choke membership on both sides of the pair", () => {
    const closed = CATALOG.filter((asset) => asset.role === "closed-hat");
    const open = CATALOG.filter((asset) => asset.role === "open-hat");
    expect(closed.every((asset) => asset.choke === "closed")).toBe(true);
    expect(open.every((asset) => asset.choke === "open")).toBe(true);
    expect(
      CATALOG.filter((asset) => asset.choke && !asset.role.endsWith("hat")),
    ).toHaveLength(0);
  });
});
