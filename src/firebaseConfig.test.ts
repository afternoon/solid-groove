import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PRD `OPS-02`: "a user-facing opt-out disables collection."
 *
 * Google Analytics collects on two channels. Custom events go through the
 * transport behind the analytics boundary; `page_view`, `session_start`,
 * `first_visit`, `user_engagement` and the `_ga` cookies come from gtag's
 * automatic collection, which starts the moment `getAnalytics(app)` runs and
 * ignores which transport the boundary happens to hold. So the opt-out has to
 * reach the SDK, not just the transport — these tests pin that, at the SDK
 * call level rather than at the transport swap.
 *
 * `firebaseConfig` is imported for `auth` and `db` on every app load, so the
 * decisive property is that merely importing it collects nothing.
 */

const getAnalytics = vi.fn((_app: unknown) => ({ kind: "analytics" }));
const isSupported = vi.fn(async () => true);
const setAnalyticsCollectionEnabled = vi.fn(
  (_instance: unknown, _enabled: boolean) => {},
);

vi.mock("firebase/app", () => ({ initializeApp: () => ({}) }));
vi.mock("firebase/auth", () => ({ getAuth: () => ({}) }));
vi.mock("firebase/firestore", () => ({ getFirestore: () => ({}) }));
vi.mock("firebase/analytics", () => ({
  getAnalytics: (app: unknown) => getAnalytics(app),
  isSupported: () => isSupported(),
  setAnalyticsCollectionEnabled: (instance: unknown, enabled: boolean) =>
    setAnalyticsCollectionEnabled(instance, enabled),
}));

/** A fresh module instance, so one test's memoized SDK is not the next's. */
async function loadModule() {
  vi.resetModules();
  return await import("./firebaseConfig");
}

beforeEach(() => {
  vi.stubEnv("VITE_FIREBASE_MEASUREMENT_ID", "G-TEST");
  getAnalytics.mockClear();
  isSupported.mockClear();
  setAnalyticsCollectionEnabled.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Google Analytics initialization is deferred until consent allows it", () => {
  it("does not initialize the SDK when the module is imported", async () => {
    await loadModule();
    await Promise.resolve();

    expect(getAnalytics).not.toHaveBeenCalled();
  });

  it("initializes it when loadAnalytics is called", async () => {
    const config = await loadModule();

    await expect(config.loadAnalytics()).resolves.not.toBeNull();
    expect(getAnalytics).toHaveBeenCalledTimes(1);
  });

  it("initializes it at most once", async () => {
    const config = await loadModule();

    await config.loadAnalytics();
    await config.loadAnalytics();

    expect(getAnalytics).toHaveBeenCalledTimes(1);
  });

  it("resolves to null without an SDK when there is no measurementId", async () => {
    vi.stubEnv("VITE_FIREBASE_MEASUREMENT_ID", "");
    const config = await loadModule();

    await expect(config.loadAnalytics()).resolves.toBeNull();
    expect(getAnalytics).not.toHaveBeenCalled();
  });
});

describe("setAnalyticsCollection applies a consent decision to the SDK", () => {
  it("does not bootstrap gtag just to switch collection off", async () => {
    // The opted-out path. Initializing in order to disable would perform the
    // exact automatic collection the opt-out exists to prevent.
    const config = await loadModule();

    await config.setAnalyticsCollection(false);

    expect(getAnalytics).not.toHaveBeenCalled();
    expect(setAnalyticsCollectionEnabled).not.toHaveBeenCalled();
  });

  it("disables collection on an SDK that is already running", async () => {
    const config = await loadModule();
    const instance = await config.loadAnalytics();

    await config.setAnalyticsCollection(false);

    expect(setAnalyticsCollectionEnabled).toHaveBeenCalledWith(instance, false);
  });

  it("re-enables collection when the user opts back in", async () => {
    const config = await loadModule();
    const instance = await config.loadAnalytics();

    await config.setAnalyticsCollection(false);
    await config.setAnalyticsCollection(true);

    expect(setAnalyticsCollectionEnabled).toHaveBeenLastCalledWith(instance, true);
  });

  it("never throws, so a consent change cannot break the app", async () => {
    isSupported.mockRejectedValueOnce(new Error("blocked"));
    const config = await loadModule();

    await expect(config.setAnalyticsCollection(true)).resolves.toBeUndefined();
  });
});
