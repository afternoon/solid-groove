// The polyphonic subtractive synth node: a PolySynth into one smoothed
// low-pass filter.

import * as Tone from "tone";
import {
  readInstrumentParameter,
  SYNTH_AMP_ATTACK,
  SYNTH_AMP_DECAY,
  SYNTH_AMP_RELEASE,
  SYNTH_AMP_SUSTAIN,
  SYNTH_FILTER_CUTOFF,
  SYNTH_FILTER_RESONANCE,
  SYNTH_WAVEFORM,
  synthWaveform,
} from "../../domain/parameters";
import { SummingBus } from "../summingBus";
import { disposeFinishedVoice } from "./assetVoice";
import {
  type InstrumentGraphContext,
  type InstrumentNode,
  SMOOTHING_SECONDS,
  type SynthInstrument,
} from "./types";

interface SynthSettings {
  waveform: ReturnType<typeof synthWaveform>;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  cutoff: number;
  resonance: number;
}

function readSynthSettings(instrument: SynthInstrument): SynthSettings {
  const p = instrument.parameters;
  return {
    waveform: synthWaveform(readInstrumentParameter(SYNTH_WAVEFORM, p)),
    attack: readInstrumentParameter(SYNTH_AMP_ATTACK, p),
    decay: readInstrumentParameter(SYNTH_AMP_DECAY, p),
    sustain: readInstrumentParameter(SYNTH_AMP_SUSTAIN, p),
    release: readInstrumentParameter(SYNTH_AMP_RELEASE, p),
    cutoff: readInstrumentParameter(SYNTH_FILTER_CUTOFF, p),
    resonance: readInstrumentParameter(SYNTH_FILTER_RESONANCE, p),
  };
}

/**
 * A polyphonic subtractive synth: one `Tone.Synth` (oscillator + amp envelope)
 * per note, summed into one shared resonant low-pass `Tone.Filter`.
 *
 * Each note is its own short-lived voice, like a sampler note, that disposes
 * itself once its release has finished. The voices sum through a
 * {@link SummingBus} rather than a `PolySynth`, whose voices all connect to one
 * node and so sum a chord in a different order every render (#867).
 *
 * `update()` reuses every persistent node. Oscillator waveform and envelope
 * stages are read when a note starts, so they apply to the *next* note without
 * disturbing notes already sounding. Filter cutoff and Q — the two continuous,
 * automatable controls — ramp over `SMOOTHING_SECONDS` so a live sweep never
 * clicks. The node is only ever replaced when the instrument `kind` changes,
 * never for a parameter edit.
 */
export function createSynthInstrumentNode(
  instrument: SynthInstrument,
  _context: InstrumentGraphContext,
): InstrumentNode {
  let settings = readSynthSettings(instrument);
  const voices = new SummingBus();
  const filter = new Tone.Filter({
    type: "lowpass",
    frequency: settings.cutoff,
    Q: settings.resonance,
  });
  const output = new Tone.Gain(1);
  voices.output.connect(filter);
  filter.connect(output);

  return {
    kind: "synth",
    output,
    trigger(trigger, time, duration, velocity) {
      if (trigger.kind !== "pitch") return;
      const note = Tone.Frequency(trigger.pitch, "midi").toNote();
      const voice = new Tone.Synth({
        oscillator: { type: settings.waveform },
        envelope: {
          attack: settings.attack,
          decay: settings.decay,
          sustain: settings.sustain,
          release: settings.release,
        },
      });
      const detach = voices.add(voice);
      // Fires once the release has run out and the oscillator has stopped.
      voice.onsilence = () =>
        disposeFinishedVoice(voice, () => {
          detach();
          voice.dispose();
        });
      voice.triggerAttackRelease(note, duration, time, velocity);
    },
    update(next) {
      if (next.kind !== "synth") return;
      const resolved = readSynthSettings(next);
      settings = resolved;
      // The filter is a live, always-connected node — ramp it rather than
      // jumping, so automating cutoff/resonance during playback is smooth.
      filter.frequency.rampTo(resolved.cutoff, SMOOTHING_SECONDS);
      filter.Q.rampTo(resolved.resonance, SMOOTHING_SECONDS);
    },
    dispose() {
      voices.dispose();
      filter.dispose();
      output.dispose();
    },
  };
}
