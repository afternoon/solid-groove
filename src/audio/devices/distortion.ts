import * as Tone from "tone";
import { type DeviceCore, type DeviceCoreFactory, setOrRamp } from "./types";

/**
 * How finely a waveshaping curve is sampled. 1024 points resolve the knee of
 * even the hardest curve without the table itself becoming an audible
 * quantizer, and rebuilding one is cheap enough to do on a parameter edit.
 */
const CURVE_POINTS = 1024;

/** Fills a waveshaper table over the -1..1 input range from a transfer function. */
function buildCurve(transfer: (x: number) => number): Float32Array {
	const curve = new Float32Array(CURVE_POINTS);
	for (let i = 0; i < CURVE_POINTS; i++) {
		const x = (i / (CURVE_POINTS - 1)) * 2 - 1;
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
 * symmetric buzz a plain `Math.tanh` produces. Post-gain pulls the level back
 * as drive climbs so pushing it reads as dirt rather than as a volume knob.
 */
export const createOverdriveCore: DeviceCoreFactory = (): DeviceCore => {
	const preGain = new Tone.Gain(1);
	const shaper = new Tone.WaveShaper(
		buildCurve((x) => {
			const asymmetry = x < 0 ? 1.4 : 1;
			return Math.tanh(3 * asymmetry * x) / Math.tanh(3);
		}),
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
			// 1x (clean, barely touching the knee) up to 40x (hard, obviously
			// destructive clipping). Squared so the control's lower half is the
			// usable coloration range rather than all the audible change happening
			// in the first tenth of the travel.
			const gain = 1 + values.drive ** 2 * 39;
			setOrRamp(preGain.gain, gain, initial);
			// Partial compensation: enough that drive is not a disguised volume
			// control, not so much that saturation stops reading as loud.
			setOrRamp(postGain.gain, gain ** -0.5, initial);
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
 * digital fold at 1. Because a `WaveShaperNode`'s `curve` may only be assigned
 * once, the morph is a *crossfade between two static shapers* rather than a
 * rebuilt curve; that keeps `character` a continuous, rampable control that
 * never replaces a node (FX-01: parameter changes do not rebuild nodes).
 */
export const createSaturatorCore: DeviceCoreFactory = (): DeviceCore => {
	const preGain = new Tone.Gain(1);
	const soft = new Tone.WaveShaper(
		buildCurve((x) => Math.tanh(2 * x) / Math.tanh(2)),
	);
	// A hard fold: past the knee the curve turns back on itself, which is the
	// deliberately destructive end FX-02 asks to remain reachable — bounded, but
	// obviously broken-sounding.
	const hard = new Tone.WaveShaper(
		buildCurve((x) => Math.sin(Math.PI * Math.max(-1.5, Math.min(1.5, x)))),
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
			setOrRamp(preGain.gain, 10 ** (values.drive / 20), initial);
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
