import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NoteEvent } from "../../domain/entities";
import type { EventId } from "../../domain/ids";
import { TICKS_PER_SIXTEENTH } from "../../domain/time";
import Gutter from "./Gutter";
import NoteLayer, { noteLabel } from "./NoteLayer";
import Ruler from "./Ruler";

afterEach(() => cleanup());

function note(id: string, step: number, pitch: number, steps = 1): NoteEvent {
  return {
    id: id as EventId,
    trigger: { kind: "pitch", pitch },
    startTicks: (step * TICKS_PER_SIXTEENTH) as NoteEvent["startTicks"],
    durationTicks: (steps * TICKS_PER_SIXTEENTH) as NoteEvent["durationTicks"],
    velocity: 0.8,
    probability: null,
  };
}

const ROWS = [
  { pitch: 54, black: true, off: true },
  { pitch: 53, black: false, off: false },
  { pitch: 51, black: true, off: false },
];

describe("gutter", () => {
  it("names each row by pitch, tags an off row, and plays a row when pressed", () => {
    const onAudition = vi.fn();
    render(() => <Gutter rows={ROWS} onAudition={onAudition} />);
    const group = screen.getByRole("group", { name: "Pitches" });
    const names = within(group)
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label"));
    expect(names).toEqual(["F♯2 Off", "F2", "D♯2"]);
    expect(within(group).getByRole("button", { name: "F2" })).not.toHaveClass("black");
    expect(within(group).getByRole("button", { name: "D♯2" })).toHaveClass("black");
    fireEvent.pointerDown(within(group).getByRole("button", { name: "F2" }));
    expect(onAudition).toHaveBeenCalledWith(53);
  });
});

describe("ruler", () => {
  it("has one step button per step, one step wide, that sets the marker", () => {
    const onSetMarker = vi.fn();
    render(() => (
      <Ruler steps={16} stepWidth={40} marker={8} onSetMarker={onSetMarker} />
    ));
    const steps = within(screen.getByRole("group", { name: "Ruler" })).getAllByRole(
      "button",
    );
    expect(steps).toHaveLength(16);
    expect(steps[15]).toHaveAccessibleName("Step 16");
    expect(steps[2]).toHaveStyle({ left: "80px", width: "40px" });
    expect(steps[8]).toHaveAttribute("aria-current", "true");
    expect(steps[0]).toHaveTextContent("1");
    expect(steps[4]).toHaveTextContent("1.2");
    fireEvent.click(steps[8]);
    expect(onSetMarker).toHaveBeenCalledWith(8);
  });

  it("drops beat labels when zoomed out too far to read them", () => {
    render(() => <Ruler steps={32} stepWidth={8} marker={0} onSetMarker={() => {}} />);
    const steps = screen.getAllByRole("button");
    expect(steps[4]).toHaveTextContent("");
    expect(steps[16]).toHaveTextContent("2");
  });

  it("only labels its steps when it has no marker, as the step grid's (#643)", () => {
    render(() => <Ruler steps={16} stepWidth={40} />);
    const ruler = document.querySelector(".pr-ruler");
    expect(ruler).toHaveAttribute("aria-hidden", "true");
    expect(ruler?.querySelector(".pr-ruler-marker")).toBeNull();
    const steps = ruler?.querySelectorAll("button") ?? [];
    expect(steps).toHaveLength(16);
    expect([...steps].every((step) => (step as HTMLButtonElement).disabled)).toBe(true);
  });
});

describe("note layer", () => {
  it("names notes by pitch, step and length", () => {
    expect(noteLabel(note("a", 0, 48, 2))).toBe("C2, step 1, 2 steps");
    expect(noteLabel(note("b", 8, 51))).toBe("D♯2, step 9, 1 step");
  });

  it("lists every note on a shown row as an option, marking the selected ones", () => {
    const onDown = vi.fn();
    const onDouble = vi.fn();
    const notes = [note("a", 0, 53, 2), note("b", 4, 51), note("c", 8, 60)];
    render(() => (
      <NoteLayer
        notes={notes}
        rows={ROWS}
        zoom={1}
        selected={new Set(["a" as EventId])}
        onNotePointerDown={onDown}
        onNoteDoubleClick={onDouble}
      />
    ));
    const options = within(screen.getByRole("listbox", { name: "Notes" })).getAllByRole(
      "option",
    );
    // The C3 note has no row among these three, so it is not drawn.
    expect(options.map((option) => option.getAttribute("aria-label"))).toEqual([
      "F2, step 1, 2 steps",
      "D♯2, step 5, 1 step",
    ]);
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    expect(options[1]).toHaveAttribute("aria-selected", "false");
    // Row 1, steps 0-1: the gap comes off the far edges.
    expect(options[0]).toHaveStyle({ left: "0px", top: "30px", width: "78px" });
    fireEvent.pointerDown(options[1]);
    expect(onDown).toHaveBeenCalledWith(notes[1], expect.anything());
    fireEvent.dblClick(options[0]);
    expect(onDouble).toHaveBeenCalledWith(notes[0]);
  });
});
