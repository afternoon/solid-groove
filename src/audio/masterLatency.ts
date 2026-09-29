import * as Tone from "tone";
import { MASTER_LIMITER_THRESHOLD_DB } from "./MasterAudioGraph";

/**
 * How many frames the master bus's safety limiter delays everything by, at a
 * given sample rate (EXP-001).
 *
 * `Tone.Limiter` is a `DynamicsCompressorNode`, which looks ahead: Chromium,
 * Firefox and WebKit all hold the signal back by a fixed pre-delay (about
 * 6 ms) before it leaves. Live, that is an imperceptible lag behind the
 * playhead. In a file it would put bar 1 a few milliseconds after the start,
 * and every stem the same few milliseconds late against another DAW's grid. So
 * an offline render drops exactly this many frames from its front. Only the
 * limiter every render passes through is compensated; a compressor a user adds
 * delays its own path live and offline alike.
 *
 * The pre-delay differs between implementations, so it is measured rather
 * than assumed: a step through a fresh limiter, rendered once per sample rate.
 */
export function masterLatencyFrames(sampleRate: number): Promise<number> {
  let measured = measurements.get(sampleRate);
  if (!measured) {
    measured = measure(sampleRate);
    measurements.set(sampleRate, measured);
    // A failed measurement is not remembered, so the next render retries.
    measured.catch(() => measurements.delete(sampleRate));
  }
  return measured;
}

const measurements = new Map<number, Promise<number>>();

/** Long enough to see through any implementation's pre-delay (~6 ms). */
const PROBE_SECONDS = 0.1;

async function measure(sampleRate: number): Promise<number> {
  const frames = Math.ceil(PROBE_SECONDS * sampleRate);
  const context = new Tone.OfflineContext(1, (frames + 0.5) / sampleRate, sampleRate);
  try {
    // Every node names its context, so nothing here touches the global one.
    const limiter = new Tone.Limiter({ context, threshold: MASTER_LIMITER_THRESHOLD_DB });
    limiter.connect(context.destination);
    new Tone.Signal({ context, value: 0.25 }).connect(limiter);
    const rendered = await context.render(false);
    const data = rendered.getChannelData(0);
    const first = data.findIndex((sample) => Math.abs(sample) > 1e-6);
    return first < 0 ? 0 : first;
  } finally {
    context.dispose();
  }
}
