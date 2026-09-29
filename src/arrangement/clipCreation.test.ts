import { describe, expect, it } from "vitest";
import { executeTransaction } from "../commands/execute";
import type { Placement, Project } from "../domain/entities";
import { createFactoryContext, createPlacement } from "../domain/factories";
import { createPianoRollFixtureProject } from "../domain/fixtures";
import { createSeededIdFactory } from "../domain/ids";
import { TICKS_PER_BAR } from "../domain/time";
import { createClipAt } from "./clipCreation";

const BAR = TICKS_PER_BAR;
const shared = createFactoryContext({ ids: createSeededIdFactory("create-clip") });
const context = () => shared;

/** The fixture's synth track, holding only the placements `make` gives it. */
function withPlacements(make: (project: Project) => readonly Placement[]): Project {
  const project = createPianoRollFixtureProject();
  return { ...project, song: { ...project.song, placements: [...make(project)] } };
}

function place(project: Project, startTicks: number, durationTicks: number): Placement {
  return createPlacement(context(), {
    clipId: project.clips[0].id,
    trackId: project.song.tracks[0].id,
    startTicks,
    durationTicks,
  });
}

/** The placement a double-click at `tick` creates, run through the command layer. */
function createdAt(project: Project, tick: number) {
  const created = createClipAt(project, context(), project.song.tracks[0].id, tick);
  if (!created) return null;
  const result = executeTransaction(project, created.commands);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  const placement = result.project.song.placements.find(
    (candidate) => candidate.id === created.placementId,
  );
  const clip = result.project.clips.find(
    (candidate) => candidate.id === placement?.clipId,
  );
  return { placement, clip };
}

describe("createClipAt (#661)", () => {
  it("creates an empty one-bar clip at the start of the clicked bar", () => {
    const made = createdAt(
      withPlacements(() => []),
      BAR * 2.5,
    );
    expect(made?.placement?.startTicks).toBe(BAR * 2);
    expect(made?.placement?.durationTicks).toBe(BAR);
    expect(made?.clip?.lengthTicks).toBe(BAR);
    expect(made?.clip?.content).toEqual({ kind: "notes", events: [] });
  });

  it("fills only the free part of a bar another placement reaches into", () => {
    // One placement ends a beat into bar 3, another starts on its last beat.
    const project = withPlacements((p) => [
      place(p, BAR, BAR + BAR / 4),
      place(p, BAR * 2 + (BAR * 3) / 4, BAR),
    ]);
    const made = createdAt(project, BAR * 2.5);
    expect(made?.placement?.startTicks).toBe(BAR * 2 + BAR / 4);
    expect(made?.placement?.durationTicks).toBe(BAR / 2);
  });

  it("creates nothing on an audio track", () => {
    const project = withPlacements(() => []);
    const audio = {
      ...project,
      song: {
        ...project.song,
        tracks: project.song.tracks.map((track) => ({
          ...track,
          type: "audio" as const,
        })),
      },
    };
    expect(createClipAt(audio, context(), audio.song.tracks[0].id, BAR / 2)).toBeNull();
  });
});
