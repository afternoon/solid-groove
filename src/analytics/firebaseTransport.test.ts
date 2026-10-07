import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFirebaseAnalyticsTransport } from "./firebaseTransport";

/**
 * The vendor adapter's one piece of GA4 knowledge: the `internal` user
 * property is what the boundary sets, but GA4's Internal Traffic data filter
 * reads the `traffic_type` event parameter, so the transport sends both. As a
 * *default* parameter it rides every later event, automatic collection
 * included.
 */

const setUserProperties = vi.fn((_instance: unknown, _properties: unknown) => {});
const setDefaultEventParameters = vi.fn((_params: unknown) => {});
const logEvent = vi.fn((_instance: unknown, _name: string, _params: unknown) => {});

vi.mock("firebase/analytics", () => ({
  setUserProperties: (instance: unknown, properties: unknown) =>
    setUserProperties(instance, properties),
  setDefaultEventParameters: (params: unknown) => setDefaultEventParameters(params),
  logEvent: (instance: unknown, name: string, params: unknown) =>
    logEvent(instance, name, params),
}));

const instance = {
  kind: "analytics",
} as unknown as import("firebase/analytics").Analytics;

/**
 * Waits for the transport's `ready` chain and its dynamic SDK imports, which
 * take real I/O under Vitest, so a fixed number of microtasks is not enough.
 */
function settled(assertion: () => void) {
  return vi.waitFor(assertion, { timeout: 2_000 });
}

beforeEach(() => {
  setUserProperties.mockClear();
  setDefaultEventParameters.mockClear();
  logEvent.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createFirebaseAnalyticsTransport and internal traffic", () => {
  it("sends traffic_type: internal alongside the internal user property", async () => {
    const transport = createFirebaseAnalyticsTransport({ load: async () => instance });
    transport.setUserProperties({ account_type: "registered", internal: "true" });

    await settled(() =>
      expect(setUserProperties).toHaveBeenCalledWith(instance, {
        account_type: "registered",
        internal: "true",
      }),
    );
    expect(setDefaultEventParameters).toHaveBeenCalledWith({ traffic_type: "internal" });
  });

  it("does the same for properties buffered before the SDK resolved", async () => {
    let resolve: (value: typeof instance) => void = () => {};
    const transport = createFirebaseAnalyticsTransport({
      load: () =>
        new Promise((r) => {
          resolve = r;
        }),
    });
    transport.setUserProperties({ account_type: "registered", internal: "true" });
    expect(setDefaultEventParameters).not.toHaveBeenCalled();

    resolve(instance);

    await settled(() => expect(setUserProperties).toHaveBeenCalledTimes(1));
    expect(setDefaultEventParameters).toHaveBeenCalledWith({ traffic_type: "internal" });
  });

  it("sets no traffic type for a session that is not internal", async () => {
    const transport = createFirebaseAnalyticsTransport({ load: async () => instance });
    transport.setUserProperties({ account_type: "registered", internal: "false" });

    await settled(() => expect(setUserProperties).toHaveBeenCalledTimes(1));
    expect(setDefaultEventParameters).not.toHaveBeenCalled();
  });
});
