import { describe, expect, it } from "vitest";
import { fingerprintOf, stableStringify } from "./fingerprint";

describe("stableStringify", () => {
	it("is independent of object key order", () => {
		expect(stableStringify({ a: 1, b: 2 })).toBe(
			stableStringify({ b: 2, a: 1 }),
		);
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
