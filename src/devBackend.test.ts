import { describe, expect, it } from "vitest";
import {
  DEFAULT_AUTH_EMULATOR_HOST,
  DEFAULT_FIRESTORE_EMULATOR_HOST,
  EMULATOR_PROJECT_ID,
  placeholderFirebaseConfig,
  resolveDevBackend,
  resolveEmulatorHosts,
} from "./devBackend";

describe("resolveDevBackend", () => {
  it("accepts each documented mode", () => {
    expect(resolveDevBackend("mock")).toBe("mock");
    expect(resolveDevBackend("emulator")).toBe("emulator");
    expect(resolveDevBackend("project")).toBe("project");
  });

  it("defaults to the real project when unset or empty", () => {
    // Unset must not mean `mock`: a build with no env configured is a
    // deployment, and silently redirecting it at an in-memory fake would
    // serve an app that loses every user's work on reload.
    expect(resolveDevBackend(undefined)).toBe("project");
    expect(resolveDevBackend("")).toBe("project");
  });

  it("throws on an unrecognized value rather than falling back", () => {
    // The failure this prevents: `VITE_DEV_BACKEND=mocks` silently running
    // against whatever real credentials happen to be in `.env`.
    expect(() => resolveDevBackend("mocks")).toThrow(/VITE_DEV_BACKEND/);
    expect(() => resolveDevBackend("true")).toThrow(/got "true"/);
  });
});

describe("placeholderFirebaseConfig", () => {
  it("gives emulator mode the same project ID the emulator runs under", () => {
    // The regression this pins, found by driving the app by hand: with a
    // generic placeholder the app wrote to `projects/mock-project/…` while
    // `bun run firebase:emulator`, both emulator suites, and every documented
    // inspection command look under `demo-solid-groove`. Persistence worked
    // and appeared not to, because the data was in a parallel tree.
    expect(placeholderFirebaseConfig("emulator")?.projectId).toBe(EMULATOR_PROJECT_ID);
  });

  it("keeps mock mode on its own project ID", () => {
    expect(placeholderFirebaseConfig("mock")?.projectId).toBe("mock-project");
  });

  it("substitutes nothing for a real project", () => {
    // A real deployment must fail loudly on missing config rather than
    // silently initialize against a fabricated project.
    expect(placeholderFirebaseConfig("project")).toBeNull();
  });
});

describe("resolveEmulatorHosts", () => {
  it("implies the firebase.json defaults in emulator mode", () => {
    // This is what lets `bun run dev:emulator` be one flag rather than five.
    expect(resolveEmulatorHosts({}, "emulator")).toEqual({
      firestore: DEFAULT_FIRESTORE_EMULATOR_HOST,
      auth: DEFAULT_AUTH_EMULATOR_HOST,
    });
  });

  it("connects to nothing in mock or project mode", () => {
    expect(resolveEmulatorHosts({}, "mock")).toBeNull();
    expect(resolveEmulatorHosts({}, "project")).toBeNull();
  });

  it("lets an explicit host override the default", () => {
    // `playwright.emulator.config.ts` depends on this: `emulators:exec`
    // chooses the real ports at runtime and passes them through.
    expect(
      resolveEmulatorHosts(
        { VITE_FIRESTORE_EMULATOR_HOST: "127.0.0.1:9999" },
        "emulator",
      ),
    ).toEqual({
      firestore: "127.0.0.1:9999",
      auth: DEFAULT_AUTH_EMULATOR_HOST,
    });
  });

  it("still honors an explicit host when the mode was not set", () => {
    // Backwards compatibility for a setup that sets only the hosts.
    expect(
      resolveEmulatorHosts({ VITE_AUTH_EMULATOR_HOST: "127.0.0.1:9099" }, "project"),
    ).toEqual({
      firestore: DEFAULT_FIRESTORE_EMULATOR_HOST,
      auth: "127.0.0.1:9099",
    });
  });
});
