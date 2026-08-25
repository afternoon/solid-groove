import { describe, expect, it } from "vitest";
import {
  fingerprintOf,
  rememberSource,
  reuseIfUnchanged,
  stableStringify,
} from "./fingerprint";

describe("stableStringify", () => {
  it("is independent of object key order", () => {
    expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }));
  });

  it("sorts keys at every nesting depth", () => {
    expect(stableStringify({ z: { b: 1, a: 2 }, a: 1 })).toBe(
      '{"a":1,"z":{"a":2,"b":1}}',
    );
  });

  it("preserves array order", () => {
    expect(stableStringify([3, 1, 2])).toBe("[3,1,2]");
    expect(stableStringify([1, 2, 3])).not.toBe(stableStringify([3, 2, 1]));
  });
});

describe("fingerprintOf", () => {
  it("is deterministic for equal input", () => {
    const a = { name: "Lead", volume: -6, devices: [1, 2] };
    const b = { volume: -6, name: "Lead", devices: [1, 2] };
    expect(fingerprintOf(a)).toBe(fingerprintOf(b));
  });

  it("changes when a relevant field changes", () => {
    const a = fingerprintOf({ volume: -6 });
    const b = fingerprintOf({ volume: -3 });
    expect(a).not.toBe(b);
  });
});

describe("reuseIfUnchanged / rememberSource", () => {
  it("returns the previous entry when every dependency is identical", () => {
    const source = { id: "trk_1" };
    const previous = rememberSource({ built: true }, [source]);
    expect(reuseIfUnchanged(previous, [source])).toBe(previous);
  });

  it("does not reuse when a dependency reference differs", () => {
    const previous = rememberSource({ built: true }, [{ id: "trk_1" }]);
    // A structurally-equal but distinct object must not match — the fast path
    // is object identity, not deep equality (deep equality is exactly the cost
    // it exists to avoid).
    expect(reuseIfUnchanged(previous, [{ id: "trk_1" }])).toBeUndefined();
  });

  it("does not reuse when a scalar dependency differs", () => {
    const source = { id: "trk_1" };
    const previous = rememberSource({ built: true }, [source, 0]);
    expect(reuseIfUnchanged(previous, [source, 0])).toBe(previous);
    expect(reuseIfUnchanged(previous, [source, 1])).toBeUndefined();
  });

  it("does not reuse when the dependency count differs", () => {
    const source = { id: "trk_1" };
    const previous = rememberSource({ built: true }, [source]);
    expect(reuseIfUnchanged(previous, [source, 0])).toBeUndefined();
  });

  it("never reuses a previous entry that predates the cache", () => {
    // An entry built before this mechanism existed has no recorded deps, so it
    // degrades to the caller's fingerprint path rather than misfiring.
    const strangerFromAnOlderBuild = { built: true };
    expect(reuseIfUnchanged(strangerFromAnOlderBuild, [{ id: "trk_1" }])).toBeUndefined();
  });

  it("returns undefined for no previous entry", () => {
    expect(reuseIfUnchanged(undefined, [{ id: "trk_1" }])).toBeUndefined();
  });
});
