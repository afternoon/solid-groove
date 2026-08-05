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
 * A polyphonic subtractive synth voice: oscillator + amp envelope (`PolySynth`
 * over `Tone.Synth`) into one shared resonant low-pass `Tone.Filter`.
 *
 * `update()` reuses every node. Oscillator waveform and envelope stages are set
 * on the poly synth's voice defaults, so they apply to the *next* note without
 * disturbing notes already sounding. Filter cutoff and Q — the two continuous,
 * automatable controls — ramp over `SMOOTHING_SECONDS` so a live sweep never
 * clicks. The node is only ever replaced when the instrument `kind` changes,
 * never for a parameter edit.
 */
export function createSynthInstrumentNode(
	instrument: SynthInstrument,
	_context: InstrumentGraphContext,
): InstrumentNode {
	const settings = readSynthSettings(instrument);
	const synth = new Tone.PolySynth(Tone.Synth);
	const filter = new Tone.Filter({
		type: "lowpass",
		frequency: settings.cutoff,
		Q: settings.resonance,
	});
	const output = new Tone.Gain(1);
	synth.connect(filter);
	filter.connect(output);

	function applyVoiceDefaults(next: SynthSettings): void {
		synth.set({
			oscillator: { type: next.waveform },
			envelope: {
				attack: next.attack,
				decay: next.decay,
				sustain: next.sustain,
				release: next.release,
			},
		});
	}
	applyVoiceDefaults(settings);

	return {
		kind: "synth",
		output,
		trigger(trigger, time, duration, velocity) {
			if (trigger.kind !== "pitch") return;
			const note = Tone.Frequency(trigger.pitch, "midi").toNote();
			synth.triggerAttackRelease(note, duration, time, velocity);
		},
		update(next) {
			if (next.kind !== "synth") return;
			const resolved = readSynthSettings(next);
			applyVoiceDefaults(resolved);
			// The filter is a live, always-connected node — ramp it rather than
			// jumping, so automating cutoff/resonance during playback is smooth.
			filter.frequency.rampTo(resolved.cutoff, SMOOTHING_SECONDS);
			filter.Q.rampTo(resolved.resonance, SMOOTHING_SECONDS);
		},
		dispose() {
			synth.dispose();
			filter.dispose();
			output.dispose();
		},
	};
}
