import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
	finiteNumberInRange,
	parseOrThrow,
	SchemaValidationError,
	safeParseWithIssues,
} from "./schema";

const point = z.object({ x: z.number(), y: z.number() });

describe("parseOrThrow", () => {
	it("returns the parsed value on success", () => {
		expect(parseOrThrow(point, { x: 1, y: 2 })).toEqual({ x: 1, y: 2 });
	});

	it("throws SchemaValidationError on failure, without returning a partial value", () => {
		expect(() => parseOrThrow(point, { x: 1 })).toThrow(SchemaValidationError);
	});

	it("includes the optional context in the thrown message", () => {
		try {
			parseOrThrow(point, { x: 1 }, "loading fixture");
			throw new Error("expected parseOrThrow to throw");
		} catch (error) {
			expect(error).toBeInstanceOf(SchemaValidationError);
			expect((error as SchemaValidationError).message).toContain(
				"loading fixture",
			);
		}
	});

	it("exposes the underlying Zod issues for programmatic inspection", () => {
		try {
			parseOrThrow(point, { x: 1 });
			throw new Error("expected parseOrThrow to throw");
		} catch (error) {
			expect((error as SchemaValidationError).issues.length).toBeGreaterThan(0);
		}
	});

	it("rejects malformed input rather than silently coercing it", () => {
		expect(() => parseOrThrow(point, { x: "1", y: 2 })).toThrow();
		expect(() => parseOrThrow(point, null)).toThrow();
		expect(() => parseOrThrow(point, undefined)).toThrow();
	});
});

describe("safeParseWithIssues", () => {
	it("returns success:true with the parsed data", () => {
		const result = safeParseWithIssues(point, { x: 1, y: 2 });
		expect(result).toEqual({ success: true, data: { x: 1, y: 2 } });
	});

	it("returns success:false with a human-readable issues string, never throwing", () => {
		const result = safeParseWithIssues(point, { x: "nope" });
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.issues).toContain("x");
		}
	});
});

describe("finiteNumberInRange", () => {
	const volume = finiteNumberInRange(0, 1);

	it("accepts values within range", () => {
		expect(parseOrThrow(volume, 0)).toBe(0);
		expect(parseOrThrow(volume, 1)).toBe(1);
		expect(parseOrThrow(volume, 0.5)).toBe(0.5);
	});

	it("rejects values outside range", () => {
		expect(() => parseOrThrow(volume, -0.01)).toThrow();
		expect(() => parseOrThrow(volume, 1.01)).toThrow();
	});

	it("rejects non-finite numbers", () => {
		expect(() => parseOrThrow(volume, Number.NaN)).toThrow();
		expect(() => parseOrThrow(volume, Number.POSITIVE_INFINITY)).toThrow();
	});
});
