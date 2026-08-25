import { beforeEach, describe, expect, it } from "vitest";
import {
  MASTER_VOLUME,
  type Project,
  RETURN_VOLUME,
  registerParameter,
  SONG_TEMPO,
  TRACK_PAN,
  TRACK_SEND_LEVEL,
  TRACK_VOLUME,
} from "../domain";
import { setParameter } from ".";
import { executeCommand } from "./execute";
import { findTrack } from "./projectEdits";
import {
  ABSENT_IDS,
  type CommandTestProject,
  createCommandTestProject,
  TEST_DEVICE_PARAMETER,
  TEST_DEVICE_TYPE,
} from "./testProjects";

// Alpha Milestone 1 authors real device parameters; this stands in for one so the
// generic command can be tested against a registered device definition.
const DEVICE_TIME = registerParameter({
  id: `${TEST_DEVICE_TYPE}.${TEST_DEVICE_PARAMETER}`,
  label: "Delay time",
  unit: "seconds",
  min: 0,
  max: 2,
  defaultValue: 0.25,
  automatable: true,
});

function apply(project: Project, command: Parameters<typeof executeCommand>[1]): Project {
  const result = executeCommand(project, command);
  if (!result.ok) {
    throw new Error(`Expected success: ${result.issues[0].message}`);
  }
  return result.project;
}

describe("parameter.set", () => {
  let fixture: CommandTestProject;

  beforeEach(() => {
    fixture = createCommandTestProject();
  });

  it("sets the song tempo", () => {
    const next = apply(
      fixture.project,
      setParameter({ scope: "song", parameterId: SONG_TEMPO.id }, 128),
    );
    expect(next.song.tempo).toBe(128);
  });

  it("sets track volume and pan", () => {
    const volume = apply(
      fixture.project,
      setParameter(
        {
          scope: "track",
          trackId: fixture.trackAId,
          parameterId: TRACK_VOLUME.id,
        },
        -6,
      ),
    );
    expect(findTrack(volume, fixture.trackAId)?.mixer.volume).toBe(-6);

    const panned = apply(
      volume,
      setParameter(
        {
          scope: "track",
          trackId: fixture.trackAId,
          parameterId: TRACK_PAN.id,
        },
        -0.5,
      ),
    );
    expect(findTrack(panned, fixture.trackAId)?.mixer.pan).toBe(-0.5);
    expect(findTrack(panned, fixture.trackAId)?.mixer.volume).toBe(-6);
  });

  it("sets a send level", () => {
    const next = apply(
      fixture.project,
      setParameter(
        {
          scope: "send",
          trackId: fixture.trackAId,
          returnId: fixture.returnId,
          parameterId: TRACK_SEND_LEVEL.id,
        },
        0.8,
      ),
    );
    expect(findTrack(next, fixture.trackAId)?.sendConfig[0].level).toBe(0.8);
  });

  it("sets a return bus and master volume", () => {
    const next = apply(
      fixture.project,
      setParameter(
        {
          scope: "return",
          returnId: fixture.returnId,
          parameterId: RETURN_VOLUME.id,
        },
        -3,
      ),
    );
    expect(next.song.returns[0].mixer.volume).toBe(-3);

    const mastered = apply(
      next,
      setParameter({ scope: "master", parameterId: MASTER_VOLUME.id }, -1),
    );
    expect(mastered.song.master.volume).toBe(-1);
  });

  it("sets a registered device parameter", () => {
    const next = apply(
      fixture.project,
      setParameter(
        {
          scope: "trackDevice",
          trackId: fixture.trackAId,
          deviceId: fixture.deviceId,
          parameterId: TEST_DEVICE_PARAMETER,
        },
        1.5,
      ),
    );
    expect(
      findTrack(next, fixture.trackAId)?.devices[0].parameters[TEST_DEVICE_PARAMETER],
    ).toBe(1.5);
    expect(DEVICE_TIME.max).toBe(2);
  });

  it("clamps to the definition's range instead of storing an illegal value", () => {
    const next = apply(
      fixture.project,
      setParameter(
        {
          scope: "track",
          trackId: fixture.trackAId,
          parameterId: TRACK_VOLUME.id,
        },
        999,
      ),
    );
    expect(findTrack(next, fixture.trackAId)?.mixer.volume).toBe(TRACK_VOLUME.max);
  });

  it("rejects a non-finite value", () => {
    const result = executeCommand(
      fixture.project,
      setParameter({ scope: "song", parameterId: SONG_TEMPO.id }, Number.NaN),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0].code).toBe("invalid_payload");
  });

  it("rejects a parameter that does not belong to the target", () => {
    const result = executeCommand(
      fixture.project,
      setParameter(
        {
          scope: "track",
          trackId: fixture.trackAId,
          parameterId: SONG_TEMPO.id,
        },
        120,
      ),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0].message).toMatch(/is not a parameter of this target/);
  });

  it("rejects an unregistered device parameter", () => {
    const result = executeCommand(
      fixture.project,
      setParameter(
        {
          scope: "trackDevice",
          trackId: fixture.trackAId,
          deviceId: fixture.deviceId,
          parameterId: "mystery",
        },
        1,
      ),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0].message).toMatch(/no registered parameter/);
  });

  it("rejects a missing track, device, or return bus", () => {
    for (const target of [
      {
        scope: "track" as const,
        trackId: ABSENT_IDS.track,
        parameterId: TRACK_VOLUME.id,
      },
      {
        scope: "trackDevice" as const,
        trackId: fixture.trackAId,
        deviceId: ABSENT_IDS.device,
        parameterId: TEST_DEVICE_PARAMETER,
      },
      {
        scope: "return" as const,
        returnId: ABSENT_IDS.return,
        parameterId: RETURN_VOLUME.id,
      },
      {
        scope: "send" as const,
        trackId: fixture.trackBId,
        returnId: fixture.returnId,
        parameterId: TRACK_SEND_LEVEL.id,
      },
    ]) {
      const result = executeCommand(fixture.project, setParameter(target, 0.5));
      expect(result.ok, `${target.scope} should reject`).toBe(false);
    }
  });

  it("summarizes with the parameter's label and unit", () => {
    const result = executeCommand(
      fixture.project,
      setParameter(
        {
          scope: "track",
          trackId: fixture.trackAId,
          parameterId: TRACK_VOLUME.id,
        },
        -6,
      ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary).toBe("Set Track volume to -6 dB");
  });
});
