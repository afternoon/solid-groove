import { cleanup, render } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { RELEASE_SHA } from "../release";
import ReleaseBadge from "./ReleaseBadge";

afterEach(() => {
	cleanup();
});

describe("ReleaseBadge", () => {
	it("carries the full release SHA as a data attribute for tooling to read", () => {
		const { container } = render(() => <ReleaseBadge />);
		const badge = container.querySelector("[data-release-sha]");
		expect(badge).not.toBeNull();
		expect(badge?.getAttribute("data-release-sha")).toBe(RELEASE_SHA);
	});

	it("displays a truncated form rather than the raw full SHA", () => {
		const { container } = render(() => <ReleaseBadge />);
		const badge = container.querySelector("[data-release-sha]");
		expect(badge?.textContent).toBe("unknown");
		expect(badge?.textContent?.length).toBeLessThanOrEqual(RELEASE_SHA.length);
	});
});
