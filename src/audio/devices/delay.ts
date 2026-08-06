import * as Tone from "tone";
import { delayDivision } from "../../domain/devices";
import {
	type DeviceCore,
	type DeviceCoreFactory,
	type DeviceParameterValues,
	setOrRamp,
} from "./types";

/** The longest delay line the device will allocate, in seconds. Bounds the
 * memory a synced delay can demand at a very slow tempo (FX-02: validation
 * "prevents ... runaway resource use"). */
const MAX_DELAY_SECONDS = 4;

/**
 * The delay time one channel should use, in seconds.
 *
 * When `sync` is on, the time comes from the song tempo and the stored
 * division; when it is off, `delay.time` is the delay in seconds and tempo is
 * irrelevant (FX-01: "Delay supports synced and free timing"). Either way the
 * result is clamped into the allocated delay line so a hostile stored value or
 * an extreme tempo cannot ask for an unbounded buffer.
 */
export function delaySeconds(
	values: DeviceParameterValues,
	tempo: number,
): number {
	const free = values.time;
	if (values.sync < 0.5) return Math.min(MAX_DELAY_SECONDS, Math.max(0, free));
	const safeTempo = Number.isFinite(tempo) && tempo > 0 ? tempo : 120;
	// A whole note is four beats, so `240 / bpm` seconds.
	const synced = (240 / safeTempo) * delayDivision(values.division).wholeNotes;
	return Math.min(MAX_DELAY_SECONDS, Math.max(0, synced));
}

/**
 * Tempo-syncable stereo delay with feedback and damping (PRD FX-01: "Delay
 * supports synced and free timing, feedback, filtering, stereo behavior, and
 * wet/dry control").
 *
 * The two channels each have their own delay line, and `spread` offsets the
 * right one by up to a full division — 0 is a centred mono delay, 1 a wide
 * ping-pong. Feedback is shared and passes through the damping filter, so each
 * repeat is darker than the last rather than a bright copy repeating forever;
 * that filter in the loop is also what keeps a near-unity feedback (0.99, the
 * top of the deliberately extreme range) a long decaying tail instead of a
 * runaway.
 *
 * Every control ramps on the existing nodes. A delay *time* change is ramped
 * too, which pitches the repeats as it moves — the tape-style behavior a
 * musician expects from turning a delay-time knob, and what a synced delay does
 * when the song tempo changes under it.
 */
export const createDelayCore: DeviceCoreFactory = (): DeviceCore => {
	const input = new Tone.Gain(1);
	const splitter = new Tone.Split();
	const left = new Tone.Delay({ maxDelay: MAX_DELAY_SECONDS });
	const right = new Tone.Delay({ maxDelay: MAX_DELAY_SECONDS });
	const damping = new Tone.Filter({ type: "lowpass", frequency: 8_000 });
	const feedback = new Tone.Gain(0);
	/**
	 * A soft saturator inside the feedback loop, bounding what can circulate.
	 *
	 * Feedback below 1 makes each *repeat* quieter than the last, but it does
	 * not bound the loop while the source is still feeding it: fresh input keeps
	 * adding to what is already circulating, and at the top of the range (0.99)
	 * that sums to roughly 1/(1-g) ≈ 100x before it settles. Measured without
	 * this stage the device handed on a peak of ~16, which is precisely the
	 * "unsafe output level" FX-02 requires validation to prevent — and leaving it
	 * to the master limiter would mean every device after this one in the chain
	 * still sees the overload.
	 *
	 * A tanh curve is the right shape rather than a hard clamp: it bounds the
	 * loop to ±1 while staying smooth, so a long tail saturates gently into the
	 * classic tape-delay warmth instead of buzzing. It is inaudible at ordinary
	 * feedback settings, where the loop never approaches the knee.
	 */
	const feedbackLimit = new Tone.WaveShaper((x: number) => Math.tanh(x), 1024);
	const merger = new Tone.Merge();
	const output = new Tone.Gain(1);

	input.connect(splitter);
	splitter.connect(left, 0, 0);
	splitter.connect(right, 1, 0);
	left.connect(merger, 0, 0);
	right.connect(merger, 0, 1);
	// One shared feedback path through the damping filter and the loop limiter,
	// folded back into the input so both channels' repeats decay together and
	// stay in step.
	merger.connect(damping);
	damping.connect(feedback);
	feedback.connect(feedbackLimit);
	feedbackLimit.connect(input);
	merger.connect(output);

	return {
		input,
		output,
		apply(values, ctx, initial) {
			const base = delaySeconds(values, ctx.tempo());
			setOrRamp(left.delayTime, base, initial);
			// The right channel trails by up to one more division's worth, still
			// inside the allocated line.
			setOrRamp(
				right.delayTime,
				Math.min(MAX_DELAY_SECONDS, base * (1 + values.spread)),
				initial,
			);
			setOrRamp(feedback.gain, values.feedback, initial);
			setOrRamp(damping.frequency, values.filter, initial);
		},
		dispose() {
			// Break the feedback loop first: a cycle left connected while its nodes
			// are torn down one at a time is the classic way to strand a live
			// path in the graph.
			feedback.disconnect();
			feedbackLimit.disconnect();
			input.dispose();
			splitter.dispose();
			left.dispose();
			right.dispose();
			damping.dispose();
			feedback.dispose();
			feedbackLimit.dispose();
			merger.dispose();
			output.dispose();
		},
	};
};
