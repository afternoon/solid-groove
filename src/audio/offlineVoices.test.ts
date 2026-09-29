import { beforeAll, describe, expect, it, vi } from "vitest";
import { packVersion } from "../domain/entities";
import type { AssetId, PackId, PadId } from "../domain/ids";
import type { AudioAssetProjection } from "../projection/audioProjection";
import { installWebAudioGlobals, rms } from "./testAudioContext";

// Must run before Tone is imported — see AudioRuntime.test.ts for why.
installWebAudioGlobals();

let Tone: typeof import("tone");
let clock: typeof import("./offlineClock");
let instruments: typeof import("./InstrumentGraph");
let assetVoice: typeof import("./instruments/assetVoice");
let loops: typeof import("./audioLoopPlayer");
let cacheModule: typeof import("./AudioBufferCache");
let runtimeModule: typeof import("./AudioRuntime");

beforeAll(async () => {
  Tone = await import("tone");
  clock = await import("./offlineClock");
  instruments = await import("./InstrumentGraph");
  assetVoice = await import("./instruments/assetVoice");
  loops = await import("./audioLoopPlayer");
  cacheModule = await import("./AudioBufferCache");
  runtimeModule = await import("./AudioRuntime");
});

const ASSET = "ast_voice" as AssetId;
const PAD = "pad_voice" as PadId;
const RATE = 22_050;

function sound(): import("tone").ToneAudioBuffer {
  return Tone.ToneAudioBuffer.fromArray(
    Float32Array.from({ length: 4_410 }, (_, i) => Math.sin(i / 3)),
  );
}

async function instrumentContext() {
  const buffer = sound();
  const asset = {
    id: ASSET,
    packId: "pak_voice" as PackId,
    packVersion: packVersion("1.0.0"),
    url: "/voice.wav",
    fingerprint: "f1",
  } as AudioAssetProjection;
  const bufferCache = new cacheModule.AudioBufferCache<import("tone").ToneAudioBuffer>({
    load: async () => buffer,
  });
  const scope = new runtimeModule.AudioRuntime().openProjectScope("voices");
  return { scope, assetsById: new Map([[ASSET, asset]]), bufferCache };
}

/**
 * Renders one voice the way an offline render plays it: built inside a
 * transport callback while Tone's offline clock runs through the whole
 * render, and only then handed to the audio thread.
 */
async function renderVoice(build: () => (time: number) => void): Promise<Float32Array> {
  const offline = new Tone.OfflineContext(1, 1, RATE);
  const play = clock.withGlobalContext(offline, build);
  // Give an asset cache a turn to deliver its buffer.
  await new Promise((resolve) => setTimeout(resolve, 0));
  offline.transport.schedule((time) => play(time), 0.1);
  clock.withGlobalContext(offline, () => offline.transport.start(0));
  await clock.runOfflineClock(offline);
  const raw = offline.rawContext as unknown as OfflineAudioContext;
  const rendered = await raw.startRendering();
  offline.dispose();
  return rendered.getChannelData(0);
}

describe("voices in an offline render (EXP-001)", () => {
  it("a sampler note sounds, rather than being disposed before it renders", async () => {
    const context = await instrumentContext();
    const data = await renderVoice(() => {
      const node = instruments.createInstrumentNode(
        { kind: "sampler", assetId: ASSET, parameters: {} },
        context,
      );
      node.output.connect(Tone.getContext().destination);
      return (time) => node.trigger({ kind: "pitch", pitch: 60 }, time, 0.1, 1);
    });
    expect(rms(data.subarray(0.1 * RATE, 0.2 * RATE))).toBeGreaterThan(0.01);
  });

  it("a drum-machine hit sounds", async () => {
    const context = await instrumentContext();
    const data = await renderVoice(() => {
      const pad = {
        id: PAD,
        name: "Pad",
        assetId: ASSET,
        chokeGroup: null,
        parameters: {},
        mixer: { volume: 0, pan: 0, muted: false, soloed: false },
      };
      const node = instruments.createInstrumentNode(
        { kind: "drumMachine", pads: [pad], parameters: {} },
        context,
      );
      node.output.connect(Tone.getContext().destination);
      return (time) => node.trigger({ kind: "pad", padId: PAD }, time, 0.1, 1);
    });
    expect(rms(data.subarray(0.1 * RATE, 0.15 * RATE))).toBeGreaterThan(0.01);
  });

  it.each([1, 1.5])("an audio loop at playback rate %d sounds", async (playbackRate) => {
    const buffer = sound();
    const data = await renderVoice(() => (time) => {
      loops.playAudioLoop(buffer, {
        destination: Tone.getContext().destination,
        time,
        durationSeconds: 0.2,
        playbackRate,
        offsetSeconds: 0,
      });
    });
    expect(rms(data.subarray(0.1 * RATE, 0.25 * RATE))).toBeGreaterThan(0.01);
  });

  it("a one-shot sounds", async () => {
    const buffer = sound();
    const data = await renderVoice(() => (time) => {
      assetVoice.playOneShot(buffer, Tone.getContext().destination, time, 0.1);
    });
    expect(rms(data.subarray(0.1 * RATE, 0.2 * RATE))).toBeGreaterThan(0.01);
  });
});

describe("disposeFinishedVoice", () => {
  it("disposes a stopped voice on the live context", () => {
    const dispose = vi.fn();
    assetVoice.disposeFinishedVoice({ context: Tone.getContext() }, dispose);
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("leaves a voice on an offline context to the render's teardown", () => {
    const dispose = vi.fn();
    const offline = new Tone.OfflineContext(1, 0.1, RATE);
    assetVoice.disposeFinishedVoice({ context: offline }, dispose);
    expect(dispose).not.toHaveBeenCalled();
    offline.dispose();
  });
});
