import { cleanup, render, screen } from "@solidjs/testing-library";
import { flush } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import type { TrackId } from "../domain/ids";
import LevelMeter from "./LevelMeter";

afterEach(() => cleanup());

function renderMeter(orientation?: "vertical" | "horizontal", levelDb = -30) {
  const frames: (() => void)[] = [];
  render(() => (
    <LevelMeter
      trackId={"trk_a" as TrackId}
      trackLevelDb={() => levelDb}
      isPlaying={() => true}
      requestFrame={(callback) => frames.push(callback)}
      cancelFrame={() => {}}
      orientation={orientation}
    />
  ));
  flush();
  frames.shift()?.();
  flush();
  const meter = screen.getByRole("meter", { name: "Level" });
  return { meter, fill: meter.nextElementSibling as HTMLElement };
}

describe("LevelMeter (#447)", () => {
  it("fills upward beside a mixer fader", () => {
    const { meter, fill } = renderMeter();
    expect(meter.parentElement?.className).toBe("mixer-meter");
    expect(fill.style.height).toBe("50%");
  });

  it("fills along the row in the instrument header", () => {
    const { meter, fill } = renderMeter("horizontal");
    expect(meter.parentElement?.className).toBe("level-meter-horizontal");
    expect(fill.style.width).toBe("50%");
    expect(fill.style.height).toBe("");
  });

  it("shows a clip, in either orientation, only over 0 dBFS", () => {
    for (const orientation of ["vertical", "horizontal"] as const) {
      expect(renderMeter(orientation, 0).meter.parentElement).not.toHaveClass("clipping");
      cleanup();
      const over = renderMeter(orientation, 0.5);
      expect(over.meter.parentElement).toHaveClass("clipping");
      // The bar is full; the colour, not the length, says it is over.
      expect(over.fill.style[orientation === "vertical" ? "height" : "width"]).toBe(
        "100%",
      );
      cleanup();
    }
  });
});
