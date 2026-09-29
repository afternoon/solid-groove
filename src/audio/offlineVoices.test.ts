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

/** Voices still waiting to be disposed at the last pause of the last render. */
let waitingAtLastPause = Number.NaN;

/**
 * Renders one voice the way an offline render plays it: built inside a
 * transport callback while Tone's offline clock runs ahead of the audio,
 * which pauses every quarter second to dispose what has finished sounding.
 */
async function renderVoice(build: () => (time: number) => void): Promise<Float32Array> {
  const offline = clock.createOfflineContext(1, RATE, RATE);
  const play = clock.withGlobalContext(offline, build);
  // Give an asset cache a turn to deliver its buffer.
  await new Promise((resolve) => setTimeout(resolve, 0));
  offline.transport.schedule((time) => play(time), 0.1);
  clock.withGlobalContext(offline, () => offline.transport.start(0));
  const rendered = await clock.renderOfflineInStep(offline, {
    chunkSeconds: 0.25,
    onRendered: (seconds) => {
      waitingAtLastPause = assetVoice.disposeVoicesFinishedBy(offline, seconds);
    },
  });
  offline.dispose();
  if (rendered === "stopped") throw new Error("expected audio");
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
    expect(waitingAtLastPause).toBe(0); // and has left the render since
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
    expect(waitingAtLastPause).toBe(0); // and has left the render since
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
    expect(waitingAtLastPause).toBe(0); // and has left the render since
  });

  it("a one-shot sounds", async () => {
    const buffer = sound();
    const data = await renderVoice(() => (time) => {
      assetVoice.playOneShot(buffer, Tone.getContext().destination, time, 0.1);
    });
    expect(rms(data.subarray(0.1 * RATE, 0.2 * RATE))).toBeGreaterThan(0.01);
    expect(waitingAtLastPause).toBe(0); // and has left the render since
  });
});

describe("disposeFinishedVoice", () => {
  it("disposes a stopped voice on the live context", () => {
    const dispose = vi.fn();
    assetVoice.disposeFinishedVoice({ context: Tone.getContext() }, dispose);
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("lets a live voice ring before disposing it", async () => {
    const dispose = vi.fn();
    assetVoice.disposeFinishedVoice({ context: Tone.getContext() }, dispose, 0.01);
    expect(dispose).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("disposes an offline voice only once the render has passed its ring", () => {
    const dispose = vi.fn();
    const offline = clock.createOfflineContext(1, RATE, RATE);
    // Stopped at the offline clock's time 0, ringing for half a second more.
    assetVoice.disposeFinishedVoice({ context: offline }, dispose, 0.5);
    expect(assetVoice.disposeVoicesFinishedBy(offline, 0.49)).toBe(1);
    expect(dispose).not.toHaveBeenCalled();
    expect(assetVoice.disposeVoicesFinishedBy(offline, 0.5)).toBe(0);
    expect(dispose).toHaveBeenCalledOnce();
    assetVoice.disposeVoicesFinishedBy(offline, Number.POSITIVE_INFINITY);
    expect(dispose).toHaveBeenCalledOnce();
    offline.dispose();
  });
});
