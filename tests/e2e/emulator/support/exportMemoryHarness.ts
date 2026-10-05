import * as Tone from "tone";
import { renderProjectOffline } from "~/audio/offlineRenderer";
import { createDevice, type DeviceTypeId } from "~/domain/devices";
import type { Device, Project } from "~/domain/entities";
import {
  createFactoryContext,
  createPlacement,
  createReturnBus,
  createSend,
} from "~/domain/factories";
import { createReferenceProject } from "~/domain/fixtures";
import { createSeededIdFactory } from "~/domain/ids";
import { minutesToTicks, TICKS_PER_BAR } from "~/domain/time";
import { exportStereoWav } from "~/editor/export/stereoExport";

/**
 * The browser half of `exportMemory.spec.ts` (EXP-002): builds the PRD section
 * 10 processed reference project and exports it as a stereo WAV through the
 * real offline renderer. The dev server serves this module by path, so the
 * spec imports it into the page rather than driving the UI for ten minutes.
 */

/** Inserts per track, round-robin: every track is processed. */
const INSERTS: readonly DeviceTypeId[] = [
  "filter",
  "compressor",
  "overdrive",
  "saturator",
];
const RATE = 48_000;

/** 40 tracks, ten minutes, processing on every track, two FX returns with a
 * send from every track, and at least 64 active devices in all. */
export function createProcessedExportFixture(minutes = 10): {
  project: Project;
  devices: number;
} {
  const base = createReferenceProject({
    seed: "exp-002-memory",
    trackCount: 40,
    minutes,
    waveformTrackCount: 8,
  });
  const context = createFactoryContext({
    ids: createSeededIdFactory("exp-002-fx"),
    now: 0,
  });
  const device = (type: DeviceTypeId, order: number): Device =>
    createDevice(context.ids("device"), type, order);
  const verb = { ...createReturnBus(context, { name: "Verb", order: 0 }) };
  const echo = { ...createReturnBus(context, { name: "Echo", order: 1 }) };
  const returns = [
    { ...verb, devices: [device("reverb", 0)] },
    { ...echo, devices: [device("delay", 0), device("filter", 1)] },
  ];
  const tracks = base.song.tracks.map((track, index) => ({
    ...track,
    devices: [
      device(INSERTS[index % INSERTS.length], 0),
      device(INSERTS[(index + 1) % INSERTS.length], 1),
    ],
    sendConfig: [createSend(verb.id, 0.3), createSend(echo.id, 0.2)],
  }));
  // The reference fixture spaces its placements out and stops short of its
  // length; every track also plays the last two bars, so the song really
  // lasts `minutes`.
  const lastBar = minutesToTicks(minutes, base.song.tempo) - TICKS_PER_BAR * 2;
  const closing = base.clips.map((clip) =>
    createPlacement(context, {
      clipId: clip.id,
      trackId: clip.trackId,
      startTicks: lastBar,
      durationTicks: TICKS_PER_BAR * 2,
    }),
  );
  const project: Project = {
    ...base,
    song: {
      ...base.song,
      placements: [...base.song.placements, ...closing],
      // The library's master rate, so the render is the size a real one is.
      assets: base.song.assets.map((asset) => ({ ...asset, sampleRate: RATE })),
      tracks,
      returns,
    },
  };
  const devices =
    tracks.reduce((sum, track) => sum + track.devices.length, 0) +
    returns.reduce((sum, bus) => sum + bus.devices.length, 0);
  return { project, devices };
}

/** A two-second stereo tone stands in for every asset: the render is what is
 * measured, not the network. */
const syntheticLoader = {
  load: async () => {
    const frames = RATE * 2;
    const channel = (phase: number) =>
      Float32Array.from(
        { length: frames },
        (_, i) =>
          0.25 * Math.sin((2 * Math.PI * 110 * i) / RATE + phase) * Math.exp(-i / RATE),
      );
    return Tone.ToneAudioBuffer.fromArray([channel(0), channel(0.5)]);
  },
};

export interface ExportMemoryResult {
  readonly tracks: number;
  readonly devices: number;
  readonly sampleRate: number;
  readonly frames: number;
  readonly wavBytes: number;
  readonly elapsedMs: number;
}

/** Exports the processed fixture and reports what was written. */
export async function runProcessedExport(minutes = 10): Promise<ExportMemoryResult> {
  const { project, devices } = createProcessedExportFixture(minutes);
  const started = performance.now();
  let reported = 0;
  const file = await exportStereoWav(project, {
    onProgress: (fraction) => {
      if (fraction < reported + 0.05 && fraction < 1) return;
      reported = fraction;
      const seconds = Math.round((performance.now() - started) / 1000);
      console.log(`EXP-002 progress ${Math.round(fraction * 100)}% at ${seconds}s`);
    },
    render: (projection, options) =>
      renderProjectOffline(projection, { ...options, bufferLoader: syntheticLoader }),
  });
  return {
    tracks: project.song.tracks.length,
    devices,
    sampleRate: file.sampleRate,
    frames: file.frames,
    wavBytes: file.blob.size,
    elapsedMs: Math.round(performance.now() - started),
  };
}
