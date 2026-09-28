import { cleanup, screen } from "@solidjs/testing-library";
import { flush } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import { setKey } from "../../commands";
import { clickAndFlush } from "../../testing/events";
import { pitchOf } from "./edits";
import { clearNoteClipboardForTest, type PianoRollActions } from "./rollActions";
import { setUpRoll } from "./rollHarness";

afterEach(() => {
  cleanup();
  clearNoteClipboardForTest();
});

/** The harness roll, with its registered keyboard operations. */
async function setUp(
  options: { analyticsEnabled?: boolean; refuseEdits?: boolean } = {},
) {
  const roll = await setUpRoll(options);
  let actions: PianoRollActions | null = null;
  roll.renderRoll({
    registerActions: (registered) => {
      actions = registered;
    },
    ...(options.refuseEdits
      ? { dispatch: () => ({ ok: false, project: roll.session.project, issues: [] }) }
      : {}),
  });
  const act = (run: (registered: PianoRollActions) => void) => {
    if (!actions) throw new Error("the roll registered no actions");
    run(actions);
    flush();
  };
  const summary = () =>
    roll
      .notes()
      .map(
        (note) => `${pitchOf(note)}@${note.startTicks / 48}x${note.durationTicks / 48}`,
      );
  return { ...roll, act, summary, actions: () => actions };
}

describe("piano roll keyboard operations", () => {
  it("copies, then pastes at the insert marker with the copies selected", async () => {
    const { act, summary, session, notes } = await setUp();

    act((a) => a.selectAll());
    act((a) => a.copy());
    // Copy moves the marker to the end of what was copied: after C4 on step 13.
    expect(screen.getByRole("button", { name: "Step 14" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    clickAndFlush(screen.getByRole("button", { name: "Step 17" }));
    act((a) => a.paste());
    expect(summary().slice(4)).toEqual(["60@16x1", "64@20x1", "67@24x1", "72@28x1"]);
    expect(screen.getByText("4 selected")).toBeInTheDocument();

    session.undo();
    expect(notes()).toHaveLength(4);
  });

  it("cuts: the notes go to the clipboard and out of the clip", async () => {
    const { act, notes, actions } = await setUp();

    act((a) => a.selectAll());
    act((a) => a.cut());
    expect(notes()).toHaveLength(0);
    expect(actions()?.hasClipboard()).toBe(true);
    expect(actions()?.hasSelection()).toBe(false);
  });

  it("moves by visible rows, so by scale degree in a scale, and by octaves", async () => {
    const { act, summary, session, audition } = await setUp();

    act((a) => a.selectAll());
    act((a) => a.moveRows(-1));
    expect(summary()).toEqual(["61@0x1", "65@4x1", "68@8x1", "73@12x1"]);
    expect(audition).toHaveBeenLastCalledWith(61, 0.9);
    session.undo();

    session.dispatch(setKey({ root: 0, scale: "minor" }));
    flush();
    act((a) => a.moveRows(-1));
    // C3 steps up to D3; E3 is off the scale, and its own row moves it to F3.
    expect(summary()[0]).toBe("62@0x1");

    act((a) => a.moveOctaves(1));
    expect(summary()[0]).toBe("74@0x1");
  });

  it("moves by steps and resizes, stopping at the clip's edges without an empty edit", async () => {
    const { act, summary, session } = await setUp();

    act((a) => a.selectAll());
    act((a) => a.moveSteps(1));
    act((a) => a.resizeSteps(2));
    expect(summary()).toEqual(["60@1x3", "64@5x3", "67@9x3", "72@13x3"]);
    act((a) => a.resizeSteps(-5));
    expect(summary()[0]).toBe("60@1x1");

    act((a) => a.moveSteps(-4));
    act((a) => a.moveSteps(-1));
    expect(summary()[0]).toBe("60@0x1");
    // The second move could not go anywhere, so it left no entry: one undo
    // takes back the first.
    session.undo();
    expect(summary()[0]).toBe("60@1x1");
  });

  it("duplicates straight after the selection, selecting the copies", async () => {
    const { act, summary } = await setUp();

    act((a) => a.selectAll());
    act((a) => a.duplicateSelection());
    // The four notes span steps 1-13, so the copies start on step 14.
    expect(summary().slice(4)).toEqual(["60@13x1", "64@17x1", "67@21x1", "72@25x1"]);
    expect(screen.getByText("4 selected")).toBeInTheDocument();
  });

  it("clears and deletes the selection", async () => {
    const { act, notes, actions } = await setUp();

    act((a) => a.selectAll());
    act((a) => a.clearSelection());
    expect(actions()?.hasSelection()).toBe(false);
    act((a) => a.selectAll());
    act((a) => a.deleteSelection());
    expect(notes()).toHaveLength(0);
  });
});

describe("piano roll keyboard analytics", () => {
  it("reports a refused paste or nudge as note_edit_failed, changing nothing", async () => {
    const { act, events, notes } = await setUp({ refuseEdits: true });
    for (const step of ["selectAll", "copy", "paste"] as const) act((a) => a[step]());
    act((a) => a.moveSteps(1));
    expect(notes()).toHaveLength(4);
    expect(events("note_edit_failed").map((event) => event.params)).toMatchObject([
      { operation: "paste", error_code: "command_rejected" },
      { operation: "nudge", error_code: "command_rejected" },
    ]);
  });

  it("logs the clipboard's first use once, and edits the same with analytics off", async () => {
    const run = async (analyticsEnabled: boolean) => {
      cleanup();
      const { act, summary, events } = await setUp({ analyticsEnabled });
      for (const step of ["selectAll", "copy", "paste", "copy", "paste"] as const) {
        act((a) => a[step]());
      }
      const uses = events("feature_first_use").map((event) => event.params.feature);
      return { notes: summary(), clipboard: uses.filter((f) => f === "note_clipboard") };
    };
    const on = await run(true);
    const off = await run(false);
    expect(off.notes).toEqual(on.notes);
    expect(on.clipboard).toHaveLength(1);
    expect(off.clipboard).toHaveLength(0);
  });
});
