import { describe, expect, it } from "vitest";
import { Analytics } from "../../analytics/analytics";
import { ConsentStore } from "../../analytics/consent";
import { createRecordingTransport } from "../../analytics/transport";
import { OfflineRenderError } from "../../audio/offlineRenderer";
import { createReferenceProject } from "../../domain/fixtures";
import { createManualClock } from "../../shared/clock";
import { memoryStorage } from "../../testing/storage";
import { exportStems } from "./exportStems";
import { createStemFixtureProject } from "./stemFixture";
import { concat, exportFailure, fakeRenderer } from "./stemTestSupport";

/**
 * EXP-003's analytics obligation: the export event trio with
 * `export_type: stems`, the `export_stems` first use, once per export, with no
 * name in any parameter, and no effect on the export when analytics is off.
 */

const RATE = 8_000;

function recordingAnalytics(allowed = true) {
  const transport = createRecordingTransport();
  const consent = new ConsentStore(memoryStorage());
  consent.set({ productAnalytics: allowed, errorMonitoring: allowed });
  const analytics = new Analytics({ transport, consent, storage: memoryStorage() });
  return { analytics, transport };
}

const params = (transport: ReturnType<typeof createRecordingTransport>, name: string) =>
  transport.named(name).map((event) => event.params);

describe("stem export analytics", () => {
  it("logs started, first use and completed once each, with no names in them", async () => {
    const { analytics, transport } = recordingAnalytics();
    const clock = createManualClock(1_000);
    const { render } = fakeRenderer();
    await exportStems(createStemFixtureProject(), {
      sampleRate: RATE,
      analytics,
      clock,
      render: async (...args) => {
        clock.advance(3_000);
        return render(...args);
      },
    });
    expect(params(transport, "export_started")).toEqual([
      expect.objectContaining({
        export_type: "stems",
        duration_bucket: "under_30s",
        track_count_bucket: "1_2",
      }),
    ]);
    expect(params(transport, "export_completed")).toEqual([
      expect.objectContaining({ export_type: "stems", elapsed_ms_bucket: "10_60s" }),
    ]);
    expect(params(transport, "feature_first_use").map((p) => p.feature)).toEqual([
      "export_stems",
    ]);
    expect(transport.named("export_failed")).toEqual([]);
    expect(JSON.stringify(transport.events)).not.toMatch(/Lead|Bass|Verb|Delay|fixture/);
  });

  // #78: a project with sounds it reports missing still exports; how many
  // travels on export_started, once per export, and never which ones.
  it("counts the reported-missing sounds once, and hands them to every render", async () => {
    const { analytics, transport } = recordingAnalytics();
    const project = createReferenceProject({ trackCount: 2 });
    const missing = new Set([project.song.assets[0].id, "ast_not_in_this_project"]);
    const { render, calls } = fakeRenderer();
    for (let i = 0; i < 2; i++) {
      await exportStems(project, {
        sampleRate: RATE,
        analytics,
        render,
        missingAssetIds: missing,
      });
    }
    expect(params(transport, "export_started")).toEqual([
      expect.objectContaining({ missing_sound_count: 1 }),
      expect.objectContaining({ missing_sound_count: 1 }),
    ]);
    expect(
      params(transport, "feature_first_use").filter(
        (p) => p.feature === "export_with_missing_sounds",
      ),
    ).toHaveLength(1);
    expect(calls.every(([, options]) => options.missingAssetIds === missing)).toBe(true);
    expect(JSON.stringify(transport.events)).not.toContain(project.song.assets[0].id);
  });

  it("says nothing of missing sounds when none are reported", async () => {
    const { analytics, transport } = recordingAnalytics();
    await exportStems(createStemFixtureProject(), {
      sampleRate: RATE,
      analytics,
      render: fakeRenderer().render,
      missingAssetIds: new Set(),
    });
    expect(params(transport, "export_started")[0]).not.toHaveProperty(
      "missing_sound_count",
    );
  });

  it("logs first use only for the first stem export", async () => {
    const { analytics, transport } = recordingAnalytics();
    for (let i = 0; i < 2; i++) {
      await exportStems(createStemFixtureProject(), {
        sampleRate: RATE,
        analytics,
        render: fakeRenderer().render,
      });
    }
    expect(transport.named("export_started")).toHaveLength(2);
    expect(transport.named("export_completed")).toHaveLength(2);
    expect(transport.named("feature_first_use")).toHaveLength(1);
  });

  it("logs export_stems_selection once, and only when a track is left out", async () => {
    const { analytics, transport } = recordingAnalytics();
    const project = createStemFixtureProject();
    const ids = project.song.tracks.map((track) => track.id);
    for (const trackIds of [ids, ids.slice(1), ids.slice(1)]) {
      await exportStems(project, {
        sampleRate: RATE,
        trackIds,
        analytics,
        render: fakeRenderer().render,
      });
    }
    expect(params(transport, "feature_first_use").map((p) => p.feature)).toEqual([
      "export_stems",
      "export_stems_selection",
    ]);
  });

  it("logs one cancelled failure, and no completion, when cancelled", async () => {
    const { analytics, transport } = recordingAnalytics();
    const controller = new AbortController();
    const { render } = fakeRenderer();
    await exportFailure(
      exportStems(createStemFixtureProject(), {
        sampleRate: RATE,
        analytics,
        signal: controller.signal,
        render: async (...args) => {
          controller.abort();
          return render(...args);
        },
      }),
    );
    expect(params(transport, "export_failed")).toEqual([
      expect.objectContaining({
        export_type: "stems",
        error_code: "aborted",
        was_cancelled: true,
      }),
    ]);
    expect(transport.named("export_completed")).toEqual([]);
  });

  it("logs one coded failure when a stem cannot render", async () => {
    const { analytics, transport } = recordingAnalytics();
    await exportFailure(
      exportStems(createStemFixtureProject(), {
        sampleRate: RATE,
        analytics,
        render: async () => {
          throw new OfflineRenderError(
            "decode_failed",
            "Asset ast_x could not be loaded",
          );
        },
      }),
    );
    expect(params(transport, "export_failed")).toEqual([
      expect.objectContaining({ error_code: "decode_failed", was_cancelled: false }),
    ]);
  });

  it("logs the refusal of the PRD reference project as quota_exceeded", async () => {
    const { analytics, transport } = recordingAnalytics();
    const project = createReferenceProject();
    await exportFailure(
      exportStems(project, {
        sampleRate: 48_000,
        analytics,
        render: fakeRenderer().render,
      }),
    );
    expect(params(transport, "export_started")).toEqual([
      expect.objectContaining({ duration_bucket: "5_10m", track_count_bucket: "21_50" }),
    ]);
    expect(params(transport, "export_failed")).toEqual([
      expect.objectContaining({ error_code: "quota_exceeded", was_cancelled: false }),
    ]);
  });

  it("produces the same archive with analytics disabled, and sends nothing", async () => {
    const on = recordingAnalytics(true);
    const off = recordingAnalytics(false);
    const project = createStemFixtureProject();
    const options = { sampleRate: RATE } as const;
    const a = await exportStems(project, {
      ...options,
      analytics: on.analytics,
      render: fakeRenderer().render,
    });
    const b = await exportStems(project, {
      ...options,
      analytics: off.analytics,
      render: fakeRenderer().render,
    });
    expect(concat(b.parts)).toEqual(concat(a.parts));
    expect(off.transport.events).toEqual([]);
  });
});
