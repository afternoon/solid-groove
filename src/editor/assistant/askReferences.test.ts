import { describe, expect, it } from "vitest";
import { setParameter } from "../../commands";
import { createReferenceProject } from "../../domain/fixtures";
import { SONG_TEMPO } from "../../domain/parameters";
import { TICKS_PER_BAR } from "../../domain/time";
import {
  auditionTrigger,
  canHearIn,
  previewCommands,
  referenceBands,
  referenceLabel,
  referenceSelection,
} from "./askReferences";

const project = createReferenceProject();
const placement = project.song.placements[0];
if (!placement) throw new Error("the reference project needs a placement");
const clip = project.clips.find((candidate) => candidate.id === placement.clipId);
const track = project.song.tracks.find((candidate) => candidate.id === placement.trackId);
if (!clip || !track) throw new Error("the placement's clip and track must exist");
const trackIds = project.song.tracks.map((candidate) => candidate.id);

describe("what a question's option points at (GRV-42)", () => {
  it("draws a track as its whole row, past the last clip", () => {
    const [band] = referenceBands(project, { kind: "track", trackId: track.id });
    expect(band?.trackIds).toEqual([track.id]);
    expect(band?.startTicks).toBe(0);
    const lastEnd = Math.max(
      ...project.song.placements.map((p) => p.startTicks + p.durationTicks),
    );
    expect(band?.endTicks).toBeGreaterThan(lastEnd);
  });

  it("draws a clip as every placement of it", () => {
    const bands = referenceBands(project, { kind: "clip", clipId: clip.id });
    const placements = project.song.placements.filter((p) => p.clipId === clip.id);
    expect(bands).toEqual(
      placements.map((p) => ({
        trackIds: [p.trackId],
        startTicks: p.startTicks,
        endTicks: p.startTicks + p.durationTicks,
      })),
    );
  });

  it("draws a bar range across every track, its last bar included", () => {
    expect(referenceBands(project, { kind: "bars", startBar: 2, endBar: 3 })).toEqual([
      { trackIds, startTicks: TICKS_PER_BAR, endTicks: 3 * TICKS_PER_BAR },
    ]);
  });

  it("draws nothing for what the project does not have", () => {
    expect(referenceBands(project, { kind: "track", trackId: "trk_gone" })).toEqual([]);
    expect(referenceBands(project, { kind: "clip", clipId: "clp_gone" })).toEqual([]);
  });

  it("selects a track by pointing at it, and a clip by selecting its placements", () => {
    expect(referenceSelection(project, { kind: "track", trackId: track.id })).toEqual({
      trackId: track.id,
      arrangement: null,
    });
    const placements = project.song.placements.filter((p) => p.clipId === clip.id);
    expect(referenceSelection(project, { kind: "clip", clipId: clip.id })).toEqual({
      trackId: clip.trackId,
      arrangement: { kind: "clips", placementIds: placements.map((p) => p.id) },
    });
    expect(referenceSelection(project, { kind: "track", trackId: "trk_gone" })).toEqual({
      trackId: null,
      arrangement: null,
    });
  });

  it("selects the clips a bar range touches, as a band over it would", () => {
    const bar = Math.floor(placement.startTicks / TICKS_PER_BAR) + 1;
    const selection = referenceSelection(project, {
      kind: "bars",
      startBar: bar,
      endBar: bar,
    });
    expect(selection.trackId).toBeNull();
    expect(
      selection.arrangement?.kind === "clips" && selection.arrangement.placementIds,
    ).toContain(placement.id);
    expect(
      referenceSelection(project, { kind: "bars", startBar: 9000, endBar: 9001 })
        .arrangement,
    ).toBeNull();
  });

  it("says what it names, in the project's own words", () => {
    expect(referenceLabel(project, { kind: "track", trackId: track.id })).toBe(
      `Track ${track.name}`,
    );
    expect(referenceLabel(project, { kind: "clip", clipId: clip.id })).toBe(
      `Clip ${clip.name}`,
    );
    expect(referenceLabel(project, { kind: "bars", startBar: 13, endBar: 16 })).toBe(
      "Bars 13–16",
    );
    expect(referenceLabel(project, { kind: "bars", startBar: 5, endBar: 5 })).toBe(
      "Bar 5",
    );
    expect(referenceLabel(project, { kind: "track", trackId: "trk_gone" })).toBeNull();
  });
});

describe("what a question's option sounds like (GRV-42)", () => {
  it("plays a track's instrument: middle C, or a drum machine's first pad", () => {
    for (const candidate of project.song.tracks) {
      const trigger = auditionTrigger(candidate);
      if (!candidate.instrument) expect(trigger).toBeNull();
      else if (candidate.instrument.kind === "drumMachine") {
        expect(trigger).toEqual({ kind: "pad", padId: candidate.instrument.pads[0]?.id });
      } else expect(trigger).toEqual({ kind: "pitch", pitch: 60 });
    }
  });

  it("previews changes only when they would apply, and applies nothing", () => {
    const slower = setParameter({ scope: "song", parameterId: SONG_TEMPO.id }, 100);
    const valid = {
      kind: "preview" as const,
      calls: [{ name: "parameter_set", input: { ...slower.payload } }],
    };
    expect(previewCommands(project, valid)).toEqual([
      expect.objectContaining({ type: "parameter.set", payload: slower.payload }),
    ]);
    expect(canHearIn(project, valid)).toBe(true);
    const outOfRange = {
      kind: "preview" as const,
      calls: [{ name: "parameter_set", input: { ...slower.payload, value: 9999 } }],
    };
    expect(previewCommands(project, outOfRange)).toBeNull();
    expect(canHearIn(project, outOfRange)).toBe(false);
    expect(canHearIn(project, { kind: "track", trackId: "trk_gone" })).toBe(false);
    expect(project.song.tempo).not.toBe(100);
  });
});
