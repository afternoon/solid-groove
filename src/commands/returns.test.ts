import { beforeEach, describe, expect, it } from "vitest";
import {
  type AutomationLane,
  createDevice,
  createReturnBus,
  createSend,
  MAX_RETURN_BUSES,
  type Project,
  RETURN_VOLUME,
  type ReturnId,
  TRACK_SEND_LEVEL,
  toTicks,
} from "../domain";
import {
  addDevice,
  addReturn,
  addSend,
  removeReturn,
  removeSend,
  returnChain,
  setParameter,
  updateReturn,
} from ".";
import { executeCommand } from "./execute";
import { createCommandHistory } from "./history";
import { findTrack } from "./projectEdits";
import {
  type CommandTestProject,
  contentSignature,
  createCommandTestProject,
  createTestFactoryContext,
} from "./testProjects";
import type { RawCommandInput } from "./types";

function apply(project: Project, command: RawCommandInput): Project {
  const result = executeCommand(project, command);
  if (!result.ok) {
    throw new Error(`Expected success: ${result.issues[0].message}`);
  }
  return result.project;
}

function refusal(project: Project, command: RawCommandInput): string {
  const result = executeCommand(project, command);
  if (result.ok) throw new Error("Expected the command to be refused");
  return result.issues[0].message;
}

const context = createTestFactoryContext("returns-command-test");

function newReturn(name: string, order: number) {
  return createReturnBus(context, { name, order });
}

/** An automation lane on the fixture's return and one on track A's send to it. */
function withReturnAutomation(fixture: CommandTestProject): Project {
  const lanes: AutomationLane[] = [
    {
      id: context.ids("automation"),
      target: {
        scope: "return",
        returnId: fixture.returnId,
        parameterId: RETURN_VOLUME.id,
      },
      interpolation: "linear",
      points: [{ tick: toTicks(0), value: -3 }],
    },
    {
      id: context.ids("automation"),
      target: {
        scope: "send",
        trackId: fixture.trackAId,
        returnId: fixture.returnId,
        parameterId: TRACK_SEND_LEVEL.id,
      },
      interpolation: "linear",
      points: [{ tick: toTicks(0), value: 0.5 }],
    },
  ];
  return {
    ...fixture.project,
    song: {
      ...fixture.project.song,
      automation: [...fixture.project.song.automation, ...lanes],
    },
  };
}

describe("return.create", () => {
  let fixture: CommandTestProject;
  beforeEach(() => {
    fixture = createCommandTestProject();
  });

  it("adds a return bus at its order, renumbering the rest", () => {
    const bus = newReturn("Delay", 0);
    const next = apply(fixture.project, addReturn(bus));
    expect(next.song.returns.map((candidate) => [candidate.id, candidate.order])).toEqual(
      [
        [bus.id, 0],
        [fixture.returnId, 1],
      ],
    );
  });

  it("refuses a duplicate id, a gap in the order, and a ninth return", () => {
    const existing = fixture.project.song.returns[0];
    expect(refusal(fixture.project, addReturn(existing))).toMatch(/already exists/);
    expect(refusal(fixture.project, addReturn(newReturn("Far", 5)))).toMatch(
      /position 5/,
    );

    let full = fixture.project;
    for (let order = 1; order < MAX_RETURN_BUSES; order += 1) {
      full = apply(full, addReturn(newReturn(`R${order}`, order)));
    }
    expect(full.song.returns).toHaveLength(MAX_RETURN_BUSES);
    expect(refusal(full, addReturn(newReturn("Ninth", 0)))).toMatch(/at most 8/);
  });

  it("refuses a restored send that targets a different return", () => {
    const bus = newReturn("Delay", 1);
    const message = refusal(
      fixture.project,
      addReturn(bus, {
        sends: [
          {
            trackId: fixture.trackBId,
            send: createSend(fixture.returnId, 0.5),
            index: 0,
          },
        ],
      }),
    );
    expect(message).toMatch(/targets/);
  });

  it("does not touch a track it restores no send to", () => {
    const bus = newReturn("Delay", 1);
    const next = apply(fixture.project, addReturn(bus));
    expect(findTrack(next, fixture.trackAId)).toBe(
      findTrack(fixture.project, fixture.trackAId),
    );
  });
});

describe("return.delete", () => {
  let fixture: CommandTestProject;
  beforeEach(() => {
    fixture = createCommandTestProject();
  });

  it("removes the return, every send to it and every lane on either, in one transaction", () => {
    const start = withReturnAutomation(fixture);
    const next = apply(start, removeReturn(fixture.returnId));
    expect(next.song.returns).toHaveLength(0);
    expect(findTrack(next, fixture.trackAId)?.sendConfig).toEqual([]);
    expect(
      next.song.automation.some(
        (lane) => lane.target.scope === "send" || lane.target.scope === "return",
      ),
    ).toBe(false);
    // The track-volume lane is not the return's, so it stays.
    expect(next.song.automation).toHaveLength(1);
    // Track B never sent to it, so it keeps its object.
    expect(findTrack(next, fixture.trackBId)).toBe(findTrack(start, fixture.trackBId));
  });

  it("is undone in one step: the return, its chain, its sends and their lanes", () => {
    const withChain = apply(
      withReturnAutomation(fixture),
      addDevice(
        returnChain(fixture.returnId),
        createDevice(context.ids("device"), "reverb", 0),
      ),
    );
    const history = createCommandHistory(withChain);
    const before = contentSignature(withChain);
    expect(history.execute(removeReturn(fixture.returnId)).ok).toBe(true);
    expect(history.snapshot().undoDepth).toBe(1);
    expect(history.undo()?.ok).toBe(true);
    expect(contentSignature(history.project)).toBe(before);
    expect(findTrack(history.project, fixture.trackAId)?.sendConfig).toEqual(
      findTrack(withChain, fixture.trackAId)?.sendConfig,
    );
  });

  it("refuses a return that does not exist", () => {
    const gone = context.ids("return") as ReturnId;
    expect(refusal(fixture.project, removeReturn(gone))).toMatch(/does not exist/);
  });
});

describe("return.update", () => {
  it("renames a return and undoes to the old name", () => {
    const fixture = createCommandTestProject();
    const history = createCommandHistory(fixture.project);
    expect(history.execute(updateReturn(fixture.returnId, { name: "Plate" })).ok).toBe(
      true,
    );
    expect(history.project.song.returns[0].name).toBe("Plate");
    history.undo();
    expect(history.project.song.returns[0].name).toBe("Reverb");
  });

  it("refuses an empty name and an empty change", () => {
    const fixture = createCommandTestProject();
    expect(
      executeCommand(fixture.project, updateReturn(fixture.returnId, { name: "" })).ok,
    ).toBe(false);
    expect(executeCommand(fixture.project, updateReturn(fixture.returnId, {})).ok).toBe(
      false,
    );
  });
});

describe("send.add and send.remove", () => {
  let fixture: CommandTestProject;
  beforeEach(() => {
    fixture = createCommandTestProject();
  });

  it("adds a send that parameter.set's send scope can then level", () => {
    const sent = apply(
      fixture.project,
      addSend(fixture.trackBId, createSend(fixture.returnId)),
    );
    expect(findTrack(sent, fixture.trackBId)?.sendConfig).toEqual([
      {
        returnId: fixture.returnId,
        level: TRACK_SEND_LEVEL.defaultValue,
        preFader: false,
      },
    ]);
    const levelled = apply(
      sent,
      setParameter(
        {
          scope: "send",
          trackId: fixture.trackBId,
          returnId: fixture.returnId,
          parameterId: TRACK_SEND_LEVEL.id,
        },
        0.7,
      ),
    );
    expect(findTrack(levelled, fixture.trackBId)?.sendConfig[0].level).toBe(0.7);
  });

  it("refuses a second send to the same return and a send to a missing one", () => {
    expect(
      refusal(fixture.project, addSend(fixture.trackAId, createSend(fixture.returnId))),
    ).toMatch(/already sends/);
    const gone = context.ids("return") as ReturnId;
    expect(refusal(fixture.project, addSend(fixture.trackBId, createSend(gone)))).toMatch(
      /does not exist/,
    );
  });

  it("removes a send with its automation, and the undo puts both back", () => {
    const start = withReturnAutomation(fixture);
    const history = createCommandHistory(start);
    expect(history.execute(removeSend(fixture.trackAId, fixture.returnId)).ok).toBe(true);
    expect(findTrack(history.project, fixture.trackAId)?.sendConfig).toEqual([]);
    expect(
      history.project.song.automation.some((lane) => lane.target.scope === "send"),
    ).toBe(false);
    // The lane on the return itself is not the send's.
    expect(
      history.project.song.automation.some((lane) => lane.target.scope === "return"),
    ).toBe(true);
    history.undo();
    expect(contentSignature(history.project)).toBe(contentSignature(start));
  });

  it("refuses to remove a send the track does not have", () => {
    expect(
      refusal(fixture.project, removeSend(fixture.trackBId, fixture.returnId)),
    ).toMatch(/has no send/);
  });
});
