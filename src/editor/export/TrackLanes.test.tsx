import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clickAndFlush, fireAndFlush } from "../../testing/events";
import TrackLanes, { type TrackLanesProps } from "./TrackLanes";
import type { TrackLaneView } from "./trackLanes";

const row = (id: string, over: Partial<TrackLaneView> = {}): TrackLaneView => ({
  id,
  name: id.toUpperCase(),
  color: "#33aaff",
  muted: false,
  fixed: false,
  included: true,
  picked: false,
  lanes: [{ startBar: 0, lengthBars: 8 }],
  ...over,
});

const rows = [row("a"), row("b", { included: false }), row("c"), row("d")];
const scrollTo = vi.fn();

beforeEach(() => {
  scrollTo.mockClear();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  Element.prototype.scrollTo = scrollTo as unknown as typeof Element.prototype.scrollTo;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderLanes(props: Partial<TrackLanesProps> = {}) {
  const onRowClick = vi.fn();
  const onPickAction = vi.fn();
  const view = render(() => (
    <TrackLanes
      rows={rows}
      bars={32}
      onRowClick={onRowClick}
      onPickAction={onPickAction}
      {...props}
    />
  ));
  const canvas = view.container.querySelector("canvas") as HTMLCanvasElement;
  return { onRowClick, onPickAction, canvas, container: view.container };
}

describe("TrackLanes", () => {
  it("sends a click on a lane as a click on its name, modifiers included", () => {
    const { canvas, onRowClick } = renderLanes();
    fireAndFlush(() => fireEvent.click(canvas, { clientY: 30 }));
    fireAndFlush(() => fireEvent.click(canvas, { clientY: 55, shiftKey: true }));
    fireAndFlush(() => fireEvent.click(canvas, { clientY: 10, metaKey: true }));
    fireAndFlush(() => fireEvent.click(canvas, { clientY: 500 }));
    expect(onRowClick.mock.calls).toEqual([
      [1, { shift: false, meta: false }],
      [2, { shift: true, meta: false }],
      [0, { shift: false, meta: true }],
    ]);
  });

  it("swaps the status cell for the picked-set actions", () => {
    const picked = rows.map((r, i) => (i < 2 ? { ...r, picked: true } : r));
    const { onPickAction } = renderLanes({ rows: picked });
    expect(screen.getAllByRole("option")).toHaveLength(4);
    expect(screen.getByText("2 picked")).toBeInTheDocument();
    clickAndFlush(screen.getByRole("button", { name: "Only these" }));
    expect(onPickAction).toHaveBeenCalledWith("only");
  });

  it("shows the ZIP brackets beside the rows of each batch", () => {
    const { container } = renderLanes({
      batches: [
        ["a", "b"],
        ["c", "d"],
      ],
    });
    expect(container.querySelectorAll(".batch-bracket")).toHaveLength(2);
  });

  it("is read-only for a stereo mix: MIX, no clicks, no picked-set actions", () => {
    const { canvas, onRowClick } = renderLanes({ readOnly: true });
    expect(screen.getAllByText("MIX")).toHaveLength(4);
    expect(screen.getByText("In the mix")).toBeInTheDocument();
    fireAndFlush(() => fireEvent.click(canvas, { clientY: 30 }));
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("puts a playhead on the printing batch's rows only", () => {
    const { container } = renderLanes({
      batches: [
        ["a", "b"],
        ["c", "d"],
      ],
      doneBatches: [0],
      printing: { batchIndex: 1, fraction: 0.25 },
    });
    const head = container.querySelector<HTMLElement>(".lane-playhead");
    expect(head?.style.left).toBe("25%");
    expect(head?.style.top).toBe("48px");
    expect(head?.style.height).toBe("48px");
  });

  it("scrolls the named row to the top, instantly under reduced motion", () => {
    const view = renderLanes({ scrollToRowId: "c" });
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 48, behavior: "smooth" });
    view.container.remove();
    cleanup();
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    renderLanes({ scrollToRowId: "d" });
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 72, behavior: "auto" });
  });

  it("draws the lanes once it has a width", () => {
    const fillRect = vi.fn();
    const ctx = {
      clearRect: vi.fn(),
      fillRect,
      setTransform: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(320);
    renderLanes();
    expect(fillRect).toHaveBeenCalled();
  });
});
