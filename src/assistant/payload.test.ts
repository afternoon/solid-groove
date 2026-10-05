import { describe, expect, it } from "vitest";
import {
  createDrumMachineFixtureProject,
  createReferenceProject,
  createSliceFixtureProject,
} from "../domain/fixtures";
import { selectOnly } from "../selection/selection";
import { buildAssistantPayload } from "./payload";
import { assistantContextPayloadSchema } from "./protocol";

describe("buildAssistantPayload", () => {
  it("is what the gateway's allowlist schema accepts", () => {
    for (const project of [
      createSliceFixtureProject(),
      createReferenceProject(),
      createDrumMachineFixtureProject(),
    ]) {
      const selection = selectOnly({ kind: "track", id: project.song.tracks[0].id });
      for (const payload of [
        buildAssistantPayload(project),
        buildAssistantPayload(project, selection),
      ]) {
        expect(assistantContextPayloadSchema.parse(payload)).toEqual(payload);
      }
    }
  });

  it("carries ADR 0007's allowlist and nothing else", () => {
    const payload = buildAssistantPayload(createReferenceProject());
    expect(Object.keys(payload).sort()).toEqual(
      [
        "noteStats",
        "projectName",
        "sections",
        "selectedNotes",
        "selection",
        "tempo",
        "timeSignature",
        "totalTicks",
        "tracks",
      ].sort(),
    );
  });

  it("never carries the project's ID, its owner, a clip's name, an asset or a URL", () => {
    const project = createDrumMachineFixtureProject();
    const selection = selectOnly({ kind: "track", id: project.song.tracks[0].id });
    const serialized = JSON.stringify(buildAssistantPayload(project, selection));
    expect(serialized).not.toContain(project.metadata.id);
    expect(serialized).not.toContain(project.metadata.ownerId);
    for (const clip of project.clips) expect(serialized).not.toContain(`"${clip.name}"`);
    for (const asset of project.song.assets) expect(serialized).not.toContain(asset.id);
    expect(serialized).not.toMatch(/https?:|gs:\/\//);
  });

  it("sends no note events at all when nothing is selected", () => {
    const project = createReferenceProject();
    const payload = buildAssistantPayload(project);
    expect(payload.selectedNotes).toBeNull();
    const serialized = JSON.stringify(payload);
    for (const clip of project.clips) {
      if (clip.content.kind !== "notes") continue;
      for (const event of clip.content.events) expect(serialized).not.toContain(event.id);
    }
  });

  it("sends the selected clip's notes and no other clip's", () => {
    const project = createReferenceProject();
    const noteClips = project.clips.filter(
      (clip) => clip.content.kind === "notes" && clip.content.events.length > 0,
    );
    const [chosen, ...others] = noteClips;
    const payload = buildAssistantPayload(
      project,
      selectOnly({ kind: "clip", id: chosen.id }),
    );
    const serialized = JSON.stringify(payload);
    expect(payload.selectedNotes?.clips.map((clip) => clip.clipId)).toEqual([chosen.id]);
    for (const clip of others) {
      if (clip.content.kind !== "notes") continue;
      for (const event of clip.content.events) expect(serialized).not.toContain(event.id);
    }
  });

  it("carries derived note statistics and each track's mixer state", () => {
    const project = createSliceFixtureProject();
    const payload = buildAssistantPayload(project);
    expect(payload.noteStats.song.noteCount).toBeGreaterThan(0);
    expect(payload.noteStats.tracks).toHaveLength(project.song.tracks.length);
    expect(payload.tracks[0]).toMatchObject({
      volume: project.song.tracks[0].mixer.volume,
      pan: project.song.tracks[0].mixer.pan,
    });
  });
});
