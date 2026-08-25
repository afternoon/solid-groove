import * as Tone from "tone";
import { type DeviceCore, type DeviceCoreFactory, setOrRamp } from "./types";

/**
 * Reverb: pre-delay into a decaying tail, with a damping filter (PRD FX-01:
 * "Reverb supports decay/size, pre-delay, filtering, and wet/dry control").
 *
 * `Tone.Reverb` generates its impulse response from `decay` and `preDelay`, and
 * regenerating it is asynchronous — so `decay` and `size` are the two controls
 * that cannot be a plain `AudioParam` ramp. Assigning either setter regenerates
 * the impulse *on the same node* (which is why nothing here calls `generate()`
 * explicitly — that would be a second, redundant rebuild), and the guard below
 * assigns only when the value actually changed, so an unrelated edit (wet,
 * filter, bypass) never pays for a regeneration and never interrupts a ringing
 * tail.
 *
 * `size` scales the pre-delay and the decay together — a small bright box
 * versus a large hall — while `decay` sets how long the tail lasts, which is
 * what makes the two independently useful rather than one control twice.
 */
export const createReverbCore: DeviceCoreFactory = (): DeviceCore => {
  const reverb = new Tone.Reverb({ decay: 2.5, preDelay: 0.01 });
  const damping = new Tone.Filter({ type: "lowpass", frequency: 6_000 });
  reverb.connect(damping);

  let lastDecay = Number.NaN;
  let lastSize = Number.NaN;
  let lastPreDelay = Number.NaN;

  return {
    input: reverb,
    output: damping,
    apply(values, _context, initial) {
      const sizeChanged = values.size !== lastSize;
      if (values.decay !== lastDecay || sizeChanged || values.predelay !== lastPreDelay) {
        lastDecay = values.decay;
        lastSize = values.size;
        lastPreDelay = values.predelay;
        // Size stretches the tail between half and double the stated decay,
        // so the two controls compose instead of one overriding the other.
        reverb.decay = Math.max(0.001, values.decay * (0.5 + values.size));
        // A larger room's first reflection arrives later; the stated
        // pre-delay is the floor, size adds up to 50 ms of distance on top.
        reverb.preDelay = values.predelay + values.size * 0.05;
      }
      setOrRamp(damping.frequency, values.filter, initial);
    },
    ready: () => reverb.ready,
    dispose() {
      reverb.dispose();
      damping.dispose();
    },
  };
};
