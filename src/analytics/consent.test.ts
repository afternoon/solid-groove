import { describe, expect, it, vi } from "vitest";
import { hostileStorage, memoryStorage } from "../testing/storage";
import { CONSENT_DEFAULT, CONSENT_STORAGE_KEY, ConsentStore } from "./consent";

describe("default state (DEC-009 owns the value, this owns the mechanism)", () => {
	it("uses the declared default when nothing is stored", () => {
		expect(new ConsentStore(memoryStorage()).current).toEqual(CONSENT_DEFAULT);
	});

	it("falls back to the default rather than throwing on corrupt storage", () => {
		const storage = memoryStorage();
		storage.setItem(CONSENT_STORAGE_KEY, "{not json");
		expect(new ConsentStore(storage).current).toEqual(CONSENT_DEFAULT);
	});

	it("fills a missing field from the default rather than dropping it", () => {
		const storage = memoryStorage();
		storage.setItem(
			CONSENT_STORAGE_KEY,
			JSON.stringify({ productAnalytics: false }),
		);
		const store = new ConsentStore(storage);
		expect(store.analyticsAllowed).toBe(false);
		expect(store.errorMonitoringAllowed).toBe(CONSENT_DEFAULT.errorMonitoring);
	});
});

describe("opting out", () => {
	it("turns both processors off in one action", () => {
		const store = new ConsentStore(memoryStorage());
		store.optOut();
		expect(store.analyticsAllowed).toBe(false);
		expect(store.errorMonitoringAllowed).toBe(false);
	});

	it("survives a reload", () => {
		const storage = memoryStorage();
		new ConsentStore(storage).optOut();
		expect(new ConsentStore(storage).analyticsAllowed).toBe(false);
	});

	it("keeps the two processors independently controllable", () => {
		// DEC-009 may decide differently about a reliability signal than about
		// product analytics, so the model must not force them together.
		const store = new ConsentStore(memoryStorage());
		store.set({ productAnalytics: false });
		expect(store.analyticsAllowed).toBe(false);
		expect(store.errorMonitoringAllowed).toBe(true);
	});
});

describe("subscribers", () => {
	it("delivers the current state immediately and on every change", () => {
		const store = new ConsentStore(memoryStorage());
		const seen = vi.fn();
		store.subscribe(seen);
		expect(seen).toHaveBeenCalledTimes(1);
		store.optOut();
		expect(seen).toHaveBeenCalledTimes(2);
		expect(seen.mock.lastCall?.[0].productAnalytics).toBe(false);
	});

	it("does not notify when nothing actually changed", () => {
		const store = new ConsentStore(memoryStorage());
		const seen = vi.fn();
		store.subscribe(seen);
		store.set({ productAnalytics: CONSENT_DEFAULT.productAnalytics });
		expect(seen).toHaveBeenCalledTimes(1);
	});

	it("stops notifying after unsubscribe", () => {
		const store = new ConsentStore(memoryStorage());
		const seen = vi.fn();
		store.subscribe(seen)();
		store.optOut();
		expect(seen).toHaveBeenCalledTimes(1);
	});

	it("still tells the other consumers to stop when one subscriber throws", () => {
		// The consumers being notified are the ones that must stop collecting;
		// one broken listener must not leave another still sending.
		const store = new ConsentStore(memoryStorage());
		const good = vi.fn();
		store.subscribe(() => {
			throw new Error("listener exploded");
		});
		store.subscribe(good);
		expect(() => store.optOut()).not.toThrow();
		expect(good).toHaveBeenCalledTimes(2);
	});
});

describe("fail-open storage (PRD OPS-02)", () => {
	it("constructs against a storage that throws", () => {
		const store = new ConsentStore(hostileStorage());
		expect(store.current).toEqual(CONSENT_DEFAULT);
	});

	it("applies a preference for the session even when it cannot be persisted", () => {
		const store = new ConsentStore(hostileStorage());
		expect(() => store.optOut()).not.toThrow();
		expect(store.analyticsAllowed).toBe(false);
	});

	it("works with no storage at all", () => {
		const store = new ConsentStore(null);
		store.optOut();
		expect(store.errorMonitoringAllowed).toBe(false);
	});
});
