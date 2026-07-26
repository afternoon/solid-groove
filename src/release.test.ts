import { afterEach, describe, expect, it, vi } from "vitest";
import { RELEASE_SHA, shortReleaseSha } from "./release";

describe("RELEASE_SHA", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.resetModules();
	});

	// Vitest never runs the `app.config.ts` build-time `define`, so under this
	// suite `import.meta.env.VITE_RELEASE_SHA` is genuinely unset by default --
	// exactly the "not stamped" case a broken CI pipeline would also produce.
	it("falls back to the unknown sentinel when nothing was stamped", () => {
		expect(RELEASE_SHA).toBe("unknown");
	});

	it("falls back to the unknown sentinel for a blank/whitespace value", async () => {
		vi.stubEnv("VITE_RELEASE_SHA", "   ");
		vi.resetModules();
		const mod = await import("./release");
		expect(mod.RELEASE_SHA).toBe("unknown");
	});

	it("reads a stamped release SHA verbatim (trimmed)", async () => {
		vi.stubEnv(
			"VITE_RELEASE_SHA",
			"  0123456789abcdef0123456789abcdef01234567  ",
		);
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
