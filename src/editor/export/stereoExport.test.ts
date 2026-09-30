import { describe, expect, it } from "vitest";
import { Analytics } from "../../analytics/analytics";
import { ConsentStore } from "../../analytics/consent";
import {
  createFailingTransport,
  createRecordingTransport,
} from "../../analytics/transport";
import { OfflineRenderError } from "../../audio/offlineRenderer";
import type { Project } from "../../domain/entities";
import { createSliceFixtureProject } from "../../domain/fixtures";
import { stringifyProject } from "../../domain/serialize";
import { createManualClock } from "../../shared/clock";
import { memoryStorage } from "../../testing/storage";
import {
  DEFAULT_EXPORT_SAMPLE_RATE,
  exportStereoWav,
  projectSampleRate,
  type RenderFunction,
} from "./stereoExport";

function recordingAnalytics() {
  const transport = createRecordingTransport();
  const analytics = new Analytics({
    transport,
    consent: new ConsentStore(memoryStorage()),
    storage: memoryStorage(),
  });
  analytics.setAccountType("anonymous");
  return { transport, analytics };
}

/** A render of `frames` frames of a quiet ramp, at the rate it was asked for. */
const fakeRender =
  (frames = 4): RenderFunction =>
  async (_projection, options) => {
    options.onProgress?.(0.5);
    options.onProgress?.(1);
    const ramp = Float32Array.from({ length: frames }, (_, i) => (i + 1) / 16);
    return {
      channels: [ramp, ramp.map((value) => -value)],
      sampleRate: options.sampleRate,
      frames,
      songEndSeconds: frames / options.sampleRate,
      tailTruncated: false,
    };
  };

const failingRender =
  (error: unknown): RenderFunction =>
  async () => {
    throw error;
  };

describe("exportStereoWav", () => {
  it("renders the song to a 24-bit stereo WAV named for the project and the day", async () => {
    const project = createSliceFixtureProject();
    const clock = createManualClock(new Date(2026, 8, 29, 10).getTime());
    const progress: number[] = [];
    const { analytics } = recordingAnalytics();

    const result = await exportStereoWav(project, {
      analytics,
      clock,
      render: fakeRender(),
      onProgress: (fraction) => progress.push(fraction),
    });

    expect(result.fileName).toBe(`${project.metadata.name} 2026-09-29.wav`);
    const bytes = result.bytes;
    const view = new DataView(bytes.buffer);
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(projectSampleRate(project));
    expect(view.getUint16(34, true)).toBe(24);
    expect(view.getUint32(40, true)).toBe(4 * 6);
    expect(result.frames).toBe(4);
    expect(progress.at(-1)).toBe(1);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
  });

  it("never edits the project it exports", async () => {
    const project = createSliceFixtureProject();
    const before = stringifyProject(project);
    await exportStereoWav(project, { render: fakeRender(), ...recordingAnalytics() });
    expect(stringifyProject(project)).toBe(before);
  });

  it("emits export_started and export_completed once, and export_stereo first use once", async () => {
    const project = createSliceFixtureProject();
    const clock = createManualClock(0);
    const { transport, analytics } = recordingAnalytics();
    const render: RenderFunction = async (projection, options) => {
      clock.advance(3_000);
      return fakeRender()(projection, options);
    };

    await exportStereoWav(project, { analytics, clock, render });

    expect(transport.named("export_started")).toEqual([
      {
        name: "export_started",
        params: expect.objectContaining({
          export_type: "stereo",
          duration_bucket: "under_30s",
          track_count_bucket: expect.any(String),
        }),
      },
    ]);
    expect(transport.named("export_completed")).toEqual([
      {
        name: "export_completed",
        params: expect.objectContaining({
          export_type: "stereo",
          elapsed_ms_bucket: "2_10s",
        }),
      },
    ]);
    expect(transport.named("export_failed")).toHaveLength(0);

    await exportStereoWav(project, { analytics, clock, render });
    expect(transport.named("export_started")).toHaveLength(2);
    expect(
      transport
        .named("feature_first_use")
        .filter((e) => e.params.feature === "export_stereo"),
    ).toHaveLength(1);
    // File names never reach analytics.
    const logged = JSON.stringify(transport.events);
    expect(logged).not.toContain(project.metadata.name);
    expect(logged).not.toContain(".wav");
  });

  it("reports a failed render with its error code and hands back no file", async () => {
    const { transport, analytics } = recordingAnalytics();
    const outcome = exportStereoWav(createSliceFixtureProject(), {
      analytics,
      render: failingRender(new OfflineRenderError("decode_failed", "bad asset")),
    });

    await expect(outcome).rejects.toMatchObject({
      code: "decode_failed",
      cancelled: false,
    });
    expect(transport.named("export_failed")).toEqual([
      {
        name: "export_failed",
        params: expect.objectContaining({
          export_type: "stereo",
          error_code: "decode_failed",
          was_cancelled: false,
        }),
      },
    ]);
    expect(transport.named("export_completed")).toHaveLength(0);
  });

  it("reports a cancel as cancelled, not as a failure in disguise", async () => {
    const { transport, analytics } = recordingAnalytics();
    const controller = new AbortController();
    const render: RenderFunction = async () => {
      controller.abort();
      throw new OfflineRenderError("aborted", "cancelled");
    };

    await expect(
      exportStereoWav(createSliceFixtureProject(), {
        analytics,
        render,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: "aborted", cancelled: true });
    expect(transport.named("export_failed")).toEqual([
      {
        name: "export_failed",
        params: expect.objectContaining({ error_code: "aborted", was_cancelled: true }),
      },
    ]);
  });

  it("drops a finished render when cancel arrived as it finished", async () => {
    const { transport, analytics } = recordingAnalytics();
    const controller = new AbortController();
    const render: RenderFunction = async (projection, options) => {
      const done = await fakeRender()(projection, options);
      controller.abort();
      return done;
    };

    await expect(
      exportStereoWav(createSliceFixtureProject(), {
        analytics,
        render,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: "aborted" });
    expect(transport.named("export_completed")).toHaveLength(0);
  });

  it("classifies an unexpected error as internal", async () => {
    const { transport, analytics } = recordingAnalytics();
    await expect(
      exportStereoWav(createSliceFixtureProject(), {
        analytics,
        render: failingRender(new Error("boom")),
      }),
    ).rejects.toMatchObject({ code: "internal" });
    expect(transport.named("export_failed")[0]?.params.error_code).toBe("internal");
  });

  it("exports the same file when analytics is blocked", async () => {
    const project = createSliceFixtureProject();
    const clock = createManualClock(0);
    const blocked = new Analytics({
      transport: createFailingTransport(),
      consent: new ConsentStore(memoryStorage()),
      storage: memoryStorage(),
      onIssue: () => {},
    });
    const withAnalytics = await exportStereoWav(project, {
      ...recordingAnalytics(),
      clock,
      render: fakeRender(),
    });
    const without = await exportStereoWav(project, {
      analytics: blocked,
      clock,
      render: fakeRender(),
    });
    expect(without.fileName).toBe(withAnalytics.fileName);
    expect(without.bytes).toEqual(withAnalytics.bytes);
  });
});

describe("projectSampleRate", () => {
  it("is the highest rate the project's assets were delivered at", () => {
    const project = createSliceFixtureProject();
    const [first, ...rest] = project.song.assets;
    const withHighRate: Project = {
      ...project,
      song: { ...project.song, assets: [{ ...first, sampleRate: 96_000 }, ...rest] },
    };
    expect(projectSampleRate(withHighRate)).toBe(96_000);
  });

  it("is 48 kHz when no asset declares a rate", () => {
    const project = createSliceFixtureProject();
    const bare: Project = {
      ...project,
      song: {
        ...project.song,
        assets: project.song.assets.map((asset) => ({ ...asset, sampleRate: null })),
      },
    };
    expect(projectSampleRate(bare)).toBe(DEFAULT_EXPORT_SAMPLE_RATE);
  });
});
