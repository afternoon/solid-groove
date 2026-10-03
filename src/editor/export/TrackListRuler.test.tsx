import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clickAndFlush } from "../../testing/events";
import TrackListRuler, { type TrackListRulerProps } from "./TrackListRuler";

afterEach(cleanup);

function renderRuler(props: Partial<TrackListRulerProps> = {}) {
  const onPickAction = vi.fn();
  const view = render(() => (
    <TrackListRuler
      included={4}
      total={6}
      picked={0}
      bars={40}
      onPickAction={onPickAction}
      {...props}
    />
  ));
  return { onPickAction, container: view.container };
}

describe("TrackListRuler", () => {
  it("says how many stems are on, with the click, range and pick hint, when nothing is picked", () => {
    renderRuler();
    expect(screen.getByText("4 of 6 stems")).toBeInTheDocument();
    const hint = screen.getByText("click flips", { exact: false });
    expect(hint.textContent).toMatch(/^click flips ⇧ range (⌘|Ctrl) pick$/);
    expect(hint).toHaveAttribute(
      "title",
      expect.stringMatching(/^Click flips a track\./),
    );
    expect(screen.queryByRole("button", { name: "On" })).not.toBeInTheDocument();
  });

  it("shows the picked count and its actions while tracks are picked", () => {
    const { onPickAction } = renderRuler({ picked: 3 });
    expect(screen.getByText("3 picked")).toBeInTheDocument();
    expect(screen.queryByText("4 of 6 stems")).not.toBeInTheDocument();
    for (const name of ["On", "Off", "Only these", "Clear picked tracks"]) {
      clickAndFlush(screen.getByRole("button", { name }));
    }
    expect(onPickAction.mock.calls).toEqual([["on"], ["off"], ["only"], ["clear"]]);
  });

  it("disables the picked-set buttons while an export runs", () => {
    renderRuler({ picked: 2, disabled: true });
    expect(screen.getByRole("button", { name: "Only these" })).toBeDisabled();
  });

  it("only says In the mix in stereo mode, even with picks", () => {
    renderRuler({ readOnly: true, picked: 2 });
    expect(screen.getByText("In the mix")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("labels bar 1 and every 16 bars on the ruler", () => {
    const { container } = renderRuler();
    const marks = [...container.querySelectorAll(".track-ruler-marks span")];
    expect(marks.map((mark) => mark.textContent)).toEqual(["1", "17", "33"]);
    expect((marks[1] as HTMLElement).style.left).toBe("40%");
  });
});
