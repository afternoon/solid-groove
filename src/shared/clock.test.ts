import { describe, expect, it } from "vitest";
import { createManualClock, systemClock } from "./clock";

describe("systemClock", () => {
	it("tracks real elapsed time", () => {
		const before = Date.now();
		const reading = systemClock.now();
		const after = Date.now();
		expect(reading).toBeGreaterThanOrEqual(before);
		expect(reading).toBeLessThanOrEqual(after);
	});
});

describe("createManualClock", () => {
	it("starts at a fixed epoch, not real time", () => {
		const clock = createManualClock(1_000);
		expect(clock.now()).toBe(1_000);
	});

	it("defaults to epoch zero", () => {
		expect(createManualClock().now()).toBe(0);
	});

	it("set() jumps to an absolute time", () => {
		const clock = createManualClock(0);
		clock.set(5_000);
		expect(clock.now()).toBe(5_000);
	});

	it("advance() moves forward (and backward) relatively", () => {
		const clock = createManualClock(1_000);
		clock.advance(500);
		expect(clock.now()).toBe(1_500);
		clock.advance(-200);
		expect(clock.now()).toBe(1_300);
	});

	it("never advances on its own", () => {
		const clock = createManualClock(42);
		const a = clock.now();
		const b = clock.now();
		expect(a).toBe(b);
	});
});
