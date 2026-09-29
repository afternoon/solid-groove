import { cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { flush } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import { clickAndFlush } from "../../testing/events";
import { setUpRoll } from "./rollHarness";

afterEach(() => cleanup());

const strip = () => document.querySelector(".pr-velocity-strip") as HTMLElement;
const stalks = () => [...document.querySelectorAll(".pr-stalk")] as HTMLElement[];

/** jsdom has no layout: give the strip a 100 px height, so y is 100 - velocity%. */
function sizeStrip(): void {
  Object.defineProperty(strip(), "clientHeight", { value: 100, configurable: true });
}

function fire(type: string, clientX: number, clientY: number): void {
  fireEvent(
    strip(),
    new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX,
      clientY,
    }),
  );
  flush();
}

/** Drags on the stalk for `step` (1-based) to velocity `to` (0..1). */
function dragStalk(step: number, to: number): void {
  const x = (step - 1) * 40 + 10;
  fire("pointerdown", x, 50);
  fire("pointermove", x, 100 - to * 100);
  fire("pointerup", x, 100 - to * 100);
}

describe("velocity lane", () => {
  it("draws one stalk per note, as tall as its velocity", async () => {
    const { renderRoll } = await setUpRoll();
    renderRoll();

    expect(stalks()).toHaveLength(4);
    expect(stalks()[0]).toHaveStyle({ left: "0px", height: "90%" });
    expect(stalks()[3]).toHaveStyle({ left: "480px", height: "45%" });
  });

  it("sets one note's velocity by dragging its stalk, as one undoable edit", async () => {
    const { renderRoll, notes, session, audition, events } = await setUpRoll();
    renderRoll();
    sizeStrip();

    dragStalk(5, 0.3);
    expect(notes()[1].velocity).toBeCloseTo(0.3);
    expect(notes()[0].velocity).toBe(0.9);
    expect(audition).toHaveBeenLastCalledWith(64, expect.closeTo(0.3));
    expect(events("clip_edited")).toHaveLength(1);
    expect(events("feature_first_use").map((event) => event.params.feature)).toContain(
      "velocity_lane",
    );

    session.undo();
    expect(notes()[1].velocity).toBe(0.75);
  });

  it("moves every selected note together when the dragged one is selected", async () => {
    const { renderRoll, notes } = await setUpRoll();
    renderRoll();
    sizeStrip();

    clickAndFlush(screen.getByRole("button", { name: "Select all" }));
    expect(screen.getByText("Mixed")).toBeInTheDocument();
    dragStalk(1, 0.7);
    expect(notes().map((note) => Math.round(note.velocity * 100))).toEqual([
      70, 55, 40, 25,
    ]);
  });

  it("reads out a lone selected note's velocity out of 127", async () => {
    const { renderRoll } = await setUpRoll();
    renderRoll();

    const c3 = screen.getByRole("option", { name: /^C3,/ });
    fireEvent(c3, new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    flush();
    expect(document.querySelector(".pr-velocity-value")).toHaveTextContent("114");
  });

  it("follows the grid's horizontal scroll", async () => {
    const { renderRoll } = await setUpRoll();
    renderRoll();

    const scroller = document.querySelector(".pr-scroller") as HTMLElement;
    scroller.scrollLeft = 90;
    fireEvent.scroll(scroller);
    expect(
      (document.querySelector(".pr-velocity-viewport") as HTMLElement).scrollLeft,
    ).toBe(90);
  });
});
