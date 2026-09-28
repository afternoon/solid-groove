import { beforeEach, describe, expect, it } from "vitest";
import { Analytics } from "../analytics/analytics";
import { ConsentStore } from "../analytics/consent";
import { createRecordingTransport } from "../analytics/transport";
import { CommandHistory } from "../commands";
import { createSliceFixtureProject } from "../domain/fixtures";
import { TICKS_PER_BAR } from "../domain/time";
import { memoryStorage } from "../testing/storage";
import { type LoopActionContext, loopSelection, toggleLooping } from "./loopActions";

function setUp(options: { analyticsEnabled?: boolean } = {}) {
  const history = new CommandHistory(createSliceFixtureProject());
  const transport = createRecordingTransport();
  const consent = new ConsentStore(memoryStorage());
  if (options.analyticsEnabled === false) consent.set({ productAnalytics: false });
  const analytics = new Analytics({ transport, consent, storage: memoryStorage() });
  const context: LoopActionContext = {
    project: () => history.project,
    dispatch: (commands) => history.execute(commands),
    analytics,
  };
  return { history, transport, context };
}

describe("loop actions (LOOP-017)", () => {
  let ctx: ReturnType<typeof setUp>;

  beforeEach(() => {
    ctx = setUp();
  });

  it("toggles looping through the command layer and logs loop_toggled once", () => {
    const { history, transport, context } = ctx;

    expect(toggleLooping(context)).toBe(true);

    expect(history.project.song.loop.enabled).toBe(false);
    expect(history.entries).toHaveLength(1);
    const events = transport.named("loop_toggled");
    expect(events).toHaveLength(1);
    expect(events[0]?.params.enabled).toBe(false);

    toggleLooping(context);
    expect(history.project.song.loop.enabled).toBe(true);
    expect(transport.named("loop_toggled").map((event) => event.params.enabled)).toEqual([
      false,
      true,
    ]);
  });

  it("carries no project, track, or clip names in either event", () => {
    const { transport, context, history } = ctx;
    toggleLooping(context);
    loopSelection(context, 0, 4 * TICKS_PER_BAR);

    const names = [
      history.project.metadata.name,
      ...history.project.song.tracks.map((track) => track.name),
      ...history.project.clips.map((clip) => clip.name),
    ];
    for (const event of [
      ...transport.named("loop_toggled"),
      ...transport.named("loop_range_set"),
    ]) {
      const values = Object.values(event.params).map(String);
      for (const name of names) expect(values).not.toContain(name);
    }
  });

  it("logs nothing when the command is refused", () => {
    const { transport, context } = ctx;
    const refusing: LoopActionContext = { ...context, dispatch: () => undefined };

    expect(toggleLooping(refusing)).toBe(false);
    expect(loopSelection(refusing, 0, 4 * TICKS_PER_BAR)).toBe(false);

    expect(transport.named("loop_toggled")).toHaveLength(0);
    expect(transport.named("loop_range_set")).toHaveLength(0);
  });

  it("edits the loop identically with analytics disabled, and emits nothing", () => {
    const denied = setUp({ analyticsEnabled: false });

    toggleLooping(denied.context);
    loopSelection(denied.context, 0, 2 * TICKS_PER_BAR);

    expect(denied.history.project.song.loop).toMatchObject({
      startTicks: 0,
      endTicks: 2 * TICKS_PER_BAR,
      enabled: true,
    });
    expect(denied.transport.events).toHaveLength(0);
  });

  it("loops a selection's span in one transaction and turns looping on (#494)", () => {
    const { history, transport, context } = ctx;
    toggleLooping(context); // off
    const before = history.entries.length;

    expect(loopSelection(context, TICKS_PER_BAR + 30, 3 * TICKS_PER_BAR - 5)).toBe(true);

    expect(history.project.song.loop).toMatchObject({
      startTicks: TICKS_PER_BAR,
      endTicks: 3 * TICKS_PER_BAR,
      enabled: true,
    });
    expect(history.entries).toHaveLength(before + 1);
    expect(transport.named("loop_range_set")).toHaveLength(1);
    expect(transport.named("loop_toggled").map((e) => e.params.enabled)).toEqual([
      false,
      true,
    ]);
  });

  it("does nothing when already looping over the selection's span (#494)", () => {
    const { history, context } = ctx;
    const { startTicks, endTicks } = history.project.song.loop;
    expect(loopSelection(context, startTicks, endTicks)).toBe(false);
    expect(history.entries).toHaveLength(0);
  });
});
