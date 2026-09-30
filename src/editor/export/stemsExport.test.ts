import { describe, expect, it, vi } from "vitest";
import { Analytics } from "../../analytics/analytics";
import { createSliceFixtureProject } from "../../domain/fixtures";
import {
  estimateStemExport,
  type StemExportOptions,
} from "../../export/stems/exportStems";
import { createManualClock } from "../../shared/clock";
import { estimateStemsFile, exportStemsFile, stemsFileName } from "./stemsExport";
import { projectSampleRate } from "./stereoExport";

describe("stemsFileName", () => {
  it("is `<project name> <YYYY-MM-DD> stems.zip`, with the name made safe", () => {
    const date = new Date(2026, 8, 29, 23, 59);
    expect(stemsFileName("My Song", date)).toBe("My Song 2026-09-29 stems.zip");
    expect(stemsFileName("a/b:c", date)).toBe("a b c 2026-09-29 stems.zip");
  });
});

describe("exportStemsFile", () => {
  it("exports at the project's rate and names the ZIP", async () => {
    const project = createSliceFixtureProject();
    const clock = createManualClock(new Date(2026, 0, 2, 12).getTime());
    const analytics = new Analytics();
    const calls: StemExportOptions[] = [];
    const exportStems = vi.fn(async (_project, options: StemExportOptions) => {
      calls.push(options);
      return { parts: [new Uint8Array([7])], byteLength: 1, frames: 0 };
    });
    const signal = new AbortController().signal;
    const trackIds = project.song.tracks.map((track) => track.id);
    const file = await exportStemsFile(project, {
      trackIds,
      signal,
      analytics,
      clock,
      exportStems,
    });
    expect(calls).toEqual([
      expect.objectContaining({
        trackIds,
        sampleRate: projectSampleRate(project),
        signal,
        analytics,
      }),
    ]);
    expect(file.blob.type).toBe("application/zip");
    expect(file.blob.size).toBe(1);
    expect(file.fileName).toBe(`${project.metadata.name} 2026-01-02 stems.zip`);
  });
});

describe("estimateStemsFile", () => {
  it("estimates at the project's own rate", () => {
    const project = createSliceFixtureProject();
    const estimate = estimateStemsFile(project);
    expect(estimate.fits).toBe(true);
    const sampleRate = projectSampleRate(project);
    expect(estimate).toEqual(estimateStemExport(project, { sampleRate }));
  });
});
