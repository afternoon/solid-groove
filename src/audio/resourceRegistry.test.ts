import { describe, expect, it, vi } from "vitest";
import { ResourceRegistry } from "./resourceRegistry";

describe("ResourceRegistry", () => {
	it("counts registered resources by type and owner", () => {
		const registry = new ResourceRegistry();
		registry.register("track-1", "node", () => {});
		registry.register("track-1", "node", () => {});
		registry.register("track-1", "schedule", () => {});
		registry.register("track-2", "node", () => {});

		const counts = registry.counts();
		expect(counts.total).toBe(4);
		expect(counts.byType.node).toBe(3);
		expect(counts.byType.schedule).toBe(1);
		expect(counts.byOwner["track-1"]).toBe(3);
		expect(counts.byOwner["track-2"]).toBe(1);
	});

	it("disposes and untracks a single resource, without retaining it", async () => {
		const registry = new ResourceRegistry();
		const dispose = vi.fn();
		const handle = registry.register("owner", "buffer", dispose);

		expect(registry.has(handle)).toBe(true);
		await registry.disposeOne(handle);

		expect(dispose).toHaveBeenCalledTimes(1);
		expect(registry.has(handle)).toBe(false);
		expect(registry.isEmpty()).toBe(true);
	});

	it("disposeOne is a no-op the second time — safe for double release/cancellation", async () => {
		const registry = new ResourceRegistry();
		const dispose = vi.fn();
		const handle = registry.register("owner", "pendingLoad", dispose);

		await registry.disposeOne(handle);
		await registry.disposeOne(handle);
		await registry.disposeOne(handle);

		expect(dispose).toHaveBeenCalledTimes(1);
	});

	it("disposeOwner tears down only that owner's resources", async () => {
		const registry = new ResourceRegistry();
		const disposeA = vi.fn();
		const disposeB = vi.fn();
		registry.register("owner-a", "node", disposeA);
		registry.register("owner-b", "node", disposeB);

		await registry.disposeOwner("owner-a");

		expect(disposeA).toHaveBeenCalledTimes(1);
		expect(disposeB).not.toHaveBeenCalled();
		expect(registry.countForOwner("owner-a")).toBe(0);
		expect(registry.countForOwner("owner-b")).toBe(1);
		// The disposed owner disappears from counts entirely rather than being
		// retained with a zero count.
		expect(registry.counts().byOwner["owner-a"]).toBeUndefined();
	});

	it("disposeOwner is idempotent", async () => {
		const registry = new ResourceRegistry();
		const dispose = vi.fn();
		registry.register("owner", "timer", dispose);

		const firstErrors = await registry.disposeOwner("owner");
		const secondErrors = await registry.disposeOwner("owner");

		expect(dispose).toHaveBeenCalledTimes(1);
		expect(firstErrors).toEqual([]);
		expect(secondErrors).toEqual([]);
	});

	it("a throwing disposer does not stop the rest of the batch and is still untracked", async () => {
		const registry = new ResourceRegistry();
		const failing = vi.fn(() => {
			throw new Error("boom");
		});
		const succeeding = vi.fn();
		registry.register("owner", "worker", failing);
		registry.register("owner", "worker", succeeding);

		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		const errors = await registry.disposeOwner("owner");
		consoleError.mockRestore();

		expect(succeeding).toHaveBeenCalledTimes(1);
		expect(errors).toHaveLength(1);
		expect(errors[0].message).toBe("boom");
		// A broken disposer still gets removed rather than pinned forever.
		expect(registry.isEmpty()).toBe(true);
	});

	it("disposeAll clears every owner", async () => {
		const registry = new ResourceRegistry();
		registry.register("owner-a", "node", () => {});
		registry.register("owner-b", "schedule", () => {});
		registry.register("owner-c", "subscription", () => {});

		const errors = await registry.disposeAll();

		expect(errors).toEqual([]);
		expect(registry.isEmpty()).toBe(true);
		expect(registry.counts().total).toBe(0);
	});

	it("snapshot reflects only currently-tracked resources", async () => {
		const registry = new ResourceRegistry();
		const handle = registry.register("owner", "graph", () => {});

		expect(registry.snapshot()).toEqual([
			expect.objectContaining({ id: handle.id, owner: "owner", type: "graph" }),
		]);

		await registry.disposeOne(handle);

		expect(registry.snapshot()).toEqual([]);
	});

	it("awaits an async disposer before untracking is observable, but the map entry is gone immediately", async () => {
		const registry = new ResourceRegistry();
		let resolveDispose!: () => void;
		const dispose = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					resolveDispose = resolve;
				}),
		);
		const handle = registry.register("owner", "buffer", dispose);

		const disposePromise = registry.disposeOne(handle);
		// Even before the async disposer settles, a concurrent release attempt
		// (e.g. a cancelled load racing an owner teardown) finds nothing.
		await registry.disposeOne(handle);
		expect(dispose).toHaveBeenCalledTimes(1);

		resolveDispose();
		await disposePromise;
	});
});
