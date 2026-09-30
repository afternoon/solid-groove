import { render } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";
import MiniWaveform, { waveformPath } from "./MiniWaveform";

const PEAKS = Array.from({ length: 48 }, (_, i) => Math.round((i / 47) * 255));

describe("MiniWaveform", () => {
  it("draws a mirrored path for peaks, hidden from assistive technology", () => {
    const { container } = render(() => <MiniWaveform peaks={PEAKS} />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    const d = container.querySelector("path")?.getAttribute("d") ?? "";
    expect(d).toBe(waveformPath(PEAKS));
    // 48 points along the top and 48 back along the bottom.
    expect(d.match(/,/g)?.length).toBe(96);
    expect(svg?.classList.contains("mini-waveform-flat")).toBe(false);
  });

  it("mirrors about the centre line and grows with the peak", () => {
    // A quiet bin hugs the centre (y=10); a full bin reaches near the edges.
    expect(waveformPath([0, 255])).toBe("M0.0,9.53 L100.0,0.50 L100.0,19.50 L0.0,10.47Z");
  });

  it("draws a neutral flat bar when there are no peaks", () => {
    const { container } = render(() => <MiniWaveform peaks={null} />);
    expect(container.querySelector("svg")?.classList.contains("mini-waveform-flat")).toBe(
      true,
    );
    const d = container.querySelector("path")?.getAttribute("d") ?? "";
    expect(d).toBe(waveformPath(new Array<number>(48).fill(0)));
  });

  it("renders nothing interactive", () => {
    const { container } = render(() => <MiniWaveform peaks={PEAKS} />);
    expect(
      container.querySelectorAll("button, a, input, [tabindex], [role]").length,
    ).toBe(0);
  });
});
