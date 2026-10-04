import * as Tone from "tone";
import { createDeviceNodeFactory, deviceLatencyFrames } from "~/audio/devices";
import {
  MASTER_LIMITER_THRESHOLD_DB,
  masterLimiterLatencyFrames,
} from "~/audio/MasterAudioGraph";
import { renderProjectOffline } from "~/audio/offlineRenderer";
import { createDevice, defaultDeviceParameters } from "~/domain/devices";
import type { Device } from "~/domain/entities";
import type { DeviceId } from "~/domain/ids";
import { planStems } from "~/export/stems/stemPlan";
import {
  type AudioSongProjection,
  buildAudioProjection,
} from "~/projection/audioProjection";
import {
  ALIGNMENT_CASES,
  type AlignmentCase,
  bestLag,
  createAlignmentProject,
  noiseBurst,
} from "~/testing/latencyProbe";

/**
 * The browser half of `deviceLatency.spec.ts` (#883): renders a noise burst
 * dry and through a lookahead node, cross-correlates the two, and reports the
 * measured lag beside the declared one. Plugin delay compensation never
 * measures, so this is what keeps the browsers' declaration honest. Then it
 * runs the export alignment matrix (`src/export/stems/latencyAlignment.test.ts`)
 * on this browser's engine.
 */

export interface LatencyReading {
  readonly path: string;
  readonly sampleRate: number;
  readonly declared: number;
  readonly measured: number;
}

const RATES = [44_100, 48_000] as const;

type Path = { input: Tone.InputNode; output: Tone.ToneAudioNode };

async function lagThrough(sampleRate: number, path: () => Path): Promise<number> {
  const burst = noiseBurst(Math.round(sampleRate * 0.1));
  const rendered = await Tone.Offline(
    () => {
      const merge = new Tone.Merge().toDestination();
      const player = new Tone.Player(Tone.ToneAudioBuffer.fromArray(burst));
      const { input, output } = path();
      player.connect(merge, 0, 0);
      player.connect(input);
      output.connect(merge, 0, 1);
      player.start(0);
    },
    0.25,
    2,
    sampleRate,
  );
  return bestLag(rendered.getChannelData(0), rendered.getChannelData(1), 2_048);
}

function compressor(values: Record<string, number>): Device {
  return {
    ...createDevice("dev_probe" as DeviceId, "compressor", 0),
    parameters: { ...defaultDeviceParameters("compressor"), ...values },
  };
}

export async function readLatencies(): Promise<LatencyReading[]> {
  const readings: LatencyReading[] = [];
  const createNode = createDeviceNodeFactory({ scope: null as never, tempo: () => 120 });
  for (const sampleRate of RATES) {
    for (const [path, values] of [
      ["compressor 1:1", { ratio: 1, threshold: 0 }],
      ["compressor 8:1", { ratio: 8, threshold: -30 }],
    ] as const) {
      readings.push({
        path,
        sampleRate,
        declared: deviceLatencyFrames("compressor", sampleRate),
        measured: await lagThrough(sampleRate, () => {
          const node = createNode(compressor(values));
          if (!node) throw new Error("no compressor core");
          return node;
        }),
      });
    }
    readings.push({
      path: "master limiter",
      sampleRate,
      declared: masterLimiterLatencyFrames(sampleRate),
      measured: await lagThrough(sampleRate, () => {
        const limiter = new Tone.Limiter(MASTER_LIMITER_THRESHOLD_DB);
        return { input: limiter, output: limiter };
      }),
    });
  }
  return readings;
}

export interface AlignmentReading {
  readonly where: AlignmentCase;
  readonly path: string;
  /** Frames this file lands behind the same file exported with no devices. */
  readonly lag: number;
}

const MATRIX_RATE = 48_000;

async function exportFiles(where: AlignmentCase): Promise<Map<string, Float32Array>> {
  const project = createAlignmentProject(where);
  const burst = noiseBurst(Math.round(MATRIX_RATE * 0.1));
  const render = async (projection: AudioSongProjection, tracksSendOnly = false) =>
    (
      await renderProjectOffline(projection, {
        sampleRate: MATRIX_RATE,
        maxTailSeconds: 0.25,
        tracksSendOnly,
        bufferLoader: { load: async () => Tone.ToneAudioBuffer.fromArray(burst) },
      })
    ).channels[0];
  const files = new Map<string, Float32Array>();
  files.set("stereo", await render(buildAudioProjection(project)));
  for (const stem of planStems(project)) {
    files.set(stem.path, await render(stem.projection, stem.tracksSendOnly));
  }
  return files;
}

/** Every file of every case's export, and how far it lands from the
 * no-device export's file. Every lag should be 0. */
export async function readAlignment(): Promise<AlignmentReading[]> {
  const reference = await exportFiles("none");
  const readings: AlignmentReading[] = [];
  for (const where of ALIGNMENT_CASES) {
    if (where === "none") continue;
    const files = await exportFiles(where);
    for (const [path, data] of reference) {
      const exported = files.get(path) ?? new Float32Array();
      readings.push({
        where,
        path,
        lag: bestLag(data, exported, 1_024, Math.round(MATRIX_RATE * 0.5)),
      });
    }
  }
  return readings;
}
