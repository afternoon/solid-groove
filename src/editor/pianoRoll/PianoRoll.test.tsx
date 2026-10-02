import { cleanup, fireEvent, screen, within } from "@solidjs/testing-library";
import { flush } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setKey } from "../../commands";
import { TICKS_PER_BAR } from "../../domain/time";
import { clickAndFlush, fireAndFlush } from "../../testing/events";
import { setUpRoll } from "./rollHarness";

afterEach(() => cleanup());

const pitchRows = () =>
  within(screen.getByRole("group", { name: "Pitches" })).getAllByRole("button");
const rulerSteps = () =>
  within(screen.getByRole("group", { name: "Ruler" })).getAllByRole("button");
const noteNames = () =>
  within(screen.getByRole("listbox", { name: "Notes" }))
    .queryAllByRole("option")
    .map((option) => option.getAttribute("aria-label"));

describe("piano roll", () => {
  it("draws the clip: a step per ruler button, C6 to C0, and its notes", async () => {
    const { renderRoll } = await setUpRoll();
    renderRoll();

    expect(screen.getByRole("region", { name: /^Piano roll\b/ })).toBeInTheDocument();
    expect(rulerSteps()).toHaveLength(32);
    expect(pitchRows()).toHaveLength(73);
    expect(pitchRows()[0]).toHaveAccessibleName("C6");
    expect(pitchRows().at(-1)).toHaveAccessibleName("C0");
    expect(noteNames()).toEqual([
      "C3, step 1, 1 step",
      "E3, step 5, 1 step",
      "G3, step 9, 1 step",
      "C4, step 13, 1 step",
    ]);
  });

  it("shows only scale rows in a scale, keeping an out-of-key note's row as Off", async () => {
    const { session, renderRoll } = await setUpRoll();
    session.dispatch(setKey({ root: 0, scale: "minor" }));
    renderRoll();

    const names = pitchRows().map((row) => row.getAttribute("aria-label"));
    expect(names).toContain("E3 Off");
    expect(names).not.toContain("E2");
    expect(names).toContain("D♯3");
    expect(noteNames()).toContain("E3, step 5, 1 step");
  });

  it("selects everything and deletes it as one undoable edit", async () => {
    const { session, renderRoll, notes, events } = await setUpRoll();
    const onSelectionChange = vi.fn();
    renderRoll({ onSelectionChange });

    clickAndFlush(screen.getByRole("button", { name: "Select all" }));
    expect(screen.getByText("4 selected")).toBeInTheDocument();
    expect(onSelectionChange).toHaveBeenLastCalledWith(notes().map((note) => note.id));

    clickAndFlush(screen.getByRole("button", { name: "Delete" }));
    expect(notes()).toHaveLength(0);
    expect(screen.getByText("None selected")).toBeInTheDocument();
    expect(events("clip_edited")).toHaveLength(1);

    session.undo();
    expect(notes()).toHaveLength(4);
  });

  it("lets the selection go when the key changes", async () => {
    const { session, renderRoll } = await setUpRoll();
    renderRoll();

    clickAndFlush(screen.getByRole("button", { name: "Select all" }));
    expect(screen.getByText("4 selected")).toBeInTheDocument();
    session.dispatch(setKey({ root: 0, scale: "minor" }));
    flush();
    expect(screen.getByText("None selected")).toBeInTheDocument();
  });

  it("deletes a note on a double-click", async () => {
    const { renderRoll, notes } = await setUpRoll();
    renderRoll();

    const option = screen.getByRole("option", { name: /^G3, step 9,/ });
    fireAndFlush(() => fireEvent.dblClick(option));
    expect(notes()).toHaveLength(3);
    expect(noteNames()).not.toContain("G3, step 9, 1 step");
  });

  it("moves the insert marker to a clicked ruler step", async () => {
    const { renderRoll } = await setUpRoll();
    renderRoll();

    clickAndFlush(screen.getByRole("button", { name: "Step 9" }));
    expect(screen.getByRole("button", { name: "Step 9" })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  it("zooms time only, from 50% to 200%", async () => {
    const { renderRoll } = await setUpRoll();
    renderRoll();

    clickAndFlush(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByText("125%")).toBeInTheDocument();
    expect(rulerSteps()[1]).toHaveStyle({ left: "50px", width: "50px" });
    for (let press = 0; press < 5; press += 1) {
      clickAndFlush(screen.getByRole("button", { name: "Zoom out" }));
    }
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zoom out" })).toBeDisabled();
    // Rows keep their height at every zoom.
    expect(screen.getByRole("option", { name: /^C3,/ })).toHaveStyle({
      height: "28px",
      width: "18px",
    });
  });

  it("plays a row's pitch unless preview is off, and plays through the host", async () => {
    const { renderRoll, audition } = await setUpRoll();
    const onTogglePlay = vi.fn();
    renderRoll({ onTogglePlay, playing: false });
    clickAndFlush(screen.getByRole("button", { name: "Play" }));
    expect(onTogglePlay).toHaveBeenCalledOnce();

    const c3 = pitchRows().find((row) => row.getAttribute("aria-label") === "C3");
    if (!c3) throw new Error("no C3 row");
    fireEvent.pointerDown(c3);
    expect(audition).toHaveBeenCalledWith(60, 0.8);

    clickAndFlush(screen.getByRole("button", { name: "Preview sound" }));
    fireEvent.pointerDown(c3);
    expect(audition).toHaveBeenCalledTimes(1);
  });

  it("solos the clip's track from the toolbar, as one undoable edit (#657)", async () => {
    const { renderRoll, session } = await setUpRoll();
    renderRoll();
    const solo = screen.getByRole("button", { name: "Solo" });
    const soloed = () => session.project.song.tracks[0].mixer.soloed;
    expect(solo).toHaveAttribute("aria-pressed", "false");

    clickAndFlush(solo);
    expect(soloed()).toBe(true);
    expect(solo).toHaveAttribute("aria-pressed", "true");

    session.undo();
    flush();
    expect(soloed()).toBe(false);
    expect(solo).toHaveAttribute("aria-pressed", "false");
  });

  it("sets the clip's length from a Bars control, as the step grid does (#869)", async () => {
    const { renderRoll, session, events } = await setUpRoll();
    renderRoll();
    const bars = screen.getByRole("combobox", { name: "Bars" });
    const length = () => session.project.clips[0].lengthTicks;
    expect(bars).toHaveValue("2");
    expect(
      Array.from(bars.querySelectorAll("option")).map((option) => option.textContent),
    ).toEqual(["1", "2", "4", "8", "16", "32"]);

    fireEvent.change(bars, { target: { value: "4" } });
    flush();
    expect(length()).toBe(TICKS_PER_BAR * 4);
    expect(rulerSteps()).toHaveLength(64);
    expect(session.history.entries.at(-1)?.commands[0].type).toBe("clip.update");

    // Shorter than it started, which Double could never do.
    fireEvent.change(bars, { target: { value: "1" } });
    flush();
    expect(length()).toBe(TICKS_PER_BAR);
    expect(rulerSteps()).toHaveLength(16);
    expect(bars).toHaveValue("1");

    session.undo();
    flush();
    expect(length()).toBe(TICKS_PER_BAR * 4);
    expect(
      events("feature_first_use").filter(
        (event) => event.params.feature === "clip_length",
      ),
    ).toHaveLength(1);
  });

  it("leaves the clip alone when its own length is chosen again (#869)", async () => {
    const { renderRoll, session } = await setUpRoll();
    renderRoll();
    const before = session.project;
    fireEvent.change(screen.getByRole("combobox", { name: "Bars" }), {
      target: { value: "2" },
    });
    flush();
    expect(session.project).toBe(before);
  });
});
