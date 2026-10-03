import { describe, expect, it } from "vitest";
import { hostileStorage, memoryStorage } from "../testing/storage";
import {
  CAPABILITY_IDS,
  CAPABILITY_SEVERITY,
  type CapabilityHost,
  detectCapabilities,
  FULLY_CAPABLE,
  webAudioAvailable,
} from "./capabilities";

class FakeAudioContext {
  decodeAudioData(): void {}
}

/** A host with every capability Groove probes for. */
function capableHost(overrides: Partial<Record<keyof CapabilityHost, unknown>> = {}) {
  return {
    AudioContext: FakeAudioContext,
    OfflineAudioContext: class {},
    localStorage: memoryStorage(),
    indexedDB: {},
    URL: { createObjectURL: () => "blob:" },
    HTMLAnchorElement: { prototype: { download: "" } },
    document: { createElement: () => ({ getContext: () => ({}) }) },
    ...overrides,
  } as CapabilityHost;
}

describe("detectCapabilities", () => {
  it("finds nothing missing in a fully capable browser", () => {
    expect(detectCapabilities(capableHost())).toEqual(FULLY_CAPABLE);
  });

  it("reports every capability missing from a bare host, in notice order", () => {
    expect(detectCapabilities({}).missing).toEqual([...CAPABILITY_IDS]);
  });

  it("puts the two that stop sound first, and only those are required", () => {
    expect(CAPABILITY_IDS.filter((id) => CAPABILITY_SEVERITY[id] === "required")).toEqual(
      ["web_audio", "audio_decoding"],
    );
  });

  it("accepts the WebKit-prefixed audio constructors", () => {
    const report = detectCapabilities(
      capableHost({
        AudioContext: undefined,
        OfflineAudioContext: undefined,
        webkitAudioContext: FakeAudioContext,
        webkitOfflineAudioContext: class {},
      }),
    );
    expect(report.missing).toEqual([]);
  });

  it("finds no Web Audio, and so no decoding, without an AudioContext", () => {
    const host = capableHost({ AudioContext: undefined });
    expect(detectCapabilities(host).missing).toEqual(["web_audio", "audio_decoding"]);
    expect(webAudioAvailable(host)).toBe(false);
  });

  it("finds no decoding on a context without decodeAudioData", () => {
    const report = detectCapabilities(capableHost({ AudioContext: class {} }));
    expect(report.missing).toEqual(["audio_decoding"]);
  });

  it("finds no offline audio without an OfflineAudioContext", () => {
    const report = detectCapabilities(capableHost({ OfflineAudioContext: undefined }));
    expect(report.missing).toEqual(["offline_audio"]);
  });

  it("treats storage that throws on use as blocked site data", () => {
    const report = detectCapabilities(capableHost({ localStorage: hostileStorage() }));
    expect(report.missing).toEqual(["site_storage"]);
  });

  it("treats a localStorage getter that throws as blocked site data", () => {
    const host = capableHost();
    Object.defineProperty(host, "localStorage", {
      get() {
        throw new DOMException("denied", "SecurityError");
      },
    });
    expect(detectCapabilities(host).missing).toEqual(["site_storage"]);
  });

  it("needs IndexedDB as well, where the signed-in session lives", () => {
    const report = detectCapabilities(capableHost({ indexedDB: undefined }));
    expect(report.missing).toEqual(["site_storage"]);
  });

  it("leaves no probe value behind in storage", () => {
    const storage = memoryStorage();
    detectCapabilities(capableHost({ localStorage: storage }));
    expect(storage.length).toBe(0);
  });

  it("finds no canvas when a 2D context is refused", () => {
    const report = detectCapabilities(
      capableHost({ document: { createElement: () => ({ getContext: () => null }) } }),
    );
    expect(report.missing).toEqual(["canvas_2d"]);
  });

  it("finds no downloads without object URLs or the download attribute", () => {
    expect(detectCapabilities(capableHost({ URL: {} })).missing).toEqual([
      "file_download",
    ]);
    expect(
      detectCapabilities(capableHost({ HTMLAnchorElement: { prototype: {} } })).missing,
    ).toEqual(["file_download"]);
  });

  it("never reads the user agent", () => {
    const host = capableHost();
    Object.defineProperty(host, "navigator", {
      get() {
        throw new Error("capability detection must not read navigator");
      },
    });
    expect(() => detectCapabilities(host)).not.toThrow();
  });
});
