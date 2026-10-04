import * as Tone from "tone";
import { deviceParameters } from "../../domain/devices";
import { eqStageSettings } from "./eqResponse";
import {
  type DeviceCore,
  type DeviceCoreFactory,
  readDeviceParameters,
  setOrRamp,
} from "./types";

/** One biquad in the chain, and, for a cut, the path that switches it out. */
interface Stage {
  readonly filter: Tone.BiquadFilter;
  /** A cut's two legs: through the filter, and around it. */
  readonly through?: Tone.Gain;
  readonly around?: Tone.Gain;
  /** Where the stage's output leaves: the filter, or a cut's sum. */
  readonly output: Tone.ToneAudioNode;
}

/**
 * EQ: six bands — a low cut, a low shelf, two peaks, a high shelf and a high
 * cut — each switchable, in series (LOOP-022).
 *
 * Each band is a Web Audio biquad (a shelf, two: see `eqResponse.ts`), and
 * every value it takes is ramped through {@link setOrRamp}, so a frequency
 * sweep, a gain move or a band switched in or out is smooth rather than
 * zippered. Nothing is ever constructed or reconnected after the core is
 * built: the stage list is fixed, so a parameter edit never relinks.
 *
 * A shelf or a peak switched off is its own filter at 0 dB, which the
 * specification's coefficients make exactly the identity; a cut has no flat
 * setting, so it crossfades between a leg through its filter and a leg around
 * it. Switched off, the leg through is at gain 0, which contributes exact
 * zeros, so a fresh EQ (cuts off, every gain 0) passes its input unchanged.
 */
export const createEqCore: DeviceCoreFactory = (device): DeviceCore => {
  const input = new Tone.Gain(1);
  const output = new Tone.Gain(1);
  // The stage list's shape — which biquad type sits where — does not depend
  // on any value, so it is built once and every later edit only retunes it.
  const settings = eqStageSettings(readDeviceParameters(deviceParameters("eq"), device));

  const stages: Stage[] = settings.map((setting) => {
    const filter = new Tone.BiquadFilter({ type: setting.type });
    if (setting.type !== "highpass" && setting.type !== "lowpass") {
      return { filter, output: filter };
    }
    const through = new Tone.Gain(0);
    const around = new Tone.Gain(1);
    const sum = new Tone.Gain(1);
    filter.connect(through);
    through.connect(sum);
    around.connect(sum);
    return { filter, through, around, output: sum };
  });

  let previous: Tone.ToneAudioNode = input;
  for (const stage of stages) {
    previous.connect(stage.filter);
    if (stage.around) previous.connect(stage.around);
    previous = stage.output;
  }
  previous.connect(output);

  return {
    input,
    output,
    apply(values, _context, initial) {
      eqStageSettings(values).forEach((setting, index) => {
        const { filter, through, around } = stages[index];
        // A band can be set to 20 kHz; a context running below 40 kHz cannot
        // take that, and Tone refuses a value past Nyquist outright. Web Audio
        // would clamp it there anyway, so this changes no sound.
        const nyquist = filter.context.sampleRate / 2;
        setOrRamp(filter.frequency, Math.min(nyquist, setting.frequency), initial);
        setOrRamp(filter.Q, setting.q, initial);
        setOrRamp(filter.gain, setting.gain, initial);
        if (through && around) {
          setOrRamp(through.gain, setting.active ? 1 : 0, initial);
          setOrRamp(around.gain, setting.active ? 0 : 1, initial);
        }
      });
    },
    dispose() {
      for (const stage of stages) {
        stage.filter.dispose();
        stage.through?.dispose();
        stage.around?.dispose();
        if (stage.output !== stage.filter) stage.output.dispose();
      }
      input.dispose();
      output.dispose();
    },
  };
};
