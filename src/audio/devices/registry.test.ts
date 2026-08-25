import { beforeAll, describe, expect, it } from "vitest";
import { deviceTypes } from "../../domain/devices";
import type { Device } from "../../domain/entities";
import type { DeviceId } from "../../domain/ids";
import { installWebAudioGlobals } from "../testAudioContext";

// Must run before Tone is imported — see AudioRuntime.test.ts for why.
installWebAudioGlobals();

let registry: typeof import("./index");

beforeAll(async () => {
  registry = await import("./index");
});

const context = { scope: null as never, tempo: () => 120 };

describe("device core registry (FX-01)", () => {
  it("has real DSP behind every registered device type", () => {
    // The domain registry and the audio registry must not drift: a type the
    // user can add from the palette but that silently renders as a
    // passthrough would look like a working device that does nothing.
    for (const definition of deviceTypes()) {
      expect(registry.hasDeviceCore(definition.type)).toBe(true);
    }
  });

  /**
   * Deliberately does *not* construct the nodes.
   *
   * Building the six real cores here — the reverb in particular, which
   * generates an impulse response against whatever context it is constructed
   * in — is both slow (~80 s against the live context) and, worse, it
   * disturbs the shared global context for every test that runs after it in
   * the same worker. Adding that here took these suites from green to failing
   * 9 runs in 10, with timeouts landing on unrelated tests.
   *
   * Each core's behavior is covered by its own suite, inside an offline
   * render. What is left for the registry to prove is only the *mapping*, so
   * that is all this asserts.
   */
  it("maps every registered device type to a distinct core", () => {
    const factory = registry.createDeviceNodeFactory(context);
    expect(typeof factory).toBe("function");
    const types = deviceTypes().map((d) => d.type);
    expect(types.length).toBeGreaterThan(0);
    expect(types.every((type) => registry.hasDeviceCore(type))).toBe(true);
    // And nothing beyond them: an entry with no matching device type would
    // be dead code that no palette can reach.
    expect(registry.registeredDeviceCoreTypes().slice().sort()).toEqual(
      types.slice().sort(),
    );
  });

  it("leaves an unregistered type to the chain's passthrough fallback", () => {
    const factory = registry.createDeviceNodeFactory(context);
    const unknown: Device = {
      id: "dev_unknown" as DeviceId,
      type: "bitcrusher",
      order: 0,
      bypassed: false,
      parameters: {},
      preset: null,
    };
    // `undefined` is the contract for "no DSP behind this type"; the chain
    // substitutes an inert passthrough so a project saved by a later build
    // still loads and plays the rest of its chain.
    expect(factory(unknown)).toBeUndefined();
    expect(registry.hasDeviceCore("bitcrusher")).toBe(false);
  });
});
