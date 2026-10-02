import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("getFavouritesRepository", () => {
  it("hands the mock backend one shared in-memory store", async () => {
    vi.stubEnv("VITE_DEV_BACKEND", "mock");
    const { getFavouritesRepository } = await import("./favouritesRepositoryClient");
    const { InMemoryFavouritesRepository } = await import(
      "./persistence/inMemoryFavouritesRepository"
    );

    const first = await getFavouritesRepository();
    expect(first).toBeInstanceOf(InMemoryFavouritesRepository);
    expect(await getFavouritesRepository()).toBe(first);
  });
});
