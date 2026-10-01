import { describe, expect, it, vi } from "vitest";
import { Analytics } from "../../analytics/analytics";
import { createSliceFixtureProject } from "../../domain/fixtures";
import {
  estimateStemExport,
  type StemExportOptions,
} from "../../export/stems/exportStems";
import { createManualClock } from "../../shared/clock";
import {
  estimateStemsFile,
  exportStemsBatch,
  exportStemsFile,
  planStemsFiles,
  stemsBatchFileName,
  stemsFileName,
} from "./stemsExport";
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

describe("stemsBatchFileName", () => {
  const date = new Date(2026, 8, 29);
  it("is the single ZIP's own name for one ZIP", () => {
    expect(stemsBatchFileName("My Song", date, 0, 1)).toBe(
      stemsFileName("My Song", date),
    );
  });

  it("numbers ZIPs `1 of N` from 1", () => {
    expect(stemsBatchFileName("a/b", date, 0, 3)).toBe("a b 2026-09-29 stems 1 of 3.zip");
    expect(stemsBatchFileName("a/b", date, 2, 3)).toBe("a b 2026-09-29 stems 3 of 3.zip");
  });
});

describe("planStemsFiles and exportStemsBatch", () => {
  it("plans one batch within budget and several over it", () => {
    const project = createSliceFixtureProject();
    expect(planStemsFiles(project)).toHaveLength(1);
    const tight = estimateStemsFile(project).bytes / 2;
    expect(planStemsFiles(project, undefined, tight).length).toBeGreaterThan(1);
  });

  it("builds one batch's files under its own numbered name", async () => {
    const project = createSliceFixtureProject();
    const maxBytes = estimateStemsFile(project).bytes / 2;
    const batches = planStemsFiles(project, undefined, maxBytes);
    const calls: StemExportOptions[] = [];
    const exportStems = vi.fn(async (_project, options: StemExportOptions) => {
      calls.push(options);
      return { parts: [new Uint8Array([7])], byteLength: 1, frames: 0 };
    });
    const clock = createManualClock(new Date(2026, 0, 2, 12).getTime());
    const file = await exportStemsBatch(project, {
      batch: batches[1],
      count: batches.length,
      startedAt: 5,
      maxBytes,
      clock,
      exportStems,
    });
    expect(calls[0]).toMatchObject({
      stems: batches[1].paths,
      maxBytes,
      batch: { index: 1, count: batches.length, startedAt: 5 },
    });
    expect(file.fileName).toBe(
      `${project.metadata.name} 2026-01-02 stems 2 of ${batches.length}.zip`,
    );
  });
});
