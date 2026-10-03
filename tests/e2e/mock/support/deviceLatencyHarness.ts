import * as Tone from "tone";
import { createDeviceNodeFactory, deviceLatencyFrames } from "~/audio/devices";
import {
  MASTER_LIMITER_THRESHOLD_DB,
  masterLimiterLatencyFrames,
} from "~/audio/MasterAudioGraph";
import { createDevice, defaultDeviceParameters } from "~/domain/devices";
import type { Device } from "~/domain/entities";
import type { DeviceId } from "~/domain/ids";
import { bestLag, noiseBurst } from "~/testing/latencyProbe";

/**
 * The browser half of `deviceLatency.spec.ts` (#883): renders a noise burst
 * dry and through a lookahead node, cross-correlates the two, and reports the
 * measured lag beside the declared one. Plugin delay compensation never
 * measures, so this is what keeps the browsers' declaration honest.
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
