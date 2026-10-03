import * as Tone from "tone";
import {
  OVERDRIVE_HEADROOM,
  overdriveCurve,
  overdriveGain,
  overdriveMakeup,
} from "./overdriveCurves";
import {
  SATURATOR_HEADROOM,
  saturatorFoldCurve,
  saturatorSoftCurve,
} from "./saturatorCurves";
import { type DeviceCore, type DeviceCoreFactory, setOrRamp } from "./types";

/**
 * How finely a waveshaping curve is sampled. 1024 points resolve the knee of
 * even the hardest curve without the table itself becoming an audible
 * quantizer, and rebuilding one is cheap enough to do on a parameter edit.
 */
const CURVE_POINTS = 1024;

/**
 * Fills a waveshaper table from a transfer function. The table always spans
 * the node's -1..1 input; `span` is the signal level that maps to its ends, so
 * a curve built with span 4 is evaluated over -4..4 and expects the signal to
 * be scaled by 1/4 on the way in.
 */
function buildCurve(
  transfer: (x: number) => number,
  span = 1,
  points = CURVE_POINTS,
): Float32Array {
  const curve = new Float32Array(points);
  for (let i = 0; i < points; i++) {
    const x = ((i / (points - 1)) * 2 - 1) * span;
    const y = transfer(x);
    // The transfer functions below are all bounded, but clamping here is what
    // guarantees no curve can ever push an unsafe sample downstream, however
    // extreme a drive setting FX-02 allows.
    curve[i] = Math.max(-1, Math.min(1, y));
  }
  return curve;
}

/**
 * Overdrive: gain into a fixed asymmetric clipping curve, then a one-pole tone
 * tilt (PRD FX-01: "Overdrive and saturation expose drive and tone/character
 * controls and can move from subtle coloration to obvious destruction").
 *
 * `drive` is a *gain into* the curve, not a reshaping of it. That is both how a
 * real overdrive pedal works and a hard Web Audio constraint: a
 * `WaveShaperNode`'s `curve` may only be assigned once, so rebuilding it per
 * edit would force a node replacement on every drive change — exactly the
 * "rebuilds unrelated audio nodes" FX-01 forbids. Driving a static curve keeps
 * the whole control continuous and rampable.
 *
 * The curve's asymmetry — the negative half clipping sooner than the positive —
 * is what gives it even harmonics and its valve-ish character instead of the
 * symmetric buzz a plain `Math.tanh` produces. Both halves have unity slope, so
 * at Drive 0 a normal-level signal passes at its own level, and the table runs
 * +12 dB past full scale before it holds (see `overdriveCurves.ts`, #925).
 * Post-gain pulls the level back as drive climbs so pushing it reads as dirt
 * rather than as a volume knob.
 */
export const createOverdriveCore: DeviceCoreFactory = (): DeviceCore => {
  const preGain = new Tone.Gain(1);
  // The table spans ±OVERDRIVE_HEADROOM, so it gets proportionally more points
  // to keep the knee as finely resolved as a -1..1 table would.
  const shaper = new Tone.WaveShaper(
    buildCurve(
      overdriveCurve,
      OVERDRIVE_HEADROOM,
      CURVE_POINTS * (OVERDRIVE_HEADROOM / 2),
    ),
  );
  const postGain = new Tone.Gain(1);
  const tone = new Tone.Filter({ type: "lowpass", frequency: 8_000 });
  preGain.connect(shaper);
  shaper.connect(postGain);
  postGain.connect(tone);

  return {
    input: preGain,
    output: tone,
    apply(values, _context, initial) {
      // The drive gain (1x clean up to 120x destroyed, see `overdriveGain`),
      // scaled into the table's ±OVERDRIVE_HEADROOM span: a full-scale sample
      // at Drive 0 lands a quarter of the way out, on the curve.
      setOrRamp(preGain.gain, overdriveGain(values.drive) / OVERDRIVE_HEADROOM, initial);
      setOrRamp(postGain.gain, overdriveMakeup(values.drive), initial);
      // `tone` sweeps a lowpass from dark to open across the control's range,
      // logarithmically so the sweep is even to the ear.
      setOrRamp(tone.frequency, 400 * (20_000 / 400) ** values.tone, initial);
    },
    dispose() {
      preGain.dispose();
      shaper.dispose();
      postGain.dispose();
      tone.dispose();
    },
  };
};

/**
 * Saturator: input gain into two parallel transfer curves, crossfaded by
 * `character`, then output compensation (PRD FX-01).
 *
 * Unlike the overdrive it is driven in *decibels* — `saturator.drive` runs to
 * +48 dB — and `character` morphs the transfer shape itself rather than only
 * how hard the signal hits it: a gentle tape-style soft knee at 0, a hard
 * sine fold at 1. Both curves leave a normal-level signal at unity at 0 dB
 * drive, and both run +12 dB past full scale before the table holds (see
 * `saturatorCurves.ts`, #885). Because a `WaveShaperNode`'s `curve` may only be assigned
 * once, the morph is a *crossfade between two static shapers* rather than a
 * rebuilt curve; that keeps `character` a continuous, rampable control that
 * never replaces a node (FX-01: parameter changes do not rebuild nodes).
 */
export const createSaturatorCore: DeviceCoreFactory = (): DeviceCore => {
  const preGain = new Tone.Gain(1);
  // Both tables span ±SATURATOR_HEADROOM, so they get proportionally more
  // points to keep the knee as finely resolved as a -1..1 table would.
  const points = CURVE_POINTS * (SATURATOR_HEADROOM / 2);
  const soft = new Tone.WaveShaper(
    buildCurve(saturatorSoftCurve, SATURATOR_HEADROOM, points),
  );
  // A sine fold: past its peak the curve turns back on itself, which is the
  // deliberately destructive end FX-02 asks to remain reachable — bounded, but
  // obviously broken-sounding.
  const hard = new Tone.WaveShaper(
    buildCurve(saturatorFoldCurve, SATURATOR_HEADROOM, points),
  );
  const softGain = new Tone.Gain(1);
  const hardGain = new Tone.Gain(0);
  // Only part of the drive is given back after the curve. Compensating fully
  // would undo the loudness that makes saturation read as saturation;
  // compensating not at all would make drive a disguised volume knob.
  const postGain = new Tone.Gain(1);
  preGain.connect(soft);
  preGain.connect(hard);
  soft.connect(softGain);
  hard.connect(hardGain);
  softGain.connect(postGain);
  hardGain.connect(postGain);

  return {
    input: preGain,
    output: postGain,
    apply(values, _context, initial) {
      setOrRamp(softGain.gain, 1 - values.character, initial);
      setOrRamp(hardGain.gain, values.character, initial);
      // The drive, scaled into the tables' ±SATURATOR_HEADROOM span: a
      // full-scale sample at 0 dB lands a quarter of the way out, on the curve.
      setOrRamp(preGain.gain, 10 ** (values.drive / 20) / SATURATOR_HEADROOM, initial);
      setOrRamp(postGain.gain, 10 ** (-values.drive / 40), initial);
    },
    dispose() {
      preGain.dispose();
      soft.dispose();
      hard.dispose();
      softGain.dispose();
      hardGain.dispose();
      postGain.dispose();
    },
  };
};
