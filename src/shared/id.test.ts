import { describe, expect, it } from "vitest";
import { createId, createSeededIdFactory, ID_PREFIXES, isPrefixedId } from "./id";

describe("createId", () => {
  it("produces the PRD 9.4 prefixed-nanoid shape for every prefix", () => {
    for (const prefix of ID_PREFIXES) {
      const id = createId(prefix);
      expect(id).toMatch(new RegExp(`^${prefix}_[A-Za-z0-9_-]{21}$`));
      expect(isPrefixedId(prefix, id)).toBe(true);
    }
  });

  it("does not repeat within a large sample", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => createId("trk")));
    expect(ids.size).toBe(1000);
  });
});

describe("isPrefixedId", () => {
  it("rejects the wrong prefix, wrong length, and non-nanoid characters", () => {
    const id = createId("trk");
    expect(isPrefixedId("clp", id)).toBe(false);
    expect(isPrefixedId("trk", "trk_tooshort")).toBe(false);
    expect(isPrefixedId("trk", `trk_${"!".repeat(21)}`)).toBe(false);
  });
});

describe("createSeededIdFactory", () => {
  it("is deterministic: the same seed produces the same sequence", () => {
    const a = createSeededIdFactory(42);
    const b = createSeededIdFactory(42);

    expect(a("trk")).toBe(b("trk"));
    expect(a("clp")).toBe(b("clp"));
    expect(a("evt")).toBe(b("evt"));
  });

  it("produces syntactically valid prefixed IDs", () => {
    const factory = createSeededIdFactory(7);
    for (const prefix of ID_PREFIXES) {
      expect(isPrefixedId(prefix, factory(prefix))).toBe(true);
    }
  });

  it("different seeds produce different sequences", () => {
    const a = createSeededIdFactory(1);
    const b = createSeededIdFactory(2);
    expect(a("trk")).not.toBe(b("trk"));
  });

  it("shares one counter across prefixes, like a single real generator", () => {
    const factory = createSeededIdFactory(99);
    const first = [factory("trk"), factory("clp"), factory("evt")];

    const other = createSeededIdFactory(99);
    const second = [other("trk"), other("clp"), other("evt")];

    expect(first).toEqual(second);
  });
});
