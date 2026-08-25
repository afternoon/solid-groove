import { afterEach, describe, expect, it, vi } from "vitest";
import { RELEASE_SHA, shortReleaseSha } from "./release";

describe("RELEASE_SHA", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  // Vitest never runs the `app.config.ts` build-time `define`, and
  // `vitest.config.ts` additionally pins `VITE_RELEASE_SHA` empty so a
  // populated `.env` cannot stamp one either -- exactly the "not stamped" case
  // a broken CI pipeline would also produce. Stubbing it unset and
  // re-importing states that premise rather than trusting the ambient
  // environment: `RELEASE_SHA` is a module-level const, frozen at import,
  // so a stub in a test body cannot reach the value imported at the top.
  it("falls back to the unknown sentinel when nothing was stamped", async () => {
    vi.stubEnv("VITE_RELEASE_SHA", "");
    vi.resetModules();
    const mod = await import("./release");
    expect(mod.RELEASE_SHA).toBe("unknown");
  });

  it("falls back to the unknown sentinel for a blank/whitespace value", async () => {
    vi.stubEnv("VITE_RELEASE_SHA", "   ");
    vi.resetModules();
    const mod = await import("./release");
    expect(mod.RELEASE_SHA).toBe("unknown");
  });

  it("reads a stamped release SHA verbatim (trimmed)", async () => {
    vi.stubEnv("VITE_RELEASE_SHA", "  0123456789abcdef0123456789abcdef01234567  ");
    vi.resetModules();
    const mod = await import("./release");
    expect(mod.RELEASE_SHA).toBe("0123456789abcdef0123456789abcdef01234567");
  });
});

describe("shortReleaseSha", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("truncates a full SHA to a display-friendly length", () => {
    expect(shortReleaseSha("0123456789abcdef0123456789abcdef01234567")).toBe(
      "0123456789ab",
    );
  });

  it("passes a short SHA through unchanged", () => {
    expect(shortReleaseSha("abc123")).toBe("abc123");
  });

  it("passes the unknown sentinel through unchanged rather than truncating it", () => {
    expect(shortReleaseSha("unknown")).toBe("unknown");
  });

  it("defaults to the module-level RELEASE_SHA when called with no argument", () => {
    expect(shortReleaseSha()).toBe(RELEASE_SHA);
  });
});
