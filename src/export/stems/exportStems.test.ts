import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { OfflineRenderError } from "../../audio/offlineRenderer";
import { songEndSeconds } from "../../audio/renderLength";
import { createReferenceProject } from "../../domain/fixtures";
import { buildAudioProjection } from "../../projection/audioProjection";
import { exportStems, StemExportError } from "./exportStems";
import { createStemFixtureProject } from "./stemFixture";
import { concat, exportFailure, fakeRenderer } from "./stemTestSupport";

const RATE = 8_000;

describe("exportStems", () => {
  it("renders every planned stem once, at one rate, and pads them to one length", async () => {
    const { render, calls } = fakeRenderer();
    const archive = await exportStems(createStemFixtureProject(), {
      sampleRate: RATE,
      render,
    });
    expect(calls.map(([, options]) => options.sampleRate)).toEqual(Array(5).fill(RATE));
    expect(calls.map(([, options]) => options.tracksSendOnly)).toEqual([
      false,
      false,
      true,
      true,
      false,
    ]);
    const entries = unzipSync(concat(archive.parts));
    expect(Object.keys(entries)).toEqual([
      "01 Lead.wav",
      "02 Sub Bass.wav",
      "Returns/01 Verb.wav",
      "Returns/02 Delay.wav",
      "Reference mix.wav",
    ]);
    expect(archive.frames).toBe(140);
    for (const [path, bytes] of Object.entries(entries)) {
      if (path.endsWith(".wav")) expect(bytes.byteLength, path).toBe(44 + 140 * 6);
    }
  });

  it("reports monotonic progress that ends at 1", async () => {
    const progress: number[] = [];
    await exportStems(createStemFixtureProject(), {
      sampleRate: RATE,
      render: fakeRenderer().render,
      onProgress: (fraction) => progress.push(fraction),
    });
    expect(progress.length).toBeGreaterThan(5);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
    expect(progress.at(-1)).toBe(1);
  });

  it("stops rendering once cancelled", async () => {
    const controller = new AbortController();
    const { render, calls } = fakeRenderer();
    const error = await exportFailure(
      exportStems(createStemFixtureProject(), {
        sampleRate: RATE,
        signal: controller.signal,
        render: async (...args) => {
          const result = await render(...args);
          if (calls.length === 2) controller.abort();
          return result;
        },
      }),
    );
    expect(error.code).toBe("aborted");
    expect(error.cancelled).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it("fails recoverably with the renderer's own code when a stem cannot render", async () => {
    const error = await exportFailure(
      exportStems(createStemFixtureProject(), {
        sampleRate: RATE,
        render: async () => {
          throw new OfflineRenderError(
            "decode_failed",
            "Asset ast_x could not be loaded",
          );
        },
      }),
    );
    expect(error.code).toBe("decode_failed");
    expect(error.cancelled).toBe(false);
    // Nothing is held: a retry starts from scratch and succeeds.
    const retry = await exportStems(createStemFixtureProject(), {
      sampleRate: RATE,
      render: fakeRenderer().render,
    });
    expect(retry.byteLength).toBeGreaterThan(0);
  });

  it("reports anything else that goes wrong as an internal failure", async () => {
    const error = await exportFailure(
      exportStems(createStemFixtureProject(), {
        sampleRate: RATE,
        render: async () => {
          throw new Error("bug");
        },
      }),
    );
    expect(error.code).toBe("internal");
  });

  it("still refuses a render longer than its bound once the renders show it", async () => {
    const error = await exportFailure(
      exportStems(createStemFixtureProject(), {
        sampleRate: 8,
        maxBytes: 300_000,
        render: fakeRenderer(() => 20_000).render,
      }),
    );
    expect(error.code).toBe("quota_exceeded");
  });

  it("never fails on size once it starts rendering, even at the longest tail", async () => {
    const project = createStemFixtureProject();
    // Every stem rings out for the whole tail allowance: the most a render returns.
    const longest = Math.ceil((songEndSeconds(buildAudioProjection(project)) + 1) * 8);
    const refused = new Set<boolean>();
    for (let maxBytes = 1_000; maxBytes <= 4_000; maxBytes += 20) {
      const { render, calls } = fakeRenderer(() => longest);
      const options = { sampleRate: 8, maxTailSeconds: 1, maxBytes, render };
      const result = await exportStems(project, options).catch((e: StemExportError) => e);
      refused.add(result instanceof StemExportError);
      // Either refused before a single render, or exported whole.
      if (result instanceof StemExportError) expect(calls, `${maxBytes}`).toEqual([]);
      else expect(result.byteLength).toBeLessThanOrEqual(maxBytes);
    }
    expect(refused).toEqual(new Set([true, false]));
  });
});

describe("exportStems with the PRD reference project (50 tracks, ten minutes)", () => {
  const project = createReferenceProject();

  it("refuses stems at 48 kHz, over the budget, before rendering", async () => {
    const { render, calls } = fakeRenderer();
    const error = await exportFailure(
      exportStems(project, { sampleRate: 48_000, render }),
    );
    expect(error.code).toBe("quota_exceeded");
    expect(calls).toEqual([]);
  });

  it("plans 51 files and cancels cleanly mid-export (plumbing, at a toy rate)", async () => {
    const controller = new AbortController();
    const progress: number[] = [];
    const { render, calls } = fakeRenderer(() => 16);
    const error = await exportFailure(
      exportStems(project, {
        sampleRate: 8,
        signal: controller.signal,
        onProgress: (fraction) => {
          progress.push(fraction);
          if (fraction >= 0.5) controller.abort();
        },
        render,
      }),
    );
    expect(error.code).toBe("aborted");
    expect(calls.length).toBeGreaterThan(10);
    expect(calls.length).toBeLessThan(51);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
  });

  it("packages all 51 aligned files (plumbing, at a toy rate)", async () => {
    const archive = await exportStems(project, {
      sampleRate: 8,
      render: fakeRenderer((call) => 4_000 + call).render,
    });
    const entries = unzipSync(concat(archive.parts));
    expect(Object.keys(entries)).toHaveLength(51);
    const lengths = new Set(
      Object.entries(entries)
        .filter(([path]) => path.endsWith(".wav"))
        .map(([, bytes]) => bytes.byteLength),
    );
    expect([...lengths]).toEqual([44 + 4_050 * 6]);
  });
});
