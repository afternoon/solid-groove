import { describe, expect, it } from "vitest";
import type { Project } from "../domain/entities";
import { createFactoryContext, createSection } from "../domain/factories";
import {
  createDrumMachineFixtureProject,
  createReferenceProject,
  createSliceFixtureProject,
} from "../domain/fixtures";
import { createSeededIdFactory } from "../domain/ids";
import { derivePackDependencies } from "../domain/packs";
import { assertProject } from "../domain/parse";
import { TICKS_PER_BAR } from "../domain/time";
import { selectOnly } from "../selection/selection";
import {
  buildProjectAnalysis,
  MAX_RECENT_ACTIONS,
  MAX_SUGGESTIONS,
  type RecentAction,
  SUGGESTION_IDS,
  type SuggestionId,
} from "./projectAnalysisProjection";

/**
 * These tests assert deterministic *facts and invariants* about the analysis —
 * counts, ranges, ratios, boundedness, the set of suggestion ids — rather than
 * the exact wording of any label or rationale. Prose is allowed to change; the
 * facts it is grounded in are the contract (AI-002 acceptance criterion 3).
 */

function suggestionIds(project: Project): SuggestionId[] {
  return buildProjectAnalysis(project).suggestions.map((s) => s.id);
}

describe("buildProjectAnalysis", () => {
  it("is a pure function of the project — same input, equal fingerprint", () => {
    const a = buildProjectAnalysis(createSliceFixtureProject());
    const b = buildProjectAnalysis(createSliceFixtureProject());
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a).toEqual(b);
  });

  it("does not mutate the source project", () => {
    const project = createReferenceProject();
    const before = JSON.parse(JSON.stringify(project));
    buildProjectAnalysis(project, {
      recentActions: [{ actor: "user", summary: "Add note" }],
    });
    expect(JSON.parse(JSON.stringify(project))).toEqual(before);
  });

  describe("note, register, and velocity facts", () => {
    it("counts pitched notes and derives their register", () => {
      // The slice fixture is a four-on-the-floor kick clip: 4 notes at pitch 36.
      const analysis = buildProjectAnalysis(createSliceFixtureProject());
      const track = analysis.tracks[0];
      expect(track.notes.noteCount).toBe(4);
      expect(track.notes.padNoteCount).toBe(0);
      expect(track.notes.register).not.toBeNull();
      expect(track.notes.register?.lowestPitch).toBe(36);
      expect(track.notes.register?.highestPitch).toBe(36);
      expect(track.notes.register?.meanPitch).toBe(36);
      expect(track.notes.register?.distinctPitchClasses).toBe(1);
      expect(track.notes.meanVelocity).not.toBeNull();
    });

    it("reports drum-pad notes with a null register", () => {
      // The drum-machine fixture's beat triggers pads, so it has no pitch.
      const analysis = buildProjectAnalysis(createDrumMachineFixtureProject());
      const drumTrack = analysis.tracks.find((t) => t.name === "Drums");
      expect(drumTrack).toBeDefined();
      expect(drumTrack?.notes.noteCount).toBeGreaterThan(0);
      expect(drumTrack?.notes.padNoteCount).toBe(drumTrack?.notes.noteCount);
      expect(drumTrack?.notes.register).toBeNull();
    });

    it("captures a wider register across the reference project", () => {
      const analysis = buildProjectAnalysis(createReferenceProject());
      expect(analysis.song.notes.register).not.toBeNull();
      const register = analysis.song.notes.register;
      expect(register?.lowestPitch).toBeLessThan(register?.highestPitch ?? 0);
    });
  });

  describe("density", () => {
    it("measures notes per occupied bar, not per whole song", () => {
      // Slice: one 1-bar placement holding 4 notes => 4 notes/bar.
      const track = buildProjectAnalysis(createSliceFixtureProject()).tracks[0];
      expect(track.density?.notesPerBar).toBe(4);
      expect(track.density?.label).toBe("moderate");
    });

    it("is null for a track with nothing placed", () => {
      const base = createSliceFixtureProject();
      const project: Project = {
        ...base,
        song: { ...base.song, placements: [] },
      };
      const track = buildProjectAnalysis(project).tracks[0];
      expect(track.density).toBeNull();
    });
  });

  describe("repetition", () => {
    it("reports a high repetition ratio when one clip is placed many times", () => {
      // Reference: each track places its single clip many times.
      const analysis = buildProjectAnalysis(createReferenceProject());
      const track = analysis.tracks.find((t) => t.repetition.placementCount >= 4);
      expect(track).toBeDefined();
      expect(track?.repetition.distinctClipCount).toBe(1);
      expect(track?.repetition.repetitionRatio).toBe(1);
      expect(track?.repetition.mostRepeatedClipPlacements).toBe(
        track?.repetition.placementCount,
      );
    });

    it("reports zero repetition for a single placement", () => {
      const track = buildProjectAnalysis(createSliceFixtureProject()).tracks[0];
      expect(track.repetition.placementCount).toBe(1);
      expect(track.repetition.repetitionRatio).toBe(0);
    });
  });

  describe("mixer and device state", () => {
    it("carries volume, pan, mute, solo, sends, and device counts", () => {
      const track = buildProjectAnalysis(createSliceFixtureProject()).tracks[0];
      expect(track.mixer).toHaveProperty("volume");
      expect(track.mixer).toHaveProperty("pan");
      expect(track.mixer.muted).toBe(false);
      expect(track.mixer.soloed).toBe(false);
      expect(track.mixer.deviceCount).toBe(0);
      expect(track.mixer.bypassedDeviceCount).toBe(0);
    });

    it("counts muted and soloed tracks at the song level", () => {
      const base = createReferenceProject({ trackCount: 4 });
      const project: Project = {
        ...base,
        song: {
          ...base.song,
          tracks: base.song.tracks.map((track, index) =>
            index === 0
              ? { ...track, mixer: { ...track.mixer, muted: true } }
              : index === 1
                ? { ...track, mixer: { ...track.mixer, soloed: true } }
                : track,
          ),
        },
      };
      const analysis = buildProjectAnalysis(project);
      expect(analysis.song.mutedTrackCount).toBe(1);
      expect(analysis.song.soloedTrackCount).toBe(1);
    });
  });

  describe("recent actions", () => {
    it("keeps the newest actions, bounded, with only actor and summary", () => {
      const actions: RecentAction[] = Array.from({ length: 20 }, (_, i) => ({
        actor: i % 2 === 0 ? "user" : "assistant",
        summary: `Edit ${i}`,
      }));
      const analysis = buildProjectAnalysis(createSliceFixtureProject(), {
        recentActions: actions,
      });
      expect(analysis.recentActions).toHaveLength(MAX_RECENT_ACTIONS);
      expect(analysis.recentActions[0]).toEqual({
        actor: "user",
        summary: "Edit 0",
      });
      // Only actor + summary — no payloads or IDs leaked in.
      for (const action of analysis.recentActions) {
        expect(Object.keys(action).sort()).toEqual(["actor", "summary"]);
      }
    });

    it("defaults to an empty list", () => {
      const analysis = buildProjectAnalysis(createSliceFixtureProject());
      expect(analysis.recentActions).toEqual([]);
    });
  });

  describe("selection", () => {
    it("folds in a compact selection description, never raw scopes", () => {
      const project = createSliceFixtureProject();
      const analysis = buildProjectAnalysis(project, {
        selection: selectOnly({ kind: "track", id: project.song.tracks[0].id }),
      });
      expect(analysis.selection).toBe("1 track selected");
    });

    it("is null with no selection", () => {
      expect(buildProjectAnalysis(createSliceFixtureProject()).selection).toBeNull();
    });
  });

  describe("suggestions (AI-02)", () => {
    it("only ever emits ids from the published set, capped in count", () => {
      for (const project of [
        createSliceFixtureProject(),
        createDrumMachineFixtureProject(),
        createReferenceProject(),
      ]) {
        const ids = suggestionIds(project);
        expect(ids.length).toBeLessThanOrEqual(MAX_SUGGESTIONS);
        for (const id of ids) {
          expect(SUGGESTION_IDS).toContain(id);
        }
      }
    });

    it("suggests adding a track for an empty project", () => {
      const base = createSliceFixtureProject();
      const project: Project = {
        ...base,
        song: { ...base.song, tracks: [], placements: [] },
        clips: [],
      };
      expect(suggestionIds(project)).toEqual(["add_track"]);
    });

    it("suggests an arrangement when there is material but no sections", () => {
      // Slice fixture has a clip and no sections.
      expect(createSliceFixtureProject().song.sections).toHaveLength(0);
      expect(suggestionIds(createSliceFixtureProject())).toContain("create_arrangement");
    });

    it("suggests variation for a highly repetitive track", () => {
      expect(suggestionIds(createReferenceProject())).toContain("add_variation");
    });

    it("suggests a transition and balance from arrangement and mixer state", () => {
      const base = createReferenceProject({ trackCount: 4 });
      const project: Project = {
        ...base,
        song: {
          ...base.song,
          tracks: base.song.tracks.map((track, index) =>
            index === 0 ? { ...track, mixer: { ...track.mixer, soloed: true } } : track,
          ),
        },
      };
      const ids = suggestionIds(project);
      // Reference has >= 2 sections => transition; a soloed track => balance.
      expect(ids).toContain("build_transition");
      expect(ids).toContain("balance_section");
    });

    it("returns an empty list when no rule fires — suggestions never gate", () => {
      // The slice fixture is one track, one clip, one placement, no
      // mute/solo. Give it a single section so `create_arrangement` (needs
      // zero sections) and `build_transition` (needs >= 2) both stay silent,
      // and no repetition/empty-track/balance rule applies either.
      const base = createSliceFixtureProject();
      const context = createFactoryContext({
        ids: createSeededIdFactory("analysis-empty-suggestions"),
        now: 1_700_000_000_000,
      });
      const section = createSection(context, {
        name: "A",
        startTicks: 0,
        durationTicks: TICKS_PER_BAR,
      });
      const song = { ...base.song, sections: [section] };
      const project = assertProject({
        ...base,
        metadata: {
          ...base.metadata,
          packDependencies: derivePackDependencies(song),
        },
        song,
      });
      const analysis = buildProjectAnalysis(project);
      expect(analysis.suggestions).toEqual([]);
    });

    it("every suggestion cites a rationale and a scope", () => {
      const analysis = buildProjectAnalysis(createReferenceProject());
      for (const suggestion of analysis.suggestions) {
        expect(suggestion.rationale.length).toBeGreaterThan(0);
        expect(["song", "section", "track", "clip"]).toContain(suggestion.scope);
      }
    });
  });

  describe("missing context is explicit (AI-01)", () => {
    it("flags a project with no tracks", () => {
      const base = createSliceFixtureProject();
      const project: Project = {
        ...base,
        song: { ...base.song, tracks: [], placements: [] },
        clips: [],
      };
      const keys = buildProjectAnalysis(project).missing.map((m) => m.key);
      expect(keys).toContain("no_tracks");
      expect(keys).toContain("no_sections");
    });

    it("flags a project whose only notes are drum pads as having no pitched register", () => {
      // Build a project with ONLY the drum track (drop the audio-loop track).
      const base = createDrumMachineFixtureProject();
      const drumTrack = base.song.tracks.find((t) => t.name === "Drums");
      if (!drumTrack) throw new Error("expected a drum track");
      const drumClips = base.clips.filter((c) => c.trackId === drumTrack.id);
      const drumPlacements = base.song.placements.filter(
        (p) => p.trackId === drumTrack.id,
      );
      const project: Project = {
        ...base,
        song: {
          ...base.song,
          tracks: [drumTrack],
          placements: drumPlacements,
        },
        clips: drumClips,
      };
      const analysis = buildProjectAnalysis(project);
      expect(analysis.song.notes.register).toBeNull();
      expect(analysis.missing.map((m) => m.key)).toContain("no_pitched_notes");
    });

    it("has no missing entries for a fully-populated project", () => {
      const analysis = buildProjectAnalysis(createReferenceProject());
      expect(analysis.missing).toEqual([]);
    });
  });

  describe("boundedness and privacy (AI-01, AI-05)", () => {
    it("stays compact for the 40-track ten-minute reference project", () => {
      const project = createReferenceProject({ trackCount: 40 });
      const analysis = buildProjectAnalysis(project, {
        recentActions: Array.from({ length: 20 }, (_, i) => ({
          actor: "user" as const,
          summary: `Edit number ${i}`,
        })),
      });
      const serialized = JSON.stringify(analysis);
      // Bounded: per-track summaries are counts and ranges, not note dumps.
      // 40 tracks of compact facts stays well under this budget.
      expect(serialized.length).toBeLessThan(30_000);
      expect(analysis.tracks).toHaveLength(40);
    });

    it("scales sub-linearly with note count — a note edit does not bloat it", () => {
      const small = JSON.stringify(
        buildProjectAnalysis(createReferenceProject({ trackCount: 10 })),
      ).length;
      const large = JSON.stringify(
        buildProjectAnalysis(createReferenceProject({ trackCount: 10, minutes: 20 })),
      ).length;
      // Doubling arrangement length (many more notes/placements) must not
      // meaningfully change the analysis size — it carries counts, not events.
      expect(large).toBeLessThan(small * 1.2);
    });

    it("excludes account and raw-persistence data", () => {
      const project = createReferenceProject();
      const serialized = JSON.stringify(buildProjectAnalysis(project));
      // No owner, collaborators, timestamps, storage refs, asset URLs, revision.
      expect(serialized).not.toContain(project.metadata.ownerId);
      expect(serialized).not.toContain("ownerId");
      expect(serialized).not.toContain("collaboratorIds");
      expect(serialized).not.toContain("storageRef");
      expect(serialized).not.toContain("createdAt");
      expect(serialized).not.toContain("modifiedAt");
      expect(serialized).not.toContain("packDependencies");
      for (const asset of project.song.assets) {
        expect(serialized).not.toContain(asset.storageRef);
      }
    });
  });

  describe("empty and large states", () => {
    it("summarizes a completely empty project without throwing", () => {
      const base = createSliceFixtureProject();
      const project: Project = {
        ...base,
        song: {
          ...base.song,
          tracks: [],
          placements: [],
          sections: [],
          automation: [],
        },
        clips: [],
      };
      const analysis = buildProjectAnalysis(project);
      expect(analysis.tracks).toEqual([]);
      expect(analysis.song.trackCount).toBe(0);
      expect(analysis.song.notes.noteCount).toBe(0);
      expect(analysis.song.density).toBeNull();
    });

    it("summarizes the 50-track reference project with per-track facts", () => {
      const analysis = buildProjectAnalysis(createReferenceProject());
      expect(analysis.tracks).toHaveLength(50);
      expect(analysis.song.sectionCount).toBe(4);
    });
  });
});
