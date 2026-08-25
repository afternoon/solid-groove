import { describe, expect, it } from "vitest";
import {
  acquirablePacks,
  PACKS,
  packBySlug,
  packForFamily,
  packId,
  packRef,
  RESERVED_CC0_PACK_SLUG,
} from "./packs.mjs";
import { GENRES, TAXONOMY } from "./taxonomy.mjs";

const PACK_ID = /^pak_[A-Za-z0-9_-]{21}$/;
const PACK_VERSION = /^\d+\.\d+\.\d+$/;

/**
 * Every pack's id, frozen and pasted into `packs.mjs`. Section 5.1/9's
 * controlled vocabulary requires a pack id to be "stable, opaque, and
 * permanent" and "never derived from the name" — so this test pins each
 * literal id rather than re-deriving it from the slug, which would let a
 * future rename or slug change silently mint a new id without failing
 * anything (the failure mode `packId` used to invert).
 */
const EXPECTED_IDS = {
  "core-electronic-drums": "pak_SdlN_OazweXrwury0j27Y",
  "foundation-bass": "pak_FH8gyASzYiWGCrtpKZ-Ho",
  "tonal-elements": "pak_RznkYK7KIIo7BOZQZ_i0O",
  "ambient-textures": "pak_gUou3hBgXF47EwgR-9gZ1",
  "transitions-fx": "pak_PrUvdIGkCE3uRGYeKOGRg",
  "cc0-community": "pak_5o6qI8YY27cYVyqstlJyG",
};

describe("packId", () => {
  it("matches the PRD section 9.4 `pak_`-prefixed shape", () => {
    expect(packId("anything")).toMatch(PACK_ID);
  });

  it("differs across slugs", () => {
    expect(packId("a")).not.toBe(packId("b"));
  });
});

describe("PACKS", () => {
  it("gives every pack a well-formed, unique id and slug", () => {
    const ids = new Set();
    const slugs = new Set();
    for (const pack of PACKS) {
      expect(pack.id).toMatch(PACK_ID);
      expect(ids.has(pack.id)).toBe(false);
      ids.add(pack.id);
      expect(slugs.has(pack.slug)).toBe(false);
      slugs.add(pack.slug);
    }
  });

  it("pins each pack's id — a rename or slug change must not alter it", () => {
    for (const pack of PACKS) {
      expect(pack.id).toBe(EXPECTED_IDS[pack.slug]);
    }
  });

  it("carries the section 5.1 pack record fields", () => {
    for (const pack of PACKS) {
      expect(pack.name).toBeTruthy();
      expect(pack.version).toMatch(PACK_VERSION);
      expect(pack.publisher).toBe("Solid Groove");
      expect(["factory", "user", "third-party"]).toContain(pack.kind);
      expect(pack.description).toBeTruthy();
      // Every pack states what it does not contain (section 6.5).
      expect(pack.description).toMatch(/contains no|reserved/i);
      expect(pack.rights.licence).toBeTruthy();
      expect(pack.rights.rawRedistribution).toBe(true);
      expect(typeof pack.rights.attributionRequired).toBe("boolean");
    }
  });

  it("splits the synthesized catalogue into one pack per family, covering every family", () => {
    const families = PACKS.filter((p) => p.family).map((p) => p.family);
    expect(new Set(families)).toEqual(new Set(Object.keys(TAXONOMY)));
    expect(families).toHaveLength(Object.keys(TAXONOMY).length);
  });

  it("declares a coverage claim whose roles are all real and whose genres are all known", () => {
    for (const pack of PACKS) {
      if (!pack.coverage) continue; // the reserved pack has no content yet
      for (const role of pack.coverage.roles) {
        expect(TAXONOMY[pack.family]).toContain(role);
      }
      for (const genre of pack.coverage.genres) {
        expect(GENRES).toContain(genre);
      }
      expect(pack.coverage.roles.length).toBeGreaterThan(0);
      expect(pack.coverage.genres.length).toBeGreaterThan(0);
    }
  });

  it("has a reserved, unpublished pack for acquired CC0 content", () => {
    const reserved = packBySlug(RESERVED_CC0_PACK_SLUG);
    expect(reserved).not.toBeNull();
    expect(reserved.family).toBeNull();
    expect(reserved.rights.licence).toBe("CC0-1.0");
    expect(reserved.coverage).toBeNull();
  });
});

describe("packForFamily", () => {
  it("returns the one pack that owns a family", () => {
    expect(packForFamily("drums").slug).toBe("core-electronic-drums");
    expect(packForFamily("bass").slug).toBe("foundation-bass");
  });

  it("throws for a family no pack claims", () => {
    expect(() => packForFamily("vocals")).toThrow(/no pack claims/);
  });
});

describe("packBySlug", () => {
  it("finds a registered pack and returns null for an unknown one", () => {
    expect(packBySlug("tonal-elements")?.family).toBe("tonal");
    expect(packBySlug("not-a-real-pack")).toBeNull();
  });
});

describe("acquirablePacks", () => {
  it("only offers packs whose rights position is CC0", () => {
    const packs = acquirablePacks();
    expect(packs.length).toBeGreaterThan(0);
    for (const pack of packs) expect(pack.rights.licence).toBe("CC0-1.0");
    // The synthesized packs are `solid-groove-owned` and are never a valid
    // destination for acquired third-party audio.
    expect(packs.some((p) => p.slug === "core-electronic-drums")).toBe(false);
  });
});

describe("packRef", () => {
  it("is the pack-qualified `{ id, version }` an asset record carries", () => {
    const pack = packForFamily("fx");
    expect(packRef(pack)).toEqual({ id: pack.id, version: pack.version });
  });
});
