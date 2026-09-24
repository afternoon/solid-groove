import { beforeEach, describe, expect, it } from "vitest";
import { bars, toTicks } from "../domain";
import { setLoopEnabled, setLoopRange } from ".";
import { executeCommand } from "./execute";
import { createCommandHistory } from "./history";
import { type CommandTestProject, createCommandTestProject } from "./testProjects";

describe("loop commands (LOOP-017)", () => {
  let fixture: CommandTestProject;

  beforeEach(() => {
    fixture = createCommandTestProject();
  });

  it("sets the range as one revision and one history entry, and undoes it", () => {
    const history = createCommandHistory(fixture.project);
    const before = fixture.project.song.loop;

    const result = history.execute(setLoopRange(bars(2), bars(6)));

    expect(result.ok).toBe(true);
    expect(history.project.song.loop).toEqual({
      ...before,
      startTicks: 1536,
      endTicks: 4608,
    });
    expect(history.project.metadata.revision).toBe(fixture.project.metadata.revision + 1);
    expect(history.entries).toHaveLength(1);
    expect(history.undoSummary).toBe("Loop bars 3-6");

    history.undo();
    expect(history.project.song.loop).toEqual(before);
  });

  it("keeps the toggle when the range moves, and the range when the toggle flips", () => {
    const off = executeCommand(fixture.project, setLoopEnabled(false));
    if (!off.ok) throw new Error(off.issues[0].message);
    expect(off.project.song.loop).toEqual({
      ...fixture.project.song.loop,
      enabled: false,
    });
    expect(off.summary).toBe("Turn looping off");

    const moved = executeCommand(off.project, setLoopRange(bars(1), bars(2)));
    if (!moved.ok) throw new Error(moved.issues[0].message);
    expect(moved.project.song.loop.enabled).toBe(false);
  });

  it.each([
    ["off a bar line", toTicks(100), bars(2)],
    ["empty", bars(2), bars(2)],
    ["inverted", bars(3), bars(1)],
  ])(
    "rejects a range that is %s and leaves the project untouched",
    (_label, start, end) => {
      const result = executeCommand(fixture.project, setLoopRange(start, end));

      expect(result.ok).toBe(false);
      expect(result.project).toBe(fixture.project);
    },
  );

  it("rejects a malformed payload", () => {
    const result = executeCommand(fixture.project, {
      type: "loop.setEnabled",
      payload: { enabled: "yes" },
    });
    expect(result.ok).toBe(false);
  });

  it("does not touch clip content", () => {
    const result = executeCommand(fixture.project, setLoopRange(bars(4), bars(8)));
    if (!result.ok) throw new Error(result.issues[0].message);
    expect(result.project.clips).toBe(fixture.project.clips);
  });
});
