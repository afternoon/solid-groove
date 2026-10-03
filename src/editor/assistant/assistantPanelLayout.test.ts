import { describe, expect, it } from "vitest";
import { hostileStorage, memoryStorage } from "../../testing/storage";
import {
  type AssistantPanelLayout,
  close,
  DEFAULT_LAYOUT,
  DOCKED_WIDTH,
  dismiss,
  dock,
  FLOATING_HEIGHT,
  float,
  floatingRoom,
  LAYOUT_STORAGE_KEY,
  loadLayout,
  minimise,
  parseLayout,
  RESIZE_STEP,
  RESIZE_STEP_LARGE,
  resetSize,
  resizable,
  resizeBy,
  rightClearance,
  saveLayout,
  serializeLayout,
  setSize,
  toggle,
} from "./assistantPanelLayout";

const floating: AssistantPanelLayout = { ...DEFAULT_LAYOUT, mode: "floating" };
const docked = dock(DEFAULT_LAYOUT);

describe("the panel's homes", () => {
  it("starts closed, and opens floating at 560 by 384", () => {
    expect(DEFAULT_LAYOUT.mode).toBe("closed");
    expect(toggle(DEFAULT_LAYOUT)).toEqual({
      mode: "floating",
      home: "floating",
      height: 560,
      width: 384,
    });
  });

  it("closes from any open mode, and reopens where it was last at home", () => {
    expect(toggle(floating).mode).toBe("closed");
    expect(toggle(minimise(floating)).mode).toBe("closed");
    expect(toggle(docked).mode).toBe("closed");
    expect(toggle(toggle(docked)).mode).toBe("docked");
    expect(toggle(close(float(docked))).mode).toBe("floating");
  });

  it("minimises only a floating panel, and the bar floats again", () => {
    expect(minimise(floating).mode).toBe("minimised");
    expect(minimise(docked)).toBe(docked);
    expect(float(minimise(floating)).mode).toBe("floating");
  });

  it("minimises a floating panel on Escape and closes a docked one", () => {
    expect(dismiss(floating)?.mode).toBe("minimised");
    expect(dismiss(docked)?.mode).toBe("closed");
    expect(dismiss(minimise(floating))).toBeUndefined();
    expect(dismiss(DEFAULT_LAYOUT)).toBeUndefined();
  });

  it("keeps both sizes across every move between homes", () => {
    const sized = setSize(dock(setSize(floating, 700)), 500);
    expect(float(sized)).toMatchObject({ height: 700, width: 500 });
    expect(dock(close(float(sized)))).toMatchObject({ height: 700, width: 500 });
  });
});

describe("resizing", () => {
  it("sets the floating height and the docked width within their limits", () => {
    expect(setSize(floating, 600).height).toBe(600);
    expect(setSize(floating, 10).height).toBe(FLOATING_HEIGHT.min);
    expect(setSize(floating, 9000).height).toBe(FLOATING_HEIGHT.max);
    expect(setSize(docked, 450).width).toBe(450);
    expect(setSize(docked, 10).width).toBe(DOCKED_WIDTH.min);
    expect(setSize(docked, 9000).width).toBe(DOCKED_WIDTH.max);
    // The other size is untouched.
    expect(setSize(floating, 600).width).toBe(DEFAULT_LAYOUT.width);
  });

  it("steps by 16px, or 64px, and stops at the limits", () => {
    expect(resizeBy(floating, RESIZE_STEP).height).toBe(576);
    expect(resizeBy(floating, -RESIZE_STEP_LARGE).height).toBe(496);
    expect(resizeBy(docked, RESIZE_STEP).width).toBe(400);
    expect(resizeBy(setSize(docked, 630), RESIZE_STEP_LARGE).width).toBe(640);
    expect(resizeBy(setSize(floating, 270), -RESIZE_STEP).height).toBe(260);
  });

  it("resets the edge it is on to where that mode starts", () => {
    expect(resetSize(setSize(floating, 700)).height).toBe(560);
    expect(resetSize(setSize(docked, 600)).width).toBe(384);
  });

  it("lets the floating panel grow to 1000px in a window with room for it", () => {
    expect(FLOATING_HEIGHT.max).toBe(1000);
    expect(setSize(floating, 1000, floatingRoom(1200)).height).toBe(1000);
    expect(setSize(floating, 1200, floatingRoom(1200)).height).toBe(1000);
  });

  it("keeps the floating panel inside a window too short for it", () => {
    // A 700px window leaves 650px under the header.
    const room = floatingRoom(700);
    expect(room).toBe(650);
    expect(setSize(floating, 1000, room).height).toBe(650);
    expect(resizeBy(setSize(floating, 640), RESIZE_STEP_LARGE, room).height).toBe(650);
    // A remembered height taller than the window reads as the room it has,
    // so the first step down moves the edge on screen.
    const tall = setSize(floating, 900);
    expect(resizable(tall, room)).toEqual({
      value: 650,
      range: { min: 260, max: 650, initial: 560 },
    });
    expect(resizeBy(tall, -RESIZE_STEP, room).height).toBe(634);
    // Too short even for the minimum: on screen wins, and the reset fits too.
    const tiny = floatingRoom(250);
    expect(setSize(floating, 600, tiny).height).toBe(200);
    expect(resetSize(setSize(floating, 900), tiny).height).toBe(200);
    expect(floatingRoom(10)).toBe(0);
  });

  it("does nothing with no edge to move", () => {
    const bar = minimise(floating);
    expect(resizeBy(bar, 16)).toBe(bar);
    expect(setSize(DEFAULT_LAYOUT, 600)).toBe(DEFAULT_LAYOUT);
    expect(resetSize(DEFAULT_LAYOUT)).toBe(DEFAULT_LAYOUT);
  });
});

describe("remembered per device", () => {
  it("round-trips the mode and both sizes through one versioned key", () => {
    const storage = memoryStorage();
    const layout = setSize(dock(setSize(floating, 680)), 504);
    saveLayout(layout, storage);
    expect(storage.length).toBe(1);
    expect(storage.key(0)).toBe(LAYOUT_STORAGE_KEY);
    expect(LAYOUT_STORAGE_KEY).toMatch(/v1$/);
    expect(loadLayout(storage)).toEqual(layout);
  });

  it("remembers a minimised panel as floating", () => {
    expect(parseLayout(serializeLayout(minimise(floating))).mode).toBe("floating");
  });

  it("remembers closed, and where it reopens", () => {
    const layout = parseLayout(serializeLayout(close(docked)));
    expect(layout.mode).toBe("closed");
    expect(toggle(layout).mode).toBe("docked");
  });

  it("falls back to the defaults for missing or unreadable storage", () => {
    expect(loadLayout(memoryStorage())).toEqual(DEFAULT_LAYOUT);
    expect(loadLayout(null)).toEqual(DEFAULT_LAYOUT);
    expect(loadLayout(hostileStorage())).toEqual(DEFAULT_LAYOUT);
    expect(() => saveLayout(floating, hostileStorage())).not.toThrow();
    for (const raw of ["{", "null", "42", '"docked"', "[]"]) {
      expect(parseLayout(raw), raw).toEqual(DEFAULT_LAYOUT);
    }
  });

  it("drops each bad field to its default, never to a broken layout", () => {
    expect(
      parseLayout(
        JSON.stringify({ mode: "sideways", home: "docked", height: 9999, width: 500 }),
      ),
    ).toEqual({ mode: "closed", home: "docked", height: 560, width: 500 });
    expect(
      parseLayout(
        JSON.stringify({ mode: "docked", home: 3, height: 300.5, width: "wide" }),
      ),
    ).toEqual({ mode: "docked", home: "floating", height: 560, width: 384 });
    // A minimised mode is never stored, so it is not trusted if it appears.
    expect(parseLayout(JSON.stringify({ mode: "minimised" })).mode).toBe("closed");
  });
});

describe("the room it takes at the window's right edge", () => {
  it("is the panel or its bar plus its inset, the docked width, or nothing when closed", () => {
    expect(rightClearance(DEFAULT_LAYOUT)).toBe(0);
    expect(rightClearance(floating)).toBe(400);
    expect(rightClearance(minimise(floating))).toBe(356);
    expect(rightClearance(docked)).toBe(384);
    expect(rightClearance(setSize(docked, 500))).toBe(500);
  });
});
