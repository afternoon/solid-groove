import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { installWebAudioGlobals } from "../../audio/testAudioContext";
import { buildAudioProjection } from "../../projection/audioProjection";
import {
  ALIGNMENT_CASES,
  type AlignmentCase,
  bestLag,
  createAlignmentProject,
  noiseBurst,
} from "../../testing/latencyProbe";
import { planStems } from "./stemPlan";

/**
 * The export alignment matrix (#883): with Compressors on the master (once,
 * twice), on one track, or on a return, the stereo WAV and every file of a
 * stems ZIP start at bar 1, sample-aligned with the same song exported with no
 * devices at all. Each case's Compressors run 1:1, so they change nothing but
 * time; before plugin delay compensation a master Compressor put the stereo
 * file and `Reference mix.wav` one lookahead late, and a track's Compressor
 * put its stem one lookahead behind the others.
 *
 * The same matrix runs in Chromium, Firefox and WebKit, against the browsers'
 * declared latency, in `tests/e2e/mock/deviceLatency.spec.ts`.
 */

// Must run before Tone is imported — see AudioRuntime.test.ts for why.
installWebAudioGlobals();

let Tone: typeof import("tone");
let renderer: typeof import("../../audio/offlineRenderer");
let runtime: typeof import("../../audio/AudioRuntime");

beforeAll(async () => {
  Tone = await import("tone");
  renderer = await import("../../audio/offlineRenderer");
  runtime = await import("../../audio/AudioRuntime");
});

afterEach(async () => {
  await runtime.getAudioRuntime().close();
  runtime.__resetAudioRuntimeForTests();
});

const RATE = 22_050;
/** Well past several compressors' lookahead in either direction. */
const MAX_LAG = 1_024;

/** Every file a case exports, by path: the stereo WAV and each stem. */
async function exportFiles(where: AlignmentCase): Promise<Map<string, Float32Array[]>> {
  const project = createAlignmentProject(where);
  const burst = noiseBurst(Math.round(RATE * 0.1));
  const render = async (
    projection: Parameters<typeof renderer.renderProjectOffline>[0],
    tracksSendOnly = false,
  ) =>
    (
      await renderer.renderProjectOffline(projection, {
        sampleRate: RATE,
        maxTailSeconds: 0.25,
        tracksSendOnly,
        bufferLoader: { load: async () => Tone.ToneAudioBuffer.fromArray(burst) },
      })
    ).channels;
  const files = new Map<string, Float32Array[]>();
  files.set("stereo", await render(buildAudioProjection(project)));
  for (const stem of planStems(project)) {
    files.set(stem.path, await render(stem.projection, stem.tracksSendOnly));
  }
  return files;
}

/**
 * How much of `other` is left once the best-fitting multiple of `reference`
 * is subtracted, relative to `other`: 0 when the two are the same signal at
 * the same time, whatever its level. Level is fitted rather than compared
 * because a 1:1 `DynamicsCompressorNode` is not quite unity gain in every
 * engine (#884); what this matrix pins is time.
 */
function residual(reference: Float32Array, other: Float32Array): number {
  let cross = 0;
  let power = 0;
  for (let i = 0; i < reference.length; i++) {
    cross += reference[i] * (other[i] ?? 0);
    power += reference[i] ** 2;
  }
  const gain = cross / power;
  let signal = 0;
  let difference = 0;
  for (let i = 0; i < other.length; i++) {
    signal += other[i] ** 2;
    difference += (other[i] - gain * (reference[i] ?? 0)) ** 2;
  }
  return Math.sqrt(difference / signal);
}

/** The files that mix several sources: the stereo WAV and the ZIP's mix. */
const MIXES = ["stereo", "Reference mix.wav"];

/** Every stem of an export summed, one array per channel. */
function sumOfStems(files: Map<string, Float32Array[]>): Float32Array[] {
  const stems = [...files].filter(([path]) => !MIXES.includes(path));
  const frames = Math.max(...stems.map(([, channels]) => channels[0].length));
  return [0, 1].map((channel) => {
    const sum = new Float32Array(frames);
    for (const [, channels] of stems) {
      channels[channel].forEach((sample, i) => {
        sum[i] += sample;
      });
    }
    return sum;
  });
}

describe("export alignment with lookahead devices (#883)", () => {
  let reference: Map<string, Float32Array[]>;

  beforeAll(async () => {
    reference = await exportFiles("none");
  });

  it("exports the stereo WAV and every stem from the matrix song", () => {
    expect([...reference.keys()]).toEqual([
      "stereo",
      "01 Kick.wav",
      "02 Bass.wav",
      "Returns/01 Verb.wav",
      "Reference mix.wav",
    ]);
  });

  it.each(ALIGNMENT_CASES.filter((where) => where !== "none"))(
    "starts every file at bar 1 with a Compressor on %s",
    async (where) => {
      const files = await exportFiles(where);
      for (const [path, channels] of reference) {
        const exported = files.get(path);
        expect(exported, path).toBeDefined();
        const lag = bestLag(
          channels[0],
          exported?.[0] ?? new Float32Array(),
          MAX_LAG,
          RATE,
        );
        expect(lag, `${path} with a Compressor on ${where}`).toBe(0);
        // A stem is one source, so it is the reference stem at some level.
        if (MIXES.includes(path)) continue;
        for (const channel of [0, 1]) {
          expect(
            residual(channels[channel], exported?.[channel] ?? new Float32Array()),
            `${path} channel ${channel} with a Compressor on ${where}`,
          ).toBeLessThan(1e-3);
        }
      }
      // A mix whose tracks drifted apart inside it could still peak at lag 0,
      // and a Compressor on one track changes that track's level alone. So
      // the mix is also held to the stems: they sum to it, sample for sample.
      const stems = sumOfStems(files);
      for (const path of MIXES) {
        for (const channel of [0, 1]) {
          expect(
            residual(stems[channel], files.get(path)?.[channel] ?? new Float32Array()),
            `${path} against its stems, channel ${channel}, Compressor on ${where}`,
          ).toBeLessThan(1e-3);
        }
      }
    },
  );
});
