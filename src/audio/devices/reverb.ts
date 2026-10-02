import * as Tone from "tone";
import { type DeviceCore, type DeviceCoreFactory, setOrRamp } from "./types";

/**
 * Reverb: pre-delay into a decaying tail, with a damping filter (PRD FX-01:
 * "Reverb supports decay/size, pre-delay, filtering, and wet/dry control").
 *
 * The tail is a convolution with a decaying noise burst. The impulse response
 * is built here, from *seeded* noise ({@link reverbImpulse}), rather than by
 * `Tone.Reverb`, which renders it from `Tone.Noise` started at a random offset
 * into an unseeded buffer: that made every render of an unchanged song sound
 * different and end at a different length (#867). The same settings now always
 * give the same impulse, so an export is the same file every time.
 *
 * Building the impulse is synchronous, so `decay` and `size` (the two controls
 * that cannot be a plain `AudioParam` ramp) take effect at once, on the same
 * convolver, and there is no generation in flight for a render to wait on. The
 * guard below rebuilds only when a value actually changed, so an unrelated edit
 * (wet, filter, bypass) never pays for one and never interrupts a ringing tail.
 *
 * `size` scales the pre-delay and the decay together — a small bright box
 * versus a large hall — while `decay` sets how long the tail lasts, which is
 * what makes the two independently useful rather than one control twice.
 */
export const createReverbCore: DeviceCoreFactory = (): DeviceCore => {
  const context = Tone.getContext();
  const input = new Tone.Gain();
  const convolver = context.createConvolver();
  const damping = new Tone.Filter({ type: "lowpass", frequency: 6_000 });
  input.connect(convolver);
  Tone.connect(convolver, damping);

  let lastDecay = Number.NaN;
  let lastSize = Number.NaN;
  let lastPreDelay = Number.NaN;

  return {
    input,
    output: damping,
    apply(values, _context, initial) {
      const sizeChanged = values.size !== lastSize;
      if (values.decay !== lastDecay || sizeChanged || values.predelay !== lastPreDelay) {
        lastDecay = values.decay;
        lastSize = values.size;
        lastPreDelay = values.predelay;
        // Size stretches the tail between half and double the stated decay,
        // so the two controls compose instead of one overriding the other.
        // A larger room's first reflection arrives later; the stated
        // pre-delay is the floor, size adds up to 50 ms of distance on top.
        const channels = reverbImpulse(
          context.sampleRate,
          Math.max(0.001, values.decay * (0.5 + values.size)),
          values.predelay + values.size * 0.05,
        );
        const buffer = context.createBuffer(
          channels.length,
          channels[0].length,
          context.sampleRate,
        );
        for (const [channel, data] of channels.entries()) {
          buffer.copyToChannel(data, channel);
        }
        convolver.buffer = buffer;
      }
      setOrRamp(damping.frequency, values.filter, initial);
    },
    dispose() {
      input.dispose();
      convolver.disconnect();
      damping.dispose();
    },
  };
};

/** Fixed seeds, one per channel, so the two sides decorrelate but never vary. */
const IMPULSE_SEEDS = [0x5eed_1ef7, 0x5eed_4161] as const;

/**
 * The reverb's stereo impulse response: white noise, silent for `preDelay`
 * seconds and then decaying over `decay` seconds, `decay + preDelay` long.
 *
 * The envelope is the one `Tone.Reverb` drew, so the tail sounds as it did:
 * an exponential approach to zero (time constant `ln(decay + 1) / ln(200)`)
 * held at 90% of the decay and ramped linearly to silence at its end. Only
 * the noise differs: it comes from a seeded generator, so the same arguments
 * always return the same samples.
 */
export function reverbImpulse(
  sampleRate: number,
  decay: number,
  preDelay: number,
): Float32Array<ArrayBuffer>[] {
  const length = Math.max(1, Math.round((decay + preDelay) * sampleRate));
  const start = Math.round(preDelay * sampleRate);
  const hold = Math.round((preDelay + decay * 0.9) * sampleRate);
  const last = length - 1;
  const timeConstant = Math.log(decay + 1) / Math.log(200);
  const step = Math.exp(-1 / (timeConstant * sampleRate));

  const envelope = new Float32Array(length);
  let gain = 1;
  for (let i = start; i < Math.min(hold, length); i++) {
    envelope[i] = gain;
    gain *= step;
  }
  const held = gain;
  for (let i = Math.max(start, hold); i < length; i++) {
    envelope[i] = held * ((last - i) / Math.max(1, last - hold));
  }

  return IMPULSE_SEEDS.map((seed) => {
    const random = mulberry32(seed);
    return envelope.map((level) => level * (random() * 2 - 1));
  });
}

/** A small, fast seeded PRNG returning uniform numbers in `[0, 1)`. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}
