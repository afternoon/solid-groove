import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { Analytics } from "../../analytics/analytics";
import { ConsentStore } from "../../analytics/consent";
import { createRecordingTransport } from "../../analytics/transport";
import { createManualClock } from "../../shared/clock";
import { memoryStorage } from "../../testing/storage";
import { estimateStemExport, exportStems } from "./exportStems";
import { planStemBatches } from "./stemBatches";
import { createStemFixtureProject } from "./stemFixture";
import { planStems } from "./stemPlan";
import { concat, exportFailure, fakeRenderer } from "./stemTestSupport";

/** EXP-004: a stem export in ZIPs under the budget, and its one event trio. */

const RATE = 8_000;
const project = createStemFixtureProject();
const maxBytes = Math.floor(
  (estimateStemExport(project, { sampleRate: RATE }).bytes / 5) * 2.5,
);
const batches = planStemBatches(project, { sampleRate: RATE, maxBytes });

function recordingAnalytics() {
  const transport = createRecordingTransport();
  const consent = new ConsentStore(memoryStorage());
  consent.set({ productAnalytics: true, errorMonitoring: true });
  return {
    analytics: new Analytics({ transport, consent, storage: memoryStorage() }),
    transport,
  };
}

const batchOptions = (index: number, startedAt?: number) => ({
  sampleRate: RATE,
  maxBytes,
  stems: batches[index].paths,
  batch: { index, count: batches.length, startedAt },
});

describe("a batched stem export", () => {
  it("builds only its batch's files, with the mix in the first", async () => {
    const files: string[][] = [];
    for (const batch of batches) {
      const { render, calls } = fakeRenderer();
      const archive = await exportStems(project, {
        ...batchOptions(batch.index),
        render,
      });
      const paths = Object.keys(unzipSync(concat(archive.parts)));
      expect(paths.sort()).toEqual([...batch.paths].sort());
      expect(calls).toHaveLength(batch.paths.length);
      files.push(paths);
    }
    expect(files[0]).toContain("Reference mix.wav");
    expect(files.slice(1).flat()).not.toContain("Reference mix.wav");
    expect(files.flat().sort()).toEqual(
      planStems(project)
        .map((s) => s.path)
        .sort(),
    );
  });

  it("logs the event trio once across all ZIPs, with the ZIP count", async () => {
    const { analytics, transport } = recordingAnalytics();
    const clock = createManualClock(1_000);
    for (const batch of batches) {
      await exportStems(project, {
        ...batchOptions(batch.index, 1_000),
        analytics,
        clock,
        render: async (...args) => {
          clock.advance(3_000);
          return fakeRenderer().render(...args);
        },
      });
    }
    const zip_count = batches.length;
    expect(transport.named("export_started").map((e) => e.params)).toEqual([
      expect.objectContaining({ export_type: "stems", zip_count }),
    ]);
    expect(transport.named("export_completed").map((e) => e.params)).toEqual([
      expect.objectContaining({
        export_type: "stems",
        zip_count,
        elapsed_ms_bucket: "10_60s",
      }),
    ]);
    expect(transport.named("feature_first_use")).toHaveLength(1);
    expect(transport.named("export_failed")).toEqual([]);
  });

  it("logs failed once, and never completed, when a later ZIP fails", async () => {
    const { analytics, transport } = recordingAnalytics();
    const controller = new AbortController();
    controller.abort();
    await exportStems(project, {
      ...batchOptions(0),
      analytics,
      render: fakeRenderer().render,
    });
    const failure = await exportFailure(
      exportStems(project, {
        ...batchOptions(1),
        analytics,
        signal: controller.signal,
        render: fakeRenderer().render,
      }),
    );
    expect(failure.code).toBe("aborted");
    expect(transport.named("export_started")).toHaveLength(1);
    expect(transport.named("export_completed")).toEqual([]);
    expect(transport.named("export_failed").map((e) => e.params)).toEqual([
      expect.objectContaining({ error_code: "aborted", was_cancelled: true }),
    ]);
  });

  it("still refuses a ZIP that is over budget, such as a lone oversized stem", async () => {
    const tiny = planStemBatches(project, { sampleRate: RATE, maxBytes: 1 });
    const failure = await exportFailure(
      exportStems(project, {
        sampleRate: RATE,
        maxBytes: 1,
        stems: tiny[0].paths,
        render: fakeRenderer().render,
      }),
    );
    expect(failure.code).toBe("quota_exceeded");
  });
});
