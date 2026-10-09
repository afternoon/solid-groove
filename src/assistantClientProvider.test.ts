import { afterEach, describe, expect, it, vi } from "vitest";

const loadTransport = vi.fn();

vi.mock("./devBackend", () => ({
  isMockBackend: false,
  resolveEmulatorHosts: () => null,
}));
vi.mock("./firebaseConfig", () => ({ app: {} }));
vi.mock("./firebaseAssistantTransport", () => ({
  createFirebaseAssistantTransport: () => loadTransport(),
}));

afterEach(() => {
  vi.resetModules();
  loadTransport.mockReset();
});

describe("getAssistantClient", () => {
  it("reuses one client once it has loaded", async () => {
    loadTransport.mockReturnValue({ start: vi.fn() });
    const { getAssistantClient } = await import("./assistantClientProvider");
    const first = await getAssistantClient();
    expect(await getAssistantClient()).toBe(first);
    expect(loadTransport).toHaveBeenCalledTimes(1);
  });

  it("tries again after a failed load instead of keeping the rejection", async () => {
    loadTransport
      .mockImplementationOnce(() => {
        throw new Error("chunk failed");
      })
      .mockReturnValue({ start: vi.fn() });
    const { getAssistantClient } = await import("./assistantClientProvider");
    await expect(getAssistantClient()).rejects.toThrow("chunk failed");
    await expect(getAssistantClient()).resolves.toBeDefined();
    expect(loadTransport).toHaveBeenCalledTimes(2);
  });
});
