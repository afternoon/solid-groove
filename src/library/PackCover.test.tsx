import { cleanup, render } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import type { LibraryAsset } from "./manifest";
import PackCover from "./PackCover";

afterEach(cleanup);

const stripes = (container: HTMLElement) =>
  [...container.querySelectorAll("path")].map((path) => path.getAttribute("d"));

describe("PackCover", () => {
  it("is initials over three waveform stripes, hidden from assistive technology", () => {
    const { container } = render(() => (
      <PackCover name="Core Electronic Drums" assets={null} />
    ));

    expect(container.querySelector(".pack-cover")).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector(".pack-cover-initials")).toHaveTextContent("CE");
    expect(stripes(container)).toHaveLength(3);
    expect(container.querySelector("img")).toBeNull();
  });

  it("draws a pack's own peaks when its sounds carry them", () => {
    const peaks = Array.from({ length: 48 }, (_, i) => (i % 2 === 0 ? 255 : 10));
    const asset = { peaks } as unknown as LibraryAsset;
    const withPeaks = render(() => <PackCover name="Deep" assets={[asset]} />);
    const without = render(() => <PackCover name="Deep" assets={null} />);

    expect(stripes(withPeaks.container)[0]).not.toEqual(stripes(without.container)[0]);
  });
});
