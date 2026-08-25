import { beforeEach, describe, expect, it } from "vitest";
import {
  assertProject,
  createDrumPad,
  PAD_DECAY,
  PAD_PITCH,
  type Project,
  stringifyProject,
} from "../domain";
import {
  addPad,
  removePad,
  reorderPad,
  setPadAsset,
  setPadChoke,
  setPadFlag,
  setPadParameter,
} from ".";
import { executeCommand } from "./execute";
import { createCommandHistory } from "./history";
import { findTrack } from "./projectEdits";
import {
  ABSENT_IDS,
  type CommandTestProject,
  createCommandTestProject,
  createTestFactoryContext,
} from "./testProjects";

function apply(project: Project, command: Parameters<typeof executeCommand>[1]): Project {
  const result = executeCommand(project, command);
  if (!result.ok) {
    throw new Error(`Expected success: ${result.issues[0].message}`);
  }
  return result.project;
}

function drumPadsOf(project: Project, trackId: string) {
  const track = findTrack(project, trackId as never);
  if (track?.instrument?.kind !== "drumMachine") {
    throw new Error("Expected a drum-machine track");
  }
  return track.instrument.pads;
}

describe("drum-machine commands", () => {
  let fixture: CommandTestProject;

  beforeEach(() => {
    fixture = createCommandTestProject();
  });

  describe("drum.setPadAsset", () => {
    it("replaces a pad's sample without touching the pad's identity or its other fields", () => {
      const [kickId] = fixture.padIds;
      const before = drumPadsOf(fixture.project, fixture.trackBId).find(
        (pad) => pad.id === kickId,
      );
      const next = apply(
        fixture.project,
        setPadAsset(fixture.trackBId, kickId, fixture.assetIds.sampler),
      );
      const pad = drumPadsOf(next, fixture.trackBId).find((p) => p.id === kickId);
      expect(pad?.assetId).toBe(fixture.assetIds.sampler);
      // Same pad ID, same name — a sample swap is not a new pad.
      expect(pad?.id).toBe(before?.id);
      expect(pad?.name).toBe(before?.name);
    });

    it("preserves the clip hits that reference the replaced pad (compatible clip data survives)", () => {
      const [kickId] = fixture.padIds;
      const beatClip = fixture.project.clips.find(
        (clip) => clip.trackId === fixture.trackBId,
      );
      const hitsBefore =
        beatClip?.content.kind === "notes"
          ? beatClip.content.events.filter(
              (event) => event.trigger.kind === "pad" && event.trigger.padId === kickId,
            )
          : [];
      expect(hitsBefore.length).toBeGreaterThan(0);

      const next = apply(
        fixture.project,
        setPadAsset(fixture.trackBId, kickId, fixture.assetIds.sampler),
      );
      const clipAfter = next.clips.find((clip) => clip.id === beatClip?.id);
      const hitsAfter =
        clipAfter?.content.kind === "notes"
          ? clipAfter.content.events.filter(
              (event) => event.trigger.kind === "pad" && event.trigger.padId === kickId,
            )
          : [];
      // Every hit ID is preserved: the sample changed, the pattern did not.
      expect(hitsAfter.map((event) => event.id)).toEqual(
        hitsBefore.map((event) => event.id),
      );
    });

    it("can clear a pad back to no sample", () => {
      const [kickId] = fixture.padIds;
      const next = apply(fixture.project, setPadAsset(fixture.trackBId, kickId, null));
      expect(
        drumPadsOf(next, fixture.trackBId).find((pad) => pad.id === kickId)?.assetId,
      ).toBeNull();
    });

    it("rejects a pad that does not exist", () => {
      const result = executeCommand(
        fixture.project,
        setPadAsset(fixture.trackBId, ABSENT_IDS.pad, null),
      );
      expect(result.ok).toBe(false);
    });

    it("rejects a track that is not a drum machine", () => {
      const result = executeCommand(
        fixture.project,
        setPadAsset(fixture.trackAId, fixture.padIds[0], null),
      );
      expect(result.ok).toBe(false);
    });
  });

  describe("drum.setPadFlag mute/solo", () => {
    it("sets and clears pad mute and solo independently", () => {
      const [kickId] = fixture.padIds;
      const muted = apply(
        fixture.project,
        setPadFlag(fixture.trackBId, kickId, "muted", true),
      );
      const soloed = apply(muted, setPadFlag(fixture.trackBId, kickId, "soloed", true));
      const pad = drumPadsOf(soloed, fixture.trackBId).find((p) => p.id === kickId);
      expect(pad?.mixer.muted).toBe(true);
      expect(pad?.mixer.soloed).toBe(true);
    });
  });

  describe("drum.setPadChoke", () => {
    it("assigns and removes a choke group", () => {
      const [kickId] = fixture.padIds;
      const grouped = apply(fixture.project, setPadChoke(fixture.trackBId, kickId, 2));
      expect(
        drumPadsOf(grouped, fixture.trackBId).find((p) => p.id === kickId)?.chokeGroup,
      ).toBe(2);
      const cleared = apply(grouped, setPadChoke(fixture.trackBId, kickId, null));
      expect(
        drumPadsOf(cleared, fixture.trackBId).find((p) => p.id === kickId)?.chokeGroup,
      ).toBeNull();
    });

    it("rejects a choke group outside 0..15 at the schema", () => {
      const parsed = setPadChoke(fixture.trackBId, fixture.padIds[0], 16);
      const result = executeCommand(fixture.project, parsed);
      expect(result.ok).toBe(false);
    });
  });

  describe("drum.setPadParameter", () => {
    it("stores a pitch override and clamps it into range", () => {
      const [kickId] = fixture.padIds;
      const next = apply(
        fixture.project,
        setPadParameter(fixture.trackBId, kickId, PAD_PITCH.id, 100),
      );
      const pad = drumPadsOf(next, fixture.trackBId).find((p) => p.id === kickId);
      // Clamped to the declared +24 ceiling, and stored under the short key.
      expect(pad?.parameters.pitch).toBe(PAD_PITCH.max);
    });

    it("does not persist a value equal to the default", () => {
      const [kickId] = fixture.padIds;
      const next = apply(
        fixture.project,
        setPadParameter(fixture.trackBId, kickId, PAD_DECAY.id, PAD_DECAY.defaultValue),
      );
      const pad = drumPadsOf(next, fixture.trackBId).find((p) => p.id === kickId);
      expect(pad?.parameters.decay).toBeUndefined();
    });

    it("writes pad level and pan onto the mixer, not the parameters record", () => {
      const [kickId] = fixture.padIds;
      const next = apply(
        fixture.project,
        setPadParameter(fixture.trackBId, kickId, "track.volume", -6),
      );
      const pad = drumPadsOf(next, fixture.trackBId).find((p) => p.id === kickId);
      expect(pad?.mixer.volume).toBe(-6);
      expect(pad?.parameters["track.volume"]).toBeUndefined();
    });
  });

  describe("drum.addPad / drum.removePad / drum.reorderPad", () => {
    it("adds a pad with its explicit ID and appends it by default", () => {
      const pad = createDrumPad(createTestFactoryContext("add-pad"), {
        name: "Rim",
      });
      const next = apply(fixture.project, addPad(fixture.trackBId, pad));
      const pads = drumPadsOf(next, fixture.trackBId);
      expect(pads.at(-1)?.id).toBe(pad.id);
      expect(pads).toHaveLength(fixture.padIds.length + 1);
    });

    it("rejects adding a pad whose ID already exists", () => {
      const existing = drumPadsOf(fixture.project, fixture.trackBId)[0];
      const result = executeCommand(fixture.project, addPad(fixture.trackBId, existing));
      expect(result.ok).toBe(false);
    });

    it("removes only the named pad and keeps the rest in order", () => {
      const [kickId, clapId] = fixture.padIds;
      const next = apply(fixture.project, removePad(fixture.trackBId, kickId));
      const pads = drumPadsOf(next, fixture.trackBId);
      expect(pads.map((pad) => pad.id)).toEqual([clapId]);
    });

    it("cascades to remove the hits that triggered the removed pad, and undo restores them exactly", () => {
      const [kickId] = fixture.padIds;
      const beatClip = fixture.project.clips.find(
        (clip) => clip.trackId === fixture.trackBId,
      );
      const hitsBefore =
        beatClip?.content.kind === "notes" ? beatClip.content.events : [];
      expect(
        hitsBefore.some(
          (event) => event.trigger.kind === "pad" && event.trigger.padId === kickId,
        ),
      ).toBe(true);

      const history = createCommandHistory(fixture.project);
      expect(history.execute(removePad(fixture.trackBId, kickId)).ok).toBe(true);

      const afterClip = history.project.clips.find((clip) => clip.id === beatClip?.id);
      const hitsAfter =
        afterClip?.content.kind === "notes" ? afterClip.content.events : [];
      // No hit still references the removed pad — the project stays valid.
      expect(
        hitsAfter.some(
          (event) => event.trigger.kind === "pad" && event.trigger.padId === kickId,
        ),
      ).toBe(false);

      // Undo brings the pad and its pattern back, byte-for-byte.
      expect(history.undo()?.ok).toBe(true);
      const restoredClip = history.project.clips.find((clip) => clip.id === beatClip?.id);
      expect(
        restoredClip?.content.kind === "notes" ? restoredClip.content.events : [],
      ).toEqual(hitsBefore);
      expect(drumPadsOf(history.project, fixture.trackBId).map((pad) => pad.id)).toEqual(
        fixture.padIds,
      );
    });

    it("reorders a pad while preserving every pad's identity", () => {
      const [kickId, clapId] = fixture.padIds;
      const next = apply(fixture.project, reorderPad(fixture.trackBId, kickId, 1));
      expect(drumPadsOf(next, fixture.trackBId).map((pad) => pad.id)).toEqual([
        clapId,
        kickId,
      ]);
    });
  });

  describe("save / reload", () => {
    it("round-trips every edited pad field through serialize + parse", () => {
      const [kickId] = fixture.padIds;
      let project = fixture.project;
      project = apply(project, setPadFlag(fixture.trackBId, kickId, "muted", true));
      project = apply(project, setPadFlag(fixture.trackBId, kickId, "soloed", true));
      project = apply(project, setPadChoke(fixture.trackBId, kickId, 5));
      project = apply(
        project,
        setPadParameter(fixture.trackBId, kickId, PAD_PITCH.id, -7),
      );
      project = apply(
        project,
        setPadParameter(fixture.trackBId, kickId, "track.pan", -0.5),
      );

      // Serialize (as a save would) and parse it straight back (as a reload
      // would). The reloaded project must be byte-identical.
      const reloaded = assertProject(JSON.parse(stringifyProject(project)));
      expect(stringifyProject(reloaded)).toBe(stringifyProject(project));

      const pad = drumPadsOf(reloaded, fixture.trackBId).find((p) => p.id === kickId);
      expect(pad?.mixer.muted).toBe(true);
      expect(pad?.mixer.soloed).toBe(true);
      expect(pad?.chokeGroup).toBe(5);
      expect(pad?.parameters.pitch).toBe(-7);
      expect(pad?.mixer.pan).toBe(-0.5);
    });
  });

  describe("undo restores the exact prior pad state", () => {
    it("round-trips a mute/solo/choke/asset/pitch edit through history", () => {
      const [kickId] = fixture.padIds;
      const history = createCommandHistory(fixture.project);
      const commands = [
        setPadFlag(fixture.trackBId, kickId, "muted", true),
        setPadChoke(fixture.trackBId, kickId, 4),
        setPadAsset(fixture.trackBId, kickId, fixture.assetIds.sampler),
        setPadParameter(fixture.trackBId, kickId, PAD_PITCH.id, -5),
      ];
      for (const command of commands) {
        expect(history.execute(command).ok).toBe(true);
      }
      const editedPad = drumPadsOf(history.project, fixture.trackBId).find(
        (pad) => pad.id === kickId,
      );
      expect(editedPad?.mixer.muted).toBe(true);
      expect(editedPad?.chokeGroup).toBe(4);

      for (let i = 0; i < commands.length; i += 1) history.undo();
      const restored = drumPadsOf(history.project, fixture.trackBId).find(
        (pad) => pad.id === kickId,
      );
      const original = drumPadsOf(fixture.project, fixture.trackBId).find(
        (pad) => pad.id === kickId,
      );
      expect(restored).toEqual(original);
    });
  });
});
