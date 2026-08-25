import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createBlankProject,
  createSeededIdFactory,
  type Project,
  TRACK_VOLUME,
} from "../domain";
import { createManualClock } from "../shared/clock";
import { setParameter, updateTrack } from ".";
import {
  type CommandHistory,
  createCommandHistory,
  DEFAULT_HISTORY_LIMIT,
} from "./history";
import { findTrack } from "./projectEdits";
import {
  ABSENT_IDS,
  type CommandTestProject,
  contentSignature,
  createCommandTestProject,
} from "./testProjects";

function volumeOf(project: Project, trackId: CommandTestProject["trackAId"]) {
  return findTrack(project, trackId)?.mixer.volume;
}

describe("CommandHistory", () => {
  let fixture: CommandTestProject;
  let history: CommandHistory;

  beforeEach(() => {
    fixture = createCommandTestProject();
    history = createCommandHistory(fixture.project, {
      clock: createManualClock(1_700_000_600_000),
    });
  });

  it("starts empty", () => {
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
    expect(history.undoSummary).toBeNull();
    expect(history.undo()).toBeNull();
    expect(history.redo()).toBeNull();
    expect(history.project).toBe(fixture.project);
  });

  it("records one entry per command with a readable summary", () => {
    history.execute(updateTrack(fixture.trackAId, { name: "Sub" }));

    expect(history.entries).toHaveLength(1);
    expect(history.undoSummary).toBe('Rename track "Bass" to "Sub"');
    expect(history.canUndo).toBe(true);
    expect(findTrack(history.project, fixture.trackAId)?.name).toBe("Sub");
  });

  it("undoes and redoes without rewinding the revision counter", () => {
    const before = contentSignature(fixture.project);
    history.execute(updateTrack(fixture.trackAId, { name: "Sub" }));
    expect(history.project.metadata.revision).toBe(1);

    history.undo();
    expect(contentSignature(history.project)).toBe(before);
    // Undo is a new state to persist, not a rollback of the revision.
    expect(history.project.metadata.revision).toBe(2);
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(true);
    expect(history.redoSummary).toBe('Rename track "Bass" to "Sub"');

    history.redo();
    expect(findTrack(history.project, fixture.trackAId)?.name).toBe("Sub");
    expect(history.project.metadata.revision).toBe(3);
    expect(history.canRedo).toBe(false);
  });

  it("drops the redo branch as soon as a new command is executed", () => {
    history.execute(updateTrack(fixture.trackAId, { name: "One" }));
    history.undo();
    expect(history.canRedo).toBe(true);

    history.execute(updateTrack(fixture.trackAId, { name: "Two" }));
    expect(history.canRedo).toBe(false);
    expect(history.entries).toHaveLength(1);
  });

  it("keeps history bounded", () => {
    const bounded = createCommandHistory(fixture.project, { limit: 3 });
    for (const name of ["a", "b", "c", "d", "e"]) {
      bounded.execute(updateTrack(fixture.trackAId, { name }));
    }
    expect(bounded.entries).toHaveLength(3);
    expect(bounded.entries[0].summary).toContain('"c"');
    expect(bounded.limit).toBe(3);
    expect(DEFAULT_HISTORY_LIMIT).toBeGreaterThan(3);
  });

  it("keeps the project unchanged when a command is refused", () => {
    const result = history.execute(updateTrack(ABSENT_IDS.track, { name: "Nope" }));
    expect(result.ok).toBe(false);
    expect(history.entries).toHaveLength(0);
    expect(history.project).toBe(fixture.project);
  });

  it("records a multi-command transaction as one entry", () => {
    history.execute(
      [
        updateTrack(fixture.trackAId, { name: "One" }),
        updateTrack(fixture.trackBId, { name: "Two" }),
      ],
      { summary: "Rename both tracks" },
    );

    expect(history.entries).toHaveLength(1);
    expect(history.undoSummary).toBe("Rename both tracks");

    history.undo();
    expect(findTrack(history.project, fixture.trackAId)?.name).toBe("Bass");
    expect(findTrack(history.project, fixture.trackBId)?.name).toBe("Drums");
  });

  describe("gestures", () => {
    const volumeTarget = (trackId: CommandTestProject["trackAId"]) =>
      ({
        scope: "track",
        trackId,
        parameterId: TRACK_VOLUME.id,
      }) as const;

    it("collapses a continuous drag into one entry and one revision", () => {
      const gesture = history.beginGesture({ summary: "Set track volume" });
      for (const value of [-1, -2, -3, -4]) {
        gesture.apply(setParameter(volumeTarget(fixture.trackAId), value));
      }
      expect(history.project.metadata.revision).toBe(0);
      expect(volumeOf(history.project, fixture.trackAId)).toBe(-4);

      const entry = gesture.commit();
      expect(entry?.summary).toBe("Set track volume");
      expect(entry?.commands).toHaveLength(4);
      expect(history.entries).toHaveLength(1);
      expect(history.project.metadata.revision).toBe(1);

      history.undo();
      expect(volumeOf(history.project, fixture.trackAId)).toBe(0);
    });

    it("redoes a committed gesture in one step", () => {
      const gesture = history.beginGesture();
      gesture.apply(setParameter(volumeTarget(fixture.trackAId), -5));
      gesture.apply(setParameter(volumeTarget(fixture.trackAId), -9));
      gesture.commit();

      history.undo();
      expect(volumeOf(history.project, fixture.trackAId)).toBe(0);
      history.redo();
      expect(volumeOf(history.project, fixture.trackAId)).toBe(-9);
    });

    it("restores the starting state when a gesture is cancelled", () => {
      const before = contentSignature(fixture.project);
      const gesture = history.beginGesture();
      gesture.apply(setParameter(volumeTarget(fixture.trackAId), -12));
      expect(volumeOf(history.project, fixture.trackAId)).toBe(-12);

      gesture.cancel();
      expect(contentSignature(history.project)).toBe(before);
      expect(history.project).toBe(fixture.project);
      expect(history.entries).toHaveLength(0);
      expect(gesture.active).toBe(false);
    });

    it("records nothing for a gesture that applied nothing", () => {
      const gesture = history.beginGesture();
      expect(gesture.commit()).toBeNull();
      expect(history.entries).toHaveLength(0);
      expect(history.gestureActive).toBe(false);
    });

    it("keeps a failed step out of the gesture", () => {
      const gesture = history.beginGesture();
      gesture.apply(setParameter(volumeTarget(fixture.trackAId), -3));
      const failed = gesture.apply(setParameter(volumeTarget(ABSENT_IDS.track), -3));
      expect(failed.ok).toBe(false);

      const entry = gesture.commit();
      expect(entry?.commands).toHaveLength(1);
      expect(volumeOf(history.project, fixture.trackAId)).toBe(-3);
    });

    it("routes commands issued mid-gesture into the same entry", () => {
      const gesture = history.beginGesture({ summary: "Drag" });
      gesture.apply(setParameter(volumeTarget(fixture.trackAId), -3));
      history.execute(updateTrack(fixture.trackAId, { name: "Mid-drag" }));
      gesture.commit();

      expect(history.entries).toHaveLength(1);
      expect(history.entries[0].commands).toHaveLength(2);
    });

    it("refuses to nest gestures or undo inside one", () => {
      const gesture = history.beginGesture();
      expect(() => history.beginGesture()).toThrow(/already in progress/);
      expect(() => history.undo()).toThrow(/while a gesture/);
      expect(() => history.redo()).toThrow(/while a gesture/);
      gesture.cancel();
    });

    it("refuses to reuse a finished gesture", () => {
      const gesture = history.beginGesture();
      gesture.apply(setParameter(volumeTarget(fixture.trackAId), -3));
      gesture.commit();
      expect(() =>
        gesture.apply(setParameter(volumeTarget(fixture.trackAId), -4)),
      ).toThrow(/already finished/);
      expect(() => gesture.commit()).toThrow(/already finished/);
    });
  });

  describe("project replacement", () => {
    it("resets history deliberately", () => {
      history.execute(updateTrack(fixture.trackAId, { name: "Sub" }));
      history.undo();
      expect(history.canRedo).toBe(true);

      const other = createBlankProject({
        ownerId: "user_other",
        ids: createSeededIdFactory("other"),
        now: 1_700_000_000_000,
      });
      history.replaceProject(other);

      expect(history.project).toBe(other);
      expect(history.canUndo).toBe(false);
      expect(history.canRedo).toBe(false);
      expect(history.entries).toHaveLength(0);
    });

    it("clears history without touching the project", () => {
      history.execute(updateTrack(fixture.trackAId, { name: "Sub" }));
      const current = history.project;
      history.clear();
      expect(history.project).toBe(current);
      expect(history.canUndo).toBe(false);
    });
  });

  describe("subscriptions", () => {
    it("notifies subscribers with a snapshot and stops on unsubscribe", () => {
      const listener = vi.fn();
      const unsubscribe = history.subscribe(listener);

      history.execute(updateTrack(fixture.trackAId, { name: "Sub" }));
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0]).toMatchObject({
        canUndo: true,
        canRedo: false,
        undoDepth: 1,
        gestureActive: false,
      });

      unsubscribe();
      history.execute(updateTrack(fixture.trackAId, { name: "Again" }));
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("releases every subscriber on dispose", () => {
      const listener = vi.fn();
      history.subscribe(listener);
      history.dispose();
      history.execute(updateTrack(fixture.trackAId, { name: "Sub" }));
      expect(listener).not.toHaveBeenCalled();
    });
  });
});
