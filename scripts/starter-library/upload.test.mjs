import { describe, expect, it, vi } from "vitest";
import { PACK_INDEX_KEY, packManifestStorageKey, packPointerKey } from "./manifest.mjs";
import {
  CACHE_CONTROL,
  corsAllowsOrigin,
  corsConfigFor,
  normalizeEmulatorEnv,
  parseArgs,
  projectIdFromBucket,
  resolveBucketName,
  STORAGE_PREFIX,
  withRetry,
} from "./upload.mjs";

// These cover everything up to the network. The upload itself is exercised
// against the Firebase Storage emulator — see docs/sample-library.md section 15
// for the command — because asserting on a mocked bucket would only prove the
// mock matches the mock.

describe("parseArgs", () => {
  it("defaults to a safe, non-mutating plan", () => {
    expect(parseArgs([])).toEqual({
      dryRun: false,
      configureBucket: false,
      bucket: null,
      force: false,
    });
  });

  it("reads the flags it documents", () => {
    expect(
      parseArgs(["--dry-run", "--configure-bucket", "--force", "--bucket", "b"]),
    ).toEqual({
      dryRun: true,
      configureBucket: true,
      force: true,
      bucket: "b",
    });
  });

  it("rejects an unknown flag instead of silently ignoring it", () => {
    expect(() => parseArgs(["--upload-everything"])).toThrow(/unknown flag/);
  });
});

describe("bucket resolution", () => {
  it("prefers the explicit bucket and strips the gs:// form", () => {
    expect(resolveBucketName("gs://my-project.firebasestorage.app/")).toBe(
      "my-project.firebasestorage.app",
    );
  });

  it("falls back to the environment", () => {
    vi.stubEnv("FIREBASE_STORAGE_BUCKET", "from-env.appspot.com");
    expect(resolveBucketName(null)).toBe("from-env.appspot.com");
    vi.unstubAllEnvs();
  });

  it("fails with an actionable message when nothing is configured", () => {
    vi.stubEnv("FIREBASE_STORAGE_BUCKET", "");
    vi.stubEnv("VITE_FIREBASE_STORAGE_BUCKET", "");
    expect(() => resolveBucketName(null)).toThrow(/no storage bucket configured/);
    vi.unstubAllEnvs();
  });

  it("derives the project id from either bucket naming scheme", () => {
    expect(projectIdFromBucket("solid-groove.firebasestorage.app")).toBe("solid-groove");
    expect(projectIdFromBucket("solid-groove.appspot.com")).toBe("solid-groove");
  });
});

describe("CORS configuration", () => {
  // Section 12: "Cross-origin headers must allow Web Audio decoding and
  // offline export in every supported browser."
  it("reads the checked-in policy with no placeholder left in it", () => {
    const [rule] = corsConfigFor("solid-groove");
    expect(JSON.stringify(rule)).not.toContain("{{PROJECT_ID}}");
    expect(rule.method).toEqual(["GET", "HEAD"]);
    // Range support is what lets a long ambience stream rather than being
    // fully downloaded before it can be auditioned.
    expect(rule.responseHeader).toContain("Range");
    expect(rule.responseHeader).toContain("Accept-Ranges");
  });

  it("admits every origin the app is served from", () => {
    const rules = corsConfigFor("solid-groove");
    for (const origin of [
      "https://solid-groove.web.app",
      "https://solid-groove.firebaseapp.com",
      "http://localhost:3000",
      "http://127.0.0.1:3000",
    ]) {
      expect(corsAllowsOrigin(rules, origin)).toBe(true);
      expect(corsAllowsOrigin(rules, origin, "HEAD")).toBe(true);
    }
  });

  // Issue #259: a preview channel's subdomain carries a hash minted at deploy
  // time, so it cannot be named ahead of time and Cloud Storage matches an
  // origin exactly. A policy that only lists the app's own origins answers the
  // preview's pack-index fetch without an `Access-Control-Allow-Origin` header,
  // the browser drops the 200, and the library browser reports a load failure.
  it("admits a Hosting preview channel, whose subdomain cannot be enumerated", () => {
    const rules = corsConfigFor("solid-groove");
    expect(corsAllowsOrigin(rules, "https://solid-groove--pr-246-4wgdvx7q.web.app")).toBe(
      true,
    );
  });

  it("matches an origin exactly, never by subdomain pattern", () => {
    // The rule Cloud Storage applies, pinned so a future policy that swaps
    // the wildcard for a list cannot quietly assume patterns work.
    const named = [{ origin: ["https://solid-groove.web.app"], method: ["GET"] }];
    expect(corsAllowsOrigin(named, "https://solid-groove.web.app")).toBe(true);
    expect(corsAllowsOrigin(named, "https://solid-groove--pr-1-abc.web.app")).toBe(false);
    expect(corsAllowsOrigin(named, "https://solid-groove.web.app", "PUT")).toBe(false);
  });

  it("strips the documentation comment the API would reject", () => {
    for (const rule of corsConfigFor("solid-groove")) {
      expect(rule).not.toHaveProperty("_comment");
    }
  });

  it("never grants a write method from the browser", () => {
    for (const rule of corsConfigFor("solid-groove")) {
      expect(rule.method).not.toContain("PUT");
      expect(rule.method).not.toContain("POST");
      expect(rule.method).not.toContain("DELETE");
    }
  });
});

describe("emulator environment", () => {
  it("derives STORAGE_EMULATOR_HOST, adding the scheme the client needs", () => {
    const env = { FIREBASE_STORAGE_EMULATOR_HOST: "127.0.0.1:9199" };
    expect(normalizeEmulatorEnv(env).STORAGE_EMULATOR_HOST).toBe("http://127.0.0.1:9199");
  });

  it("leaves an explicit value and a non-emulator environment alone", () => {
    expect(
      normalizeEmulatorEnv({
        FIREBASE_STORAGE_EMULATOR_HOST: "127.0.0.1:9199",
        STORAGE_EMULATOR_HOST: "http://elsewhere:1234",
      }).STORAGE_EMULATOR_HOST,
    ).toBe("http://elsewhere:1234");
    expect(normalizeEmulatorEnv({}).STORAGE_EMULATOR_HOST).toBeUndefined();
  });
});

describe("withRetry", () => {
  const noSleep = { sleep: () => Promise.resolve(), delays: [1, 1] };

  it("returns the first successful result without retrying", async () => {
    const operation = vi.fn().mockResolvedValue("ok");
    await expect(withRetry(operation, noSleep)).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("retries a dropped socket", async () => {
    const reset = Object.assign(new Error("socket hang up"), {
      code: "ECONNRESET",
    });
    const operation = vi.fn().mockRejectedValueOnce(reset).mockResolvedValue("ok");
    await expect(withRetry(operation, noSleep)).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("retries a throttled or failing server", async () => {
    const throttled = Object.assign(new Error("rate limited"), { code: 429 });
    const operation = vi.fn().mockRejectedValueOnce(throttled).mockResolvedValue("ok");
    await expect(withRetry(operation, noSleep)).resolves.toBe("ok");
  });

  // Retrying a rejected credential just delays a failure that will not fix
  // itself, and hides the real cause behind a timeout.
  it("does not retry a permission error", async () => {
    const denied = Object.assign(new Error("permission denied"), { code: 403 });
    const operation = vi.fn().mockRejectedValue(denied);
    await expect(withRetry(operation, noSleep)).rejects.toThrow(/permission denied/);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("gives up and surfaces the error after exhausting its attempts", async () => {
    const reset = Object.assign(new Error("socket hang up"), {
      code: "ECONNRESET",
    });
    const operation = vi.fn().mockRejectedValue(reset);
    await expect(withRetry(operation, noSleep)).rejects.toThrow(/socket hang up/);
    expect(operation).toHaveBeenCalledTimes(3);
  });
});

describe("delivery layout", () => {
  it("publishes everything under one prefix, with a pack dimension (section 15.8)", () => {
    expect(STORAGE_PREFIX).toBe("library");
    expect(packManifestStorageKey("techno-drums", 3)).toBe("packs/techno-drums/v3.json");
    expect(packPointerKey("techno-drums")).toBe("packs/techno-drums/latest.json");
    expect(PACK_INDEX_KEY).toBe("packs/index.json");
  });

  // Content-addressed and versioned objects can be cached forever; the pointer
  // is the only thing that has to change to publish a new library version.
  it("caches immutable objects hard and the pointer briefly", () => {
    expect(CACHE_CONTROL.immutable).toBe("public, max-age=31536000, immutable");
    expect(CACHE_CONTROL.pointer).toBe("public, max-age=60");
  });
});
