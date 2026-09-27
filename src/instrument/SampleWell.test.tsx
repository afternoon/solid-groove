import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { flush } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RawCommandInput } from "../commands";
import type { AssetId } from "../domain/ids";
import { recordingGesture } from "./panelTesting";
import SampleWell, { peakBars, type WatchPeaks } from "./SampleWell";

afterEach(() => cleanup());

const ASSET = "ast_clap" as AssetId;

function renderWell(options: { assetId?: AssetId | null; watchPeaks?: WatchPeaks } = {}) {
  const applied: RawCommandInput[] = [];
  const { container } = render(() => (
    <SampleWell
      assetId={options.assetId === undefined ? ASSET : options.assetId}
      watchPeaks={options.watchPeaks}
      start={0.2}
      end={0.6}
      readout="20% → 60%"
      commandStart={(value) => ({ edge: "start", value }) as unknown as RawCommandInput}
      commandEnd={(value) => ({ edge: "end", value }) as unknown as RawCommandInput}
      dispatch={() => undefined}
      beginGesture={() => recordingGesture(applied)}
    />
  ));
  const surface = container.querySelector(".drag-surface") as HTMLElement;
  surface.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 100, height: 50, right: 100, bottom: 50 }) as DOMRect;
  const press = (x: number) =>
    fireEvent(
      surface,
      new MouseEvent("pointerdown", { bubbles: true, clientX: x, clientY: 25 }),
    );
  return { container, applied, press };
}

describe("peakBars (#447)", () => {
  it("draws one mirrored bar per peak, only inside the window asked for", () => {
    const peaks = Float32Array.from([1, 0.5, 0.25, 0]);
    expect(peakBars(peaks, 400, 100).match(/M/g)).toHaveLength(4);
    // Bars sit at 12.5%, 37.5%, 62.5% and 87.5%: two of them are in 0.3..0.7.
    expect(peakBars(peaks, 400, 100, 0.3, 0.7)).toBe("M150.0,26.5V73.5M250.0,38.3V61.8");
  });
});

describe("SampleWell (#447)", () => {
  it("draws the waveform the engine decoded, and stops following it on unmount", () => {
    const stop = vi.fn();
    const watch = vi.fn<WatchPeaks>((_id, _buckets, onPeaks) => {
      onPeaks(Float32Array.from([1, 0.5]));
      return stop;
    });
    const { container } = renderWell({ watchPeaks: watch });
    flush();
    expect(watch).toHaveBeenCalledWith(ASSET, expect.any(Number), expect.any(Function));
    expect(
      container.querySelector(".sample-well-bars.playing")?.getAttribute("d"),
    ).not.toBe("");
    expect(screen.queryByText("Loading waveform…")).toBeNull();
    cleanup();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("says so while it waits, and when there is nothing loaded", () => {
    renderWell({ watchPeaks: () => () => {} });
    expect(screen.getByText("Loading waveform…")).toBeInTheDocument();
    cleanup();
    renderWell({ assetId: null });
    expect(screen.getByText("Load a sound to see its waveform")).toBeInTheDocument();
  });

  it("moves whichever marker the press is nearer, never past the other", () => {
    const start = renderWell();
    start.press(30);
    expect(start.applied).toEqual([{ edge: "start", value: 0.3 }]);
    cleanup();

    const end = renderWell();
    end.press(50);
    expect(end.applied).toEqual([{ edge: "end", value: 0.5 }]);
    cleanup();

    // Dragged past the start, the end stops just after it.
    const pinned = renderWell();
    pinned.press(90);
    const surface = pinned.container.querySelector(".drag-surface") as HTMLElement;
    fireEvent(
      surface,
      new MouseEvent("pointermove", { bubbles: true, clientX: 5, clientY: 25 }),
    );
    expect(pinned.applied.at(-1)).toEqual({
      edge: "end",
      value: expect.closeTo(0.21, 5),
    });
  });
});
