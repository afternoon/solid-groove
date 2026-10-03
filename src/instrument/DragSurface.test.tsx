import { cleanup, fireEvent, render } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Gesture, RawCommandInput } from "../commands";
import DragSurface, { type SurfacePoint } from "./DragSurface";
import { recordingGesture } from "./panelTesting";

afterEach(() => cleanup());

// jsdom has no `PointerEvent`; a `MouseEvent` of the pointer type carries
// `clientX`/`button` to the same handlers (as `PianoRoll.test.tsx` does).
function firePointer(
  el: Element,
  type: "pointerdown" | "pointermove" | "pointerup",
  init: { clientX?: number; clientY?: number; button?: number } = {},
): void {
  fireEvent(el, new MouseEvent(type, { bubbles: true, cancelable: true, ...init }));
}

const command = (id: string, value: number) =>
  ({ type: "test.set", payload: { id, value } }) as unknown as RawCommandInput;

/** A surface 200 × 100 px at the origin, writing two values per move. */
function renderSurface(
  beginGesture: () => Gesture | undefined,
  options: { startOnMove?: boolean } = {},
) {
  const dispatch = vi.fn();
  const grab = vi.fn((point: SurfacePoint) => (point.x < 0.5 ? "left" : "right"));
  const onCommit = vi.fn();
  const { container } = render(() => (
    <DragSurface
      grab={grab}
      commands={(point, grabbed) => [
        command(`${grabbed}-x`, point.x),
        command("y", point.y),
      ]}
      summary={() => "Drag"}
      dispatch={dispatch}
      beginGesture={beginGesture}
      onCommit={onCommit}
      startOnMove={options.startOnMove}
    />
  ));
  const surface = container.querySelector(".drag-surface") as HTMLElement;
  surface.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100 }) as DOMRect;
  return { surface, dispatch, grab, onCommit };
}

describe("DragSurface (#447)", () => {
  it("runs a drag as one gesture, grabbing once and writing both values per move", () => {
    const applied: RawCommandInput[] = [];
    const gesture = recordingGesture(applied);
    const commit = vi.spyOn(gesture, "commit");
    const { surface, dispatch, grab, onCommit } = renderSurface(() => gesture);

    firePointer(surface, "pointerdown", { button: 0, clientX: 50, clientY: 25 });
    firePointer(surface, "pointermove", { clientX: 150, clientY: 100 });
    firePointer(surface, "pointerup");

    expect(grab).toHaveBeenCalledTimes(1);
    // Grabbed on the left, it stays the left thing even once the pointer crosses.
    expect(applied).toEqual([
      command("left-x", 0.25),
      command("y", 0.75),
      command("left-x", 0.75),
      command("y", 0),
    ]);
    expect(dispatch).not.toHaveBeenCalled();
    expect(commit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("hands the press the surface's size", () => {
    const { surface, grab } = renderSurface(() => recordingGesture([]));
    firePointer(surface, "pointerdown", { button: 0, clientX: 50, clientY: 25 });
    expect(grab).toHaveBeenCalledWith({ x: 0.25, y: 0.75 }, { width: 200, height: 100 });
  });

  it("with startOnMove, a click only grabs, and the drag starts when it moves", () => {
    const applied: RawCommandInput[] = [];
    const gesture = recordingGesture(applied);
    const begin = vi.fn(() => gesture);
    const { surface, dispatch, grab, onCommit } = renderSurface(begin, {
      startOnMove: true,
    });

    firePointer(surface, "pointerdown", { button: 0, clientX: 50, clientY: 25 });
    firePointer(surface, "pointermove", { clientX: 50, clientY: 25 });
    firePointer(surface, "pointerup");
    expect(grab).toHaveBeenCalledTimes(1);
    expect(begin).not.toHaveBeenCalled();
    expect(applied).toEqual([]);
    expect(dispatch).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();

    firePointer(surface, "pointerdown", { button: 0, clientX: 50, clientY: 25 });
    firePointer(surface, "pointermove", { clientX: 150, clientY: 100 });
    firePointer(surface, "pointerup");
    expect(begin).toHaveBeenCalledTimes(1);
    expect(applied).toEqual([command("left-x", 0.75), command("y", 0)]);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("commits an open drag when the surface goes away mid-drag", () => {
    const gesture = recordingGesture([]);
    const commit = vi.spyOn(gesture, "commit");
    const { surface, onCommit } = renderSurface(() => gesture);

    firePointer(surface, "pointerdown", { button: 0, clientX: 50, clientY: 25 });
    // The panel unmounts before the pointer is released (a track switch).
    cleanup();

    expect(commit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("still lands each move when no gesture can open", () => {
    const { surface, dispatch } = renderSurface(() => {
      throw new Error("a gesture is already in progress");
    });
    firePointer(surface, "pointerdown", { button: 0, clientX: 200, clientY: 0 });
    firePointer(surface, "pointerup");
    expect(dispatch).toHaveBeenCalledExactlyOnceWith([
      command("right-x", 1),
      command("y", 1),
    ]);
  });

  it("ignores moves with no press, and presses of other buttons", () => {
    const applied: RawCommandInput[] = [];
    const { surface, grab } = renderSurface(() => recordingGesture(applied));
    firePointer(surface, "pointermove", { clientX: 10, clientY: 10 });
    firePointer(surface, "pointerdown", { button: 2, clientX: 10, clientY: 10 });
    expect(grab).not.toHaveBeenCalled();
    expect(applied).toEqual([]);
  });
});
