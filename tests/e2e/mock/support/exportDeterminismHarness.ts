import * as Tone from "tone";
import { renderProjectOffline } from "~/audio/offlineRenderer";
import { createDevice, type DeviceTypeId } from "~/domain/devices";
import type { Clip, Device, Project, Track } from "~/domain/entities";
import {
  createDrumMachineInstrument,
  createDrumPad,
  createFactoryContext,
  createNoteClip,
  createNoteEvent,
  createPlacement,
  createReturnBus,
  createSend,
  createSynthInstrument,
  createTrack,
} from "~/domain/factories";
import { createReferenceProject } from "~/domain/fixtures";
import { createSeededIdFactory } from "~/domain/ids";
import { TICKS_PER_BAR } from "~/domain/time";
import { exportStereoWav } from "~/editor/export/stereoExport";

/**
 * The browser half of `exportDeterminism.spec.ts` (#867): exports one song
 * several times through the real offline renderer and WAV encoder, and
 * reports each file's SHA-256.
 *
 * The song is built to sum three or more sounding signals at every kind of
 * junction a render has. Blink sums the inputs of such a junction in an order
 * that changes between renders (see `src/audio/summingBus.ts`), so this is
 * where an unchanged song's exports used to differ. It has chords on a
 * sampler and a synth, three drum pads hit together, a loop stretched to
 * another tempo, every track into the master at once, and every track sending
 * to one reverb return, under a master compressor and saturator.
 */

const RATE = 48_000;
const SIXTEENTH = TICKS_PER_BAR / 16;
const CHORD = [48, 55, 60, 63, 67];

export function createDeterminismFixture(): Project {
  // Four sampler tracks and a loop track, each playing two bars from bar 1.
  const base = createReferenceProject({
    seed: "export-determinism",
    tempo: 112,
    trackCount: 5,
    minutes: 0.1,
    placementCount: 5,
    automationLaneCount: 0,
    waveformTrackCount: 1,
  });
  const context = createFactoryContext({
    ids: createSeededIdFactory("export-determinism-extra"),
    now: 0,
  });
  const device = (type: DeviceTypeId, order: number): Device =>
    createDevice(context.ids("device"), type, order);
  const verb = createReturnBus(context, { name: "Verb", order: 0 });
  const [asset] = base.song.assets;
  const onBeats = [0, 4, 8, 12].map((sixteenth) => sixteenth * SIXTEENTH);

  const synth = createTrack(context, {
    name: "Synth",
    order: base.song.tracks.length,
    instrument: createSynthInstrument(),
  });
  const pads = ["Kick", "Snare", "Hat"].map((name) =>
    createDrumPad(context, { name, assetId: asset.id }),
  );
  const drums = createTrack(context, {
    name: "Drums",
    order: base.song.tracks.length + 1,
    instrument: createDrumMachineInstrument(pads),
  });
  const chordClip = (track: Track): Clip =>
    createNoteClip(context, {
      trackId: track.id,
      name: track.name,
      lengthTicks: TICKS_PER_BAR,
      events: onBeats.flatMap((startTicks) =>
        CHORD.map((pitch) =>
          createNoteEvent(context, { startTicks, durationTicks: SIXTEENTH * 3, pitch }),
        ),
      ),
    });
  const synthClip = chordClip(synth);
  const drumClip = createNoteClip(context, {
    trackId: drums.id,
    name: "Drums",
    lengthTicks: TICKS_PER_BAR,
    events: onBeats.flatMap((startTicks) =>
      pads.map((pad) =>
        createNoteEvent(context, { startTicks, durationTicks: SIXTEENTH, padId: pad.id }),
      ),
    ),
  });
  // The first sampler track plays chords rather than single notes.
  const [chordTrack] = base.song.tracks;
  const samplerChord = chordClip(chordTrack);

  const tracks = [...base.song.tracks, synth, drums].map((track) => ({
    ...track,
    sendConfig: [createSend(verb.id, 0.4)],
  }));
  const extraClips = [synthClip, drumClip, samplerChord];
  const placements = [
    ...base.song.placements.filter((placement) => placement.trackId !== chordTrack.id),
    ...extraClips.map((clip) =>
      createPlacement(context, {
        clipId: clip.id,
        trackId: clip.trackId,
        startTicks: 0,
        durationTicks: TICKS_PER_BAR * 2,
      }),
    ),
  ];
  return {
    ...base,
    song: {
      ...base.song,
      assets: base.song.assets.map((each) => ({ ...each, sampleRate: RATE })),
      tracks,
      placements,
      returns: [{ ...verb, devices: [device("reverb", 0)] }],
      master: {
        ...base.song.master,
        devices: [device("compressor", 0), device("saturator", 1)],
      },
    },
    clips: [...base.clips.map(stretched), ...extraClips],
  };
}

/** A loop authored at 128 BPM, so the 112 BPM song stretches it. */
function stretched(clip: Clip): Clip {
  if (clip.content.kind !== "audioLoop") return clip;
  return { ...clip, content: { ...clip.content, sourceTempo: 128 } };
}

/** A decaying stereo tone stands in for every asset, decoded at a rate other
 * than the render's, as a real one usually is. */
const syntheticLoader = {
  load: async () => {
    const rate = 44_100;
    const channel = (phase: number) =>
      Float32Array.from(
        { length: rate * 2 },
        (_, i) =>
          0.3 * Math.sin((2 * Math.PI * 220 * i) / rate + phase) * Math.exp(-i / rate),
      );
    const context = Tone.getContext().rawContext as unknown as BaseAudioContext;
    const buffer = context.createBuffer(2, rate * 2, rate);
    buffer.copyToChannel(channel(0), 0);
    buffer.copyToChannel(channel(0.5), 1);
    return new Tone.ToneAudioBuffer(buffer);
  },
};

async function sha256(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/** Exports the fixture `times` times; one SHA-256 per file, in order. */
export async function exportRepeatedly(times: number): Promise<string[]> {
  const project = createDeterminismFixture();
  const hashes: string[] = [];
  for (let i = 0; i < times; i++) {
    const file = await exportStereoWav(project, {
      render: (projection, options) =>
        renderProjectOffline(projection, { ...options, bufferLoader: syntheticLoader }),
    });
    hashes.push(await sha256(file.blob));
  }
  return hashes;
}
