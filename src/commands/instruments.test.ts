import { beforeEach, describe, expect, it } from "vitest";
import {
  createSynthInstrument,
  createTrack,
  type Project,
  SAMPLER_PITCH,
} from "../domain";
import { addTrack, changeInstrument, setParameter, setSample } from ".";
import { executeCommand } from "./execute";
import { CommandHistory } from "./history";
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

describe("instrument parameter scope (parameter.set)", () => {
  let fixture: CommandTestProject;

  beforeEach(() => {
    fixture = createCommandTestProject();
  });

  it("sets a sampler instrument parameter, coerced by its definition", () => {
    const next = apply(
      fixture.project,
      setParameter(
        {
          scope: "instrument",
          trackId: fixture.trackAId,
          parameterId: "pitch",
        },
        7,
      ),
    );
    const track = findTrack(next, fixture.trackAId);
    expect(track?.instrument?.parameters.pitch).toBe(7);
  });

  it("clamps a sampler pitch above its range rather than storing it raw", () => {
    const next = apply(
      fixture.project,
      setParameter(
        {
          scope: "instrument",
          trackId: fixture.trackAId,
          parameterId: "pitch",
        },
        999,
      ),
    );
    const track = findTrack(next, fixture.trackAId);
    expect(track?.instrument?.parameters.pitch).toBe(SAMPLER_PITCH.max);
  });

  it("rejects a parameter the instrument kind does not own", () => {
    const result = executeCommand(
      fixture.project,
      // filterCutoff is a synth parameter; trackA is a sampler.
      setParameter(
        {
          scope: "instrument",
          trackId: fixture.trackAId,
          parameterId: "filterCutoff",
        },
        800,
      ),
    );
    expect(result.ok).toBe(false);
  });

  it("rejects setting an instrument parameter on a track with no instrument", () => {
    // A fresh track with no instrument at all.
    const bare = createTrack(createTestFactoryContext("bare-track"), {
      name: "Bare",
      order: 2,
    });
    const withBare = apply(fixture.project, addTrack(bare));
    const result = executeCommand(
      withBare,
      setParameter({ scope: "instrument", trackId: bare.id, parameterId: "pitch" }, 2),
    );
    expect(result.ok).toBe(false);
  });

  it("rejects an unknown track", () => {
    const result = executeCommand(
      fixture.project,
      setParameter(
        {
          scope: "instrument",
          trackId: ABSENT_IDS.track,
          parameterId: "pitch",
        },
        2,
      ),
    );
    expect(result.ok).toBe(false);
  });
});

describe("instrument.change", () => {
  let fixture: CommandTestProject;

  beforeEach(() => {
    fixture = createCommandTestProject();
  });

  it("replaces a track's instrument and preserves its clips", () => {
    const clipsBefore = fixture.project.clips.filter(
      (clip) => clip.trackId === fixture.trackAId,
    );
    const next = apply(
      fixture.project,
      changeInstrument(fixture.trackAId, createSynthInstrument()),
    );
    const track = findTrack(next, fixture.trackAId);
    expect(track?.instrument?.kind).toBe("synth");
    // Clips are separate from the track (invariant 3): swapping the instrument
    // leaves the note clips authored against it untouched.
    expect(next.clips.filter((clip) => clip.trackId === fixture.trackAId)).toEqual(
      clipsBefore,
    );
  });

  it("round-trips through undo/redo, restoring the exact previous instrument", () => {
    const history = new CommandHistory(fixture.project);
    const before = findTrack(history.project, fixture.trackAId)?.instrument;

    history.execute(changeInstrument(fixture.trackAId, createSynthInstrument()));
    expect(findTrack(history.project, fixture.trackAId)?.instrument?.kind).toBe("synth");

    history.undo();
    expect(findTrack(history.project, fixture.trackAId)?.instrument).toEqual(before);

    history.redo();
    expect(findTrack(history.project, fixture.trackAId)?.instrument?.kind).toBe("synth");
  });
});

describe("instrument.setSample", () => {
  let fixture: CommandTestProject;

  beforeEach(() => {
    fixture = createCommandTestProject();
  });

  function samplerAssetId(project: Project): string | null {
    const instrument = findTrack(project, fixture.trackAId)?.instrument;
    if (instrument?.kind !== "sampler") throw new Error("expected a sampler");
    return instrument.assetId;
  }

  it("replaces the sampler's asset while keeping its other settings", () => {
    // Give the sampler a distinctive parameter first, so we can prove the swap
    // preserves it (the "compatible clip data preserved" guarantee).
    const withPitch = apply(
      fixture.project,
      setParameter(
        {
          scope: "instrument",
          trackId: fixture.trackAId,
          parameterId: "pitch",
        },
        5,
      ),
    );
    const currentAssetId = samplerAssetId(withPitch);
    const otherAsset = withPitch.song.assets.find((asset) => asset.id !== currentAssetId);
    expect(otherAsset).toBeDefined();

    const next = apply(withPitch, setSample(fixture.trackAId, otherAsset?.id ?? null));
    const instrument = findTrack(next, fixture.trackAId)?.instrument;
    expect(instrument?.kind).toBe("sampler");
    if (instrument?.kind === "sampler") {
      expect(instrument.assetId).toBe(otherAsset?.id ?? null);
      expect(instrument.parameters.pitch).toBe(5);
    }
  });

  it("undo restores the previously loaded sample", () => {
    const history = new CommandHistory(fixture.project);
    const originalAsset = samplerAssetId(history.project);

    history.execute(setSample(fixture.trackAId, null));
    expect(samplerAssetId(history.project)).toBeNull();

    history.undo();
    expect(samplerAssetId(history.project)).toBe(originalAsset);
  });

  it("rejects loading a sample into a non-sampler instrument", () => {
    // trackB is a drum machine.
    const result = executeCommand(fixture.project, setSample(fixture.trackBId, null));
    expect(result.ok).toBe(false);
  });
});
