import { afterEach, describe, expect, it, vi } from "vitest";

// Force the mock backend so createDataService() returns MockDataService
// without touching Firebase.
vi.stubEnv("VITE_MOCK_BACKEND", "true");

afterEach(() => {
	vi.restoreAllMocks();
});

describe("MockDataService.subscribeToProject", () => {
	it("exercises the not-found path for the 'not-found' id", async () => {
		const { createDataService } = await import("./dataService");
		const dataService = createDataService();

		const result = await new Promise((resolve) => {
			dataService.subscribeToProject("not-found", resolve);
		});

		expect(result).toEqual({ project: null, notFound: true });
	});

	it("exercises the genuine-error path for the 'error' id", async () => {
		const { createDataService } = await import("./dataService");
		const dataService = createDataService();

		const result = await new Promise((resolve) => {
			dataService.subscribeToProject("error", resolve);
		});

		expect(result).toEqual({ project: null, notFound: false, error: true });
	});
});

describe("MockDataService.subscribeToUserProjects", () => {
	it("calls back with projects for a normal userId", async () => {
		const { createDataService } = await import("./dataService");
		const dataService = createDataService();

		const projects = await new Promise((resolve) => {
			dataService.subscribeToUserProjects("user-1", resolve);
		});

		expect(Array.isArray(projects)).toBe(true);
		expect((projects as { ownerId: string }[])[0].ownerId).toBe("user-1");
	});

	it("invokes the onError callback for the special 'error' userId", async () => {
		const { createDataService } = await import("./dataService");
		const dataService = createDataService();

		const onProjects = vi.fn();
		const error = await new Promise((resolve) => {
			dataService.subscribeToUserProjects("error", onProjects, resolve);
		});

		expect(error).toBeInstanceOf(Error);
		expect(onProjects).not.toHaveBeenCalled();
	});
});
