import { render } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";
import { ariaBool } from "./aria";

describe("ariaBool", () => {
  it("spells both ARIA states", () => {
    expect(ariaBool(true)).toBe("true");
    expect(ariaBool(false)).toBe("false");
  });

  it('renders aria-pressed="false" rather than dropping the attribute', () => {
    const { container } = render(() => (
      <button type="button" aria-pressed={ariaBool(false)}>
        off
      </button>
    ));

    expect(container.querySelector("button")?.getAttribute("aria-pressed")).toBe("false");
  });

  it('renders aria-pressed="true" rather than an empty attribute', () => {
    const { container } = render(() => (
      <button type="button" aria-pressed={ariaBool(true)}>
        on
      </button>
    ));

    expect(container.querySelector("button")?.getAttribute("aria-pressed")).toBe("true");
  });

  // The reason this helper exists, pinned so we find out if Solid changes it.
  // A raw boolean is a *type* error, which is what normally stops it reaching
  // a browser -- but the runtime behaviour behind that type is what makes the
  // helper necessary rather than merely tidy, and it is invisible from the
  // call sites. `false` removing the attribute entirely is the costly half:
  // an unpressed toggle stops being a toggle to a screen reader.
  it("pins the Solid 2 behaviour this helper exists to avoid", () => {
    const { container } = render(() => (
      <>
        <button type="button" data-case="raw-false" aria-pressed={false as never} />
        <button type="button" data-case="raw-true" aria-pressed={true as never} />
      </>
    ));
    const attr = (which: string) =>
      container.querySelector(`[data-case="${which}"]`)?.getAttribute("aria-pressed");

    expect(attr("raw-false")).toBeNull();
    expect(attr("raw-true")).toBe("");
  });
});
