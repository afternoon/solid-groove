import * as Tone from "tone";
import type { DrumPad, Instrument, NoteTrigger } from "../domain/entities";
import type { AssetId, PadId } from "../domain/ids";
import {
	readInstrumentParameter,
	SAMPLER_AMP_ATTACK,
	SAMPLER_AMP_DECAY,
	SAMPLER_AMP_RELEASE,
	SAMPLER_AMP_SUSTAIN,
	SAMPLER_PITCH,
	SAMPLER_SAMPLE_END,
	SAMPLER_SAMPLE_START,
	SYNTH_AMP_ATTACK,
	SYNTH_AMP_DECAY,
	SYNTH_AMP_RELEASE,
	SYNTH_AMP_SUSTAIN,
	SYNTH_FILTER_CUTOFF,
	SYNTH_FILTER_RESONANCE,
	SYNTH_WAVEFORM,
	synthWaveform,
} from "../domain/parameters";
import type { AudioAssetProjection } from "../projection/audioProjection";
import type { AudioBufferCache, BufferSubscription } from "./AudioBufferCache";
import type { AudioProjectScope } from "./AudioRuntime";

/** Continuous parameter edits ramp over this window rather than stepping, so a
 * cutoff sweep or a filter-Q change never clicks (AUD "safe smoothing"). */
const SMOOTHING_SECONDS = 0.02;

/** Schema v1 models `Instrument` as one discriminated union rather than
 * exporting each variant separately; these local aliases narrow it by `kind`
 * for the factory below. */
type SamplerInstrument = Extract<Instrument, { kind: "sampler" }>;
type SynthInstrument = Extract<Instrument, { kind: "synth" }>;
type DrumMachineInstrument = Extract<Instrument, { kind: "drumMachine" }>;

/**
 * A track's sound source, keyed to the track by the track graph that owns it
 * (PRD AUD-08, section 9.7). `update()` applies an instrument of the *same*
 * `kind` in place — asset swaps, drum-pad add/remove, and generic parameter
 * edits are all handled without replacing this node. The owning
 * `TrackAudioGraph` only ever replaces the whole node when `kind` itself
 * changes (sampler <-> synth <-> drumMachine, or null <-> present).
 */
export interface InstrumentNode {
	readonly kind: Instrument["kind"];
	readonly output: Tone.ToneAudioNode;
	trigger(
		trigger: NoteTrigger,
		time: Tone.Unit.Time,
		duration: Tone.Unit.Time,
		velocity: number,
	): void;
	update(instrument: Instrument): void;
	dispose(): void;
}

export interface InstrumentGraphContext {
	readonly scope: AudioProjectScope;
	readonly assetsById: ReadonlyMap<AssetId, AudioAssetProjection>;
	readonly bufferCache: AudioBufferCache<Tone.ToneAudioBuffer>;
}

export type InstrumentNodeFactory = (
	instrument: Instrument,
	context: InstrumentGraphContext,
) => InstrumentNode;

/**
 * Plays `buffer` once through `destination`, self-disposing once it stops —
 * the "short-lived source node" AUD-08 explicitly permits per note/trigger,
 * as long as its schedule and references don't accumulate after completion.
 *
 * `offsetSeconds` is a position inside the buffer's own timeline, so a clip
 * or placement trimmed at its left edge starts from the material the
 * arrangement draws rather than from sample zero.
 */
export function playOneShot(
	buffer: Tone.ToneAudioBuffer,
	destination: Tone.ToneAudioNode,
	time: Tone.Unit.Time,
	duration: Tone.Unit.Time,
	playbackRate = 1,
	offsetSeconds = 0,
): void {
	const player = new Tone.Player(buffer).connect(destination);
	player.playbackRate = playbackRate;
	player.onstop = () => player.dispose();
	player.start(time, offsetSeconds, duration);
}

/** A live subscription to one asset's decoded buffer, reattachable to a new asset id. */
interface AssetVoice {
	assetId: AssetId | null;
	buffer: Tone.ToneAudioBuffer | null;
	subscription: BufferSubscription | null;
	subscriptionHandle: ReturnType<AudioProjectScope["register"]> | null;
}

function createAssetVoice(): AssetVoice {
	return {
		assetId: null,
		buffer: null,
		subscription: null,
		subscriptionHandle: null,
	};
}

function attachAssetVoice(
	voice: AssetVoice,
	context: InstrumentGraphContext,
	assetId: AssetId | null,
): void {
	voice.subscription?.release();
	voice.subscription = null;
	if (voice.subscriptionHandle) {
		void context.scope.release(voice.subscriptionHandle);
		voice.subscriptionHandle = null;
	}
	voice.buffer = null;
	voice.assetId = assetId;
	if (!assetId) return;

	const asset = context.assetsById.get(assetId);
	if (!asset) return;

	voice.subscriptionHandle = context.scope.register("subscription", () => {});
	voice.subscription = context.bufferCache.subscribe(asset, (buffer) => {
		voice.buffer = buffer;
	});
}

function releaseAssetVoice(voice: AssetVoice, scope: AudioProjectScope): void {
	voice.subscription?.release();
	voice.subscription = null;
	if (voice.subscriptionHandle) {
		void scope.release(voice.subscriptionHandle);
		voice.subscriptionHandle = null;
	}
	voice.buffer = null;
}

// --- Sampler -----------------------------------------------------------

/** The sampler's playback + envelope settings, resolved from its parameters. */
interface SamplerSettings {
	pitch: number;
	sampleStart: number;
	sampleEnd: number;
	attack: number;
	decay: number;
	sustain: number;
	release: number;
}

function readSamplerSettings(instrument: SamplerInstrument): SamplerSettings {
	const p = instrument.parameters;
	return {
		pitch: readInstrumentParameter(SAMPLER_PITCH, p),
		sampleStart: readInstrumentParameter(SAMPLER_SAMPLE_START, p),
		sampleEnd: readInstrumentParameter(SAMPLER_SAMPLE_END, p),
		attack: readInstrumentParameter(SAMPLER_AMP_ATTACK, p),
		decay: readInstrumentParameter(SAMPLER_AMP_DECAY, p),
		sustain: readInstrumentParameter(SAMPLER_AMP_SUSTAIN, p),
		release: readInstrumentParameter(SAMPLER_AMP_RELEASE, p),
	};
}

/**
 * Plays `buffer` once, pitched and windowed to the sampler's settings, through
 * a per-trigger amplitude envelope that self-disposes when the note is done —
 * the short-lived voice AUD-08 permits, as long as it leaves nothing scheduled
 * behind it. Voices carry no reference to the instrument, so a settings edit
 * mid-note never mutates a note already sounding.
 */
function playSampledVoice(
	buffer: Tone.ToneAudioBuffer,
	destination: Tone.ToneAudioNode,
	settings: SamplerSettings,
	time: Tone.Unit.Time,
	duration: Tone.Unit.Time,
	velocity: number,
): void {
	const bufferSeconds = buffer.duration;
	const offset = clampUnit(settings.sampleStart) * bufferSeconds;
	const end = clampUnit(settings.sampleEnd) * bufferSeconds;
	const windowSeconds = Math.max(0, end - offset);
	if (windowSeconds <= 0) return;

	const envelope = new Tone.AmplitudeEnvelope({
		attack: settings.attack,
		decay: settings.decay,
		sustain: settings.sustain,
		release: settings.release,
	}).connect(destination);
	// Velocity scales the peak so a soft hit is quieter, without touching the
	// envelope's own shape.
	const gain = new Tone.Gain(velocity).connect(envelope);
	const player = new Tone.Player(buffer).connect(gain);
	player.playbackRate = 2 ** (settings.pitch / 12);

	// The audible slice is the sample window, but the amp envelope's release
	// tail is what actually ends the voice; hold the player through both.
	const holdSeconds = Math.min(
		windowSeconds / player.playbackRate,
		Tone.Time(duration).toSeconds(),
	);
	envelope.triggerAttackRelease(holdSeconds, time, velocity);
	player.start(time, offset, windowSeconds);
	player.onstop = () => {
		player.dispose();
		gain.dispose();
		// The envelope's release runs past the player's stop, so let it ring out
		// before disposal rather than cutting the tail.
		const releaseMs = (settings.release + 0.05) * 1000;
		setTimeout(() => envelope.dispose(), releaseMs);
	};
}

/** Folds a stored 0..1 position into range, guarding a bad projected value. */
function clampUnit(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.min(1, Math.max(0, value));
}

function createSamplerInstrumentNode(
	instrument: SamplerInstrument,
	context: InstrumentGraphContext,
): InstrumentNode {
	const output = new Tone.Gain(1);
	const voice = createAssetVoice();
	attachAssetVoice(voice, context, instrument.assetId);
	let settings = readSamplerSettings(instrument);

	return {
		kind: "sampler",
		output,
		trigger(trigger, time, duration, velocity) {
			if (trigger.kind !== "pitch" || !voice.buffer) return;
			playSampledVoice(
				voice.buffer,
				output,
				settings,
				time,
				duration,
				velocity,
			);
		},
		update(next) {
			if (next.kind !== "sampler") return;
			if (next.assetId !== voice.assetId) {
				// A new asset id abandons the old subscription; `AudioBufferCache`
				// generation tracking cancels any in-flight decode of the old sample
				// so a stale load can never reconnect.
				attachAssetVoice(voice, context, next.assetId);
			}
			// Playback and envelope settings are read on the *next* trigger; there is
			// no persistent node to smooth, so this is a plain assignment. Notes
			// already sounding keep the settings they were triggered with.
			settings = readSamplerSettings(next);
		},
		dispose() {
			releaseAssetVoice(voice, context.scope);
			output.dispose();
		},
	};
}

// --- Synth ---------------------------------------------------------------

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
function createSynthInstrumentNode(
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

// --- Drum machine ----------------------------------------------------------

interface DrumPadVoice extends AssetVoice {
	readonly gain: Tone.Gain;
}

function createDrumPadVoice(
	pad: DrumPad,
	context: InstrumentGraphContext,
	destination: Tone.ToneAudioNode,
): DrumPadVoice {
	const gain = new Tone.Gain(
		dbToLinear(pad.mixer.muted ? null : pad.mixer.volume),
	).connect(destination);
	const voice: DrumPadVoice = { ...createAssetVoice(), gain };
	attachAssetVoice(voice, context, pad.assetId);
	return voice;
}

function updateDrumPadMixer(
	voice: DrumPadVoice,
	mixer: DrumPad["mixer"],
): void {
	voice.gain.gain.rampTo(dbToLinear(mixer.muted ? null : mixer.volume), 0.02);
}

/** `null` (muted) collapses to silence; otherwise converts the stored decibel value to linear gain. */
function dbToLinear(db: number | null): number {
	return db === null ? 0 : Tone.dbToGain(db);
}

function createDrumMachineInstrumentNode(
	instrument: DrumMachineInstrument,
	context: InstrumentGraphContext,
): InstrumentNode {
	const output = new Tone.Gain(1);
	const voices = new Map<PadId, DrumPadVoice>();

	function reconcilePads(pads: readonly DrumPad[]): void {
		const nextIds = new Set(pads.map((pad) => pad.id));
		for (const [id, voice] of voices) {
			if (!nextIds.has(id)) {
				releaseAssetVoice(voice, context.scope);
				voice.gain.dispose();
				voices.delete(id);
			}
		}
		for (const pad of pads) {
			const existing = voices.get(pad.id);
			if (existing) {
				if (existing.assetId !== pad.assetId) {
					attachAssetVoice(existing, context, pad.assetId);
				}
				updateDrumPadMixer(existing, pad.mixer);
			} else {
				voices.set(pad.id, createDrumPadVoice(pad, context, output));
			}
		}
	}
	reconcilePads(instrument.pads);

	return {
		kind: "drumMachine",
		output,
		trigger(trigger, time, duration) {
			if (trigger.kind !== "pad") return;
			const voice = voices.get(trigger.padId);
			if (!voice?.buffer) return;
			playOneShot(voice.buffer, voice.gain, time, duration);
		},
		update(next) {
			if (next.kind !== "drumMachine") return;
			reconcilePads(next.pads);
		},
		dispose() {
			for (const voice of voices.values()) {
				releaseAssetVoice(voice, context.scope);
				voice.gain.dispose();
			}
			voices.clear();
			output.dispose();
		},
	};
}

// --- Factory ---------------------------------------------------------------

export function createInstrumentNode(
	instrument: Instrument,
	context: InstrumentGraphContext,
): InstrumentNode {
	switch (instrument.kind) {
		case "sampler":
			return createSamplerInstrumentNode(instrument, context);
		case "synth":
			return createSynthInstrumentNode(instrument, context);
		case "drumMachine":
			return createDrumMachineInstrumentNode(instrument, context);
	}
}
