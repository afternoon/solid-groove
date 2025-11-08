import * as Tone from "tone";
import type {
	Instrument,
	SamplerInstrument,
	SynthInstrument,
	ClipInstrument,
} from "../model/types";

abstract class ToneInstrument {
	protected destination: Tone.ToneAudioNode;

	constructor(destination: Tone.ToneAudioNode) {
		this.destination = destination;
	}

	abstract trigger(
		note: string,
		duration: Tone.Unit.Time,
		time: Tone.Unit.Time,
	): void;

	abstract updateParams(instrument: Instrument): void;

	abstract getType(): Instrument["type"];

	abstract dispose(): void;
}

class ToneSampler extends ToneInstrument {
	private sampler: Tone.Sampler;
	private filter: Tone.Filter;
	private currentSampleUrl: string;

	constructor(config: SamplerInstrument, destination: Tone.ToneAudioNode) {
		super(destination);
		this.currentSampleUrl = config.sampleUrl;

		this.filter = new Tone.Filter({
			type: config.filter.type,
			frequency: config.filter.cutoff,
			Q: config.filter.resonance,
		});

		this.sampler = new Tone.Sampler({
			urls: {
				C3: config.sampleUrl,
			},
			onload: () => console.log("Sample loaded:", config.sampleUrl),
			envelope: {
				attack: config.envelope.attack,
				decay: config.envelope.decay,
				sustain: config.envelope.sustain,
				release: config.envelope.release,
			},
		}).connect(this.filter);

		this.filter.connect(destination);
	}

	trigger(note: string, duration: Tone.Unit.Time, time: Tone.Unit.Time): void {
		// Only trigger if the buffer is loaded
		if (this.sampler.loaded) {
			this.sampler.triggerAttackRelease(note, duration, time);
		}
	}

	updateParams(instrument: Instrument): void {
		if (instrument.type !== "sampler") return;

		this.filter.type = instrument.filter.type;
		this.filter.frequency.value = instrument.filter.cutoff;
		this.filter.Q.value = instrument.filter.resonance;

		this.sampler.attack = instrument.envelope.attack;
		this.sampler.release = instrument.envelope.release;

		if (this.currentSampleUrl !== instrument.sampleUrl) {
			console.log("Sample URL changed, reloading...");
			this.currentSampleUrl = instrument.sampleUrl;
			this.sampler.add("C3", instrument.sampleUrl);
		}
	}

	getType(): "sampler" {
		return "sampler";
	}

	dispose(): void {
		this.sampler.dispose();
		this.filter.dispose();
	}
}

class ToneSynth extends ToneInstrument {
	private synth: Tone.Synth;
	private filter: Tone.Filter;

	constructor(config: SynthInstrument, destination: Tone.ToneAudioNode) {
		super(destination);

		this.filter = new Tone.Filter({
			type: config.filter.type,
			frequency: config.filter.cutoff,
			Q: config.filter.resonance,
		});

		this.synth = new Tone.Synth({
			oscillator: {
				type: config.oscillatorType,
			},
			envelope: {
				attack: config.envelope.attack,
				decay: config.envelope.decay,
				sustain: config.envelope.sustain,
				release: config.envelope.release,
			},
		}).connect(this.filter);

		this.filter.connect(destination);
	}

	trigger(note: string, duration: Tone.Unit.Time, time: Tone.Unit.Time): void {
		this.synth.triggerAttackRelease(note, duration, time);
	}

	updateParams(instrument: Instrument): void {
		if (instrument.type !== "synth") return;

		this.synth.oscillator.type = instrument.oscillatorType;

		this.filter.type = instrument.filter.type;
		this.filter.frequency.value = instrument.filter.cutoff;
		this.filter.Q.value = instrument.filter.resonance;

		this.synth.envelope.attack = instrument.envelope.attack;
		this.synth.envelope.decay = instrument.envelope.decay;
		this.synth.envelope.sustain = instrument.envelope.sustain;
		this.synth.envelope.release = instrument.envelope.release;
	}

	getType(): "synth" {
		return "synth";
	}

	dispose(): void {
		this.synth.dispose();
		this.filter.dispose();
	}
}

class ToneClip extends ToneInstrument {
	private player: Tone.Player;
	private currentSampleUrl: string;
	private sampleTempo: number;

	constructor(config: ClipInstrument, destination: Tone.ToneAudioNode) {
		super(destination);
		this.currentSampleUrl = config.sampleUrl;
		this.sampleTempo = config.sampleTempo;

		this.player = new Tone.Player({
			url: config.sampleUrl,
			onload: () => console.log("Clip loaded:", config.sampleUrl),
		}).connect(destination);
	}

	trigger(note: string, duration: Tone.Unit.Time, time: Tone.Unit.Time): void {
		// Only trigger if the buffer is loaded
		if (!this.player.loaded) return;

		// For clips, we adjust playback rate based on transport tempo vs sample tempo
		const transportBPM = Tone.getTransport().bpm.value;
		const playbackRate = transportBPM / this.sampleTempo;
		this.player.playbackRate = playbackRate;
		this.player.start(time);
	}

	updateParams(instrument: Instrument): void {
		if (instrument.type !== "clip") return;

		this.sampleTempo = instrument.sampleTempo;

		// If sample URL changed, reload
		if (this.currentSampleUrl !== instrument.sampleUrl) {
			console.log("Clip URL changed, reloading...");
			this.currentSampleUrl = instrument.sampleUrl;
			this.player.load(instrument.sampleUrl);
		}
	}

	getType(): "clip" {
		return "clip";
	}

	dispose(): void {
		this.player.dispose();
	}
}

export function createToneInstrument(
	instrument: Instrument,
	destination: Tone.ToneAudioNode,
): ToneInstrument {
	switch (instrument.type) {
		case "sampler":
			return new ToneSampler(instrument, destination);
		case "synth":
			return new ToneSynth(instrument, destination);
		case "clip":
			return new ToneClip(instrument, destination);
		default:
			throw new Error(`Unknown instrument type: ${(instrument as any).type}`);
	}
}

export type { ToneInstrument };
