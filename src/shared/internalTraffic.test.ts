import { beforeEach, describe, expect, it } from "vitest";
import {
	INTERNAL_TRAFFIC_STORAGE_KEY,
	isInternalTraffic,
	parseInternalTrafficParam,
	syncInternalTraffic,
} from "./internalTraffic";

describe("parseInternalTrafficParam", () => {
	it("treats a missing param as no claim", () => {
		expect(parseInternalTrafficParam(null)).toBeUndefined();
	});

	it.each(["1", "true", "TRUE", " true "])("parses %j as true", (value) => {
		expect(parseInternalTrafficParam(value)).toBe(true);
	});

	it.each(["0", "false", "FALSE"])("parses %j as false", (value) => {
		expect(parseInternalTrafficParam(value)).toBe(false);
	});

	it("treats an unrecognized value as no claim rather than guessing", () => {
		expect(parseInternalTrafficParam("yes")).toBeUndefined();
	});
});

describe("isInternalTraffic / syncInternalTraffic", () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it("defaults to false with nothing persisted and no query claim", () => {
		expect(isInternalTraffic()).toBe(false);
		expect(syncInternalTraffic({ search: "" })).toBe(false);
	});

	it("persists internal=1 so it survives a later load with no param", () => {
		expect(syncInternalTraffic({ search: "?internal=1" })).toBe(true);
		expect(localStorage.getItem(INTERNAL_TRAFFIC_STORAGE_KEY)).toBe("true");

		// A later navigation with no query param at all still reads as internal.
		expect(syncInternalTraffic({ search: "" })).toBe(true);
	});

	it("internal=0 clears a previously persisted flag", () => {
		syncInternalTraffic({ search: "?internal=1" });
		expect(isInternalTraffic()).toBe(true);

		expect(syncInternalTraffic({ search: "?internal=0" })).toBe(false);
		expect(localStorage.getItem(INTERNAL_TRAFFIC_STORAGE_KEY)).toBeNull();
		expect(isInternalTraffic()).toBe(false);
	});

	it("fails closed if storage throws rather than surfacing an error", () => {
		const throwingStorage: Storage = {
			getItem: () => {
				throw new Error("storage disabled");
			},
			setItem: () => {
				throw new Error("storage disabled");
			},
			removeItem: () => {
				throw new Error("storage disabled");
			},
			clear: () => {},
			key: () => null,
			length: 0,
		};

		expect(isInternalTraffic(throwingStorage)).toBe(false);
		expect(() =>
			syncInternalTraffic({ search: "?internal=1" }, throwingStorage),
		).not.toThrow();
	});
});
