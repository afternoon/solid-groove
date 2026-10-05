import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prefersReducedMotion, scrollBehavior } from "./motion";

/** Stub `matchMedia` to answer the reduced-motion query with `reduce`. */
function stubMotion(reduce: boolean | undefined): void {
  vi.stubGlobal(
    "matchMedia",
    reduce === undefined
      ? undefined
      : (query: string) => ({
          matches: reduce && query === "(prefers-reduced-motion: reduce)",
        }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("reduced motion (#76)", () => {
  it("scrolls smoothly unless the user asked for less motion", () => {
    stubMotion(false);
    expect(prefersReducedMotion()).toBe(false);
    expect(scrollBehavior()).toBe("smooth");
    stubMotion(true);
    expect(prefersReducedMotion()).toBe(true);
    expect(scrollBehavior()).toBe("auto");
  });

  it("assumes motion is fine where it cannot ask", () => {
    stubMotion(undefined);
    expect(prefersReducedMotion()).toBe(false);
  });
});

describe("the base layer's reduced-motion rule (#76)", () => {
  // Read from disk: the unit suite stubs CSS imports out.
  const appCss = readFileSync(resolve(process.cwd(), "src/app.css"), "utf8");
  const block = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/.exec(
    appCss,
  )?.[1];

  it("stops every element's animations and transitions, whatever its own stylesheet says", () => {
    expect(block).toBeDefined();
    expect(block).toMatch(/^\s*\*,\s*\*::before,\s*\*::after\s*\{/);
    for (const property of ["animation-duration", "transition-duration"]) {
      expect(block).toMatch(new RegExp(`${property}: [^;]*!important`));
    }
    expect(block).toMatch(/animation-iteration-count: 1 !important/);
  });
});
