import { describe, expect, it } from "vitest";
import type { Project } from "../../domain/entities";
import { createReferenceProject } from "../../domain/fixtures";
import { TICKS_PER_BAR } from "../../domain/time";
import { deriveTrackLaneRows, rulerBars, songLengthBars } from "./trackLanes";

function projectWithReturn(): Project {
  const project = createReferenceProject({
    trackCount: 3,
    placementCount: 6,
    minutes: 1,
    automationLaneCount: 0,
  });
  const bus = {
    id: "ret_a",
    name: "Reverb",
    order: 0,
    devices: [],
    mixer: { ...project.song.master, muted: true },
  } as unknown as Project["song"]["returns"][number];
  return { ...project, song: { ...project.song, returns: [bus] } };
}

describe("deriveTrackLaneRows", () => {
  const project = projectWithReturn();
  const rows = deriveTrackLaneRows(project);
  const tracks = [...project.song.tracks].sort((a, b) => a.order - b.order);

  it("lists tracks in arrangement order, then returns", () => {
    expect(rows.map((row) => row.id)).toEqual([...tracks.map((t) => t.id), "ret_a"]);
    expect(rows.map((row) => row.fixed)).toEqual([false, false, false, true]);
  });

  it("carries the track's own colour and name, and a return has no colour", () => {
    expect(rows[0]).toMatchObject({ name: tracks[0]?.name, color: tracks[0]?.color });
    expect(rows[3]).toMatchObject({
      name: "Reverb",
      color: null,
      muted: true,
      lanes: [],
    });
  });

  it("turns each placement into a span in bars", () => {
    const placements = project.song.placements
      .filter((p) => p.trackId === rows[0]?.id)
      .sort((a, b) => a.startTicks - b.startTicks);
    expect(placements.length).toBeGreaterThan(0);
    expect(rows[0]?.lanes).toEqual(
      placements.map((p) => ({
        startBar: p.startTicks / TICKS_PER_BAR,
        lengthBars: p.durationTicks / TICKS_PER_BAR,
      })),
    );
  });
});

describe("songLengthBars and rulerBars", () => {
  const row = (lanes: { startBar: number; lengthBars: number }[]) => ({
    id: "t",
    name: "T",
    color: null,
    muted: false,
    fixed: false,
    lanes,
  });

  it("rounds the last clip's end up to a whole bar, with a one bar floor", () => {
    expect(songLengthBars([row([{ startBar: 2, lengthBars: 1.5 }])])).toBe(4);
    expect(songLengthBars([row([])])).toBe(1);
  });

  it("labels bar 1 and every 16 bars", () => {
    expect(rulerBars(40)).toEqual([1, 17, 33]);
    expect(rulerBars(16)).toEqual([1, 17]);
    expect(rulerBars(8)).toEqual([1]);
  });
});
