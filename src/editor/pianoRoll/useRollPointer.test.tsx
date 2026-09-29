import { cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { flush } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import { setUpRoll } from "./rollHarness";

afterEach(() => cleanup());

// jsdom has no layout, so the grid sits at client (0, 0) and a content point
// is a client point. Chromatic rows run from C6 (96) down, 30 px each, and a
// step is 40 px at 100%. jsdom has no `PointerEvent` either; a `MouseEvent`
// of the same type carries the coordinates and modifiers to the same handlers.
const x = (step: number, offset = 20) => (step - 1) * 40 + offset;
const y = (pitch: number) => (96 - pitch) * 30 + 15;

interface At {
  x: number;
  y: number;
  altKey?: boolean;
  shiftKey?: boolean;
}

function fire(target: Element, type: string, at: At): void {
  fireEvent(
    target,
    new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: at.x,
      clientY: at.y,
      altKey: at.altKey ?? false,
      shiftKey: at.shiftKey ?? false,
    }),
  );
  flush();
}

const grid = () => document.querySelector(".pr-grid") as HTMLElement;
const note = (name: RegExp) => screen.getByRole("option", { name });

function click(target: Element, at: At): void {
  fire(target, "pointerdown", at);
  fire(grid(), "pointerup", at);
}

const selectedNames = () =>
  screen
    .getAllByRole("option")
    .filter((option) => option.getAttribute("aria-selected") === "true")
    .map((option) => option.getAttribute("aria-label"));

describe("piano roll pointer", () => {
  it("adds a selected, one-step note on a click in an empty cell, and plays it", async () => {
    const { renderRoll, audition, session, events } = await setUpRoll();
    renderRoll();

    click(grid(), { x: x(2), y: y(62) });

    expect(selectedNames()).toEqual(["D3, step 2, 1 step"]);
    expect(screen.getByRole("button", { name: "Step 2" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(audition).toHaveBeenLastCalledWith(62, 0.8);
    expect(events("clip_edited")).toHaveLength(1);
    session.undo();
    flush();
    expect(screen.queryByRole("option", { name: /^D3,/ })).not.toBeInTheDocument();
  });

  it("adds nothing past the clip's end or for a press that moves", async () => {
    const { renderRoll, notes } = await setUpRoll();
    renderRoll();

    click(grid(), { x: x(33), y: y(62) });
    fire(grid(), "pointerdown", { x: x(2), y: y(62) });
    fire(grid(), "pointermove", { x: x(2) + 6, y: y(62) });
    fire(grid(), "pointerup", { x: x(2) + 6, y: y(62) });
    expect(notes()).toHaveLength(4);
  });

  it("toggles a note with Shift-click, and a plain click selects only it", async () => {
    const { renderRoll, audition } = await setUpRoll();
    renderRoll();

    click(note(/^C3,/), { x: x(1), y: y(60) });
    expect(audition).toHaveBeenLastCalledWith(60, 0.9);
    click(note(/^E3,/), { x: x(5), y: y(64), shiftKey: true });
    expect(selectedNames()).toHaveLength(2);
    click(note(/^E3,/), { x: x(5), y: y(64), shiftKey: true });
    expect(selectedNames()).toEqual(["C3, step 1, 1 step"]);

    click(note(/^E3,/), { x: x(5), y: y(64), shiftKey: true });
    click(note(/^E3,/), { x: x(5), y: y(64) });
    expect(selectedNames()).toEqual(["E3, step 5, 1 step"]);
  });

  it("logs the first audition once, and edits the same with analytics off", async () => {
    for (const analyticsEnabled of [true, false]) {
      cleanup();
      const { renderRoll, notes, audition, events } = await setUpRoll({
        analyticsEnabled,
      });
      renderRoll();

      click(grid(), { x: x(2), y: y(62) });
      click(note(/^C3,/), { x: x(1), y: y(60) });
      expect(notes()).toHaveLength(5);
      expect(audition).toHaveBeenCalledTimes(2);
      const auditions = events("feature_first_use").filter(
        (event) => event.params.feature === "note_audition",
      );
      expect(auditions).toHaveLength(analyticsEnabled ? 1 : 0);
    }
  });
});
