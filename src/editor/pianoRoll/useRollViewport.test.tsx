import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { flush } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import { useRollViewport } from "./useRollViewport";

afterEach(() => cleanup());

/** A bare frame driven by the hook, standing in for the roll. */
function renderFrame(focusRow = 10) {
  let viewport!: ReturnType<typeof useRollViewport>;
  render(() => {
    viewport = useRollViewport({ focusRow: () => focusRow });
    return (
      <div>
        <div data-testid="ruler" ref={viewport.ruler} onScroll={viewport.onRulerScroll} />
        <div
          data-testid="scroller"
          ref={viewport.scroller}
          onScroll={viewport.onScrollerScroll}
        />
        <output data-testid="zoom">{viewport.zoom()}</output>
      </div>
    );
  });
  return viewport;
}

const zoomText = () => screen.getByTestId("zoom").textContent;

describe("roll viewport", () => {
  it("opens with the focus row in the middle", () => {
    renderFrame(10);
    // jsdom has no layout, so the visible height is 0 and the row's centre is
    // the offset itself: 10 rows of 30 px, plus half a row.
    expect(screen.getByTestId("scroller").scrollTop).toBe(315);
  });

  it("zooms in steps of 1.25 and stops at 50% and 200%", () => {
    const viewport = renderFrame();
    viewport.zoomIn();
    flush();
    expect(zoomText()).toBe("1.25");
    for (let press = 0; press < 6; press += 1) viewport.zoomOut();
    flush();
    expect(zoomText()).toBe("0.5");
    for (let press = 0; press < 9; press += 1) viewport.zoomIn();
    flush();
    expect(zoomText()).toBe("2");
  });

  it("zooms on a pinch, which is a wheel with Ctrl held, and scrolls on a plain wheel", () => {
    renderFrame();
    const scroller = screen.getByTestId("scroller");
    const plain = new WheelEvent("wheel", { deltaY: -50, cancelable: true });
    scroller.dispatchEvent(plain);
    flush();
    expect(zoomText()).toBe("1");
    expect(plain.defaultPrevented).toBe(false);

    const pinch = new WheelEvent("wheel", {
      deltaY: -50,
      ctrlKey: true,
      cancelable: true,
    });
    scroller.dispatchEvent(pinch);
    flush();
    expect(Number(zoomText())).toBeGreaterThan(1);
    expect(pinch.defaultPrevented).toBe(true);
  });

  it("keeps the ruler and the grid at the same horizontal offset", () => {
    renderFrame();
    const scroller = screen.getByTestId("scroller");
    const ruler = screen.getByTestId("ruler");
    scroller.scrollLeft = 120;
    fireEvent.scroll(scroller);
    expect(ruler.scrollLeft).toBe(120);
    ruler.scrollLeft = 40;
    fireEvent.scroll(ruler);
    expect(scroller.scrollLeft).toBe(40);
  });
});
