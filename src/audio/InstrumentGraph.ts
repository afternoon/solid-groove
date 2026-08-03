import * as Tone from "tone";
import type { DrumPad, Instrument, NoteTrigger } from "../domain/entities";
import type { AssetId, PadId } from "../domain/ids";
import {
	PAD_ATTACK,
	PAD_DECAY,
	PAD_PITCH,
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

/** `null` (muted) collapses to silence; otherwise converts the stored decibel value to linear gain. */
function dbToLinear(db: number | null): number {
	return db === null ? 0 : Tone.dbToGain(db);
}

/** 2^(semitones/12) — a per-pad pitch offset as a playback-rate multiplier. */
function pitchToPlaybackRate(semitones: number): number {
	return 2 ** (semitones / 12);
}

/** Reads a registered pad parameter from a pad's `parameters` record, falling
 * back to the definition's default when the pad has never set it. */
function padParameterValue(
	pad: DrumPad,
	definition: { id: string; defaultValue: number },
): number {
	const key = definition.id.slice("pad.".length);
	const value = pad.parameters[key];
	return value === undefined ? definition.defaultValue : value;
}

/**
 * The stable per-pad state a drum machine keeps between triggers: the pad's
 * live buffer subscription, its persistent pan+level channel strip, its choke
 * group, and a handle to whatever short-lived voice is currently sounding (so
 * a choke can silence it).
 *
 * The channel strip persists; the sounding voice does not. Each trigger builds
 * a throwaway `Tone.Player` + envelope gain that self-disposes on stop, so
 * simultaneous hits never contend for one node and a completed hit leaves no
 * schedule or reference behind (PRD AUD-08).
 */
interface DrumPadStrip extends AssetVoice {
	/** After the envelope, before the output bus: pan then level/mute. */
	readonly panner: Tone.Panner;
	readonly level: Tone.Gain;
	chokeGroup: number | null;
	pitch: number;
	attack: number;
	decay: number;
	/** The voice currently sounding on this pad, if any. Choke stops it. */
	active: ActiveVoice | null;
}

/** One sounding hit: its player, its envelope gain, and its stop scheduler. */
interface ActiveVoice {
	readonly player: Tone.Player;
	readonly envelope: Tone.Gain;
	stopped: boolean;
}

function readPadDynamics(pad: DrumPad): {
	pitch: number;
	attack: number;
	decay: number;
} {
	return {
		pitch: padParameterValue(pad, PAD_PITCH),
		attack: padParameterValue(pad, PAD_ATTACK),
		decay: padParameterValue(pad, PAD_DECAY),
	};
}

function createDrumPadStrip(
	pad: DrumPad,
	context: InstrumentGraphContext,
	destination: Tone.ToneAudioNode,
): DrumPadStrip {
	const level = new Tone.Gain(
		dbToLinear(pad.mixer.muted ? null : pad.mixer.volume),
	).connect(destination);
	const panner = new Tone.Panner(pad.mixer.pan).connect(level);
	const dynamics = readPadDynamics(pad);
	const strip: DrumPadStrip = {
		...createAssetVoice(),
		panner,
		level,
		chokeGroup: pad.chokeGroup,
		active: null,
		...dynamics,
	};
	attachAssetVoice(strip, context, pad.assetId);
	return strip;
}

/** Reconciles a pad's persistent strip against an edited pad, without rebuilding
 * it. Pitch/attack/decay take effect on the *next* hit; pan/level smooth now. */
function updateDrumPadStrip(
	strip: DrumPadStrip,
	pad: DrumPad,
	context: InstrumentGraphContext,
): void {
	if (strip.assetId !== pad.assetId) {
		attachAssetVoice(strip, context, pad.assetId);
	}
	strip.level.gain.rampTo(
		dbToLinear(pad.mixer.muted ? null : pad.mixer.volume),
		0.02,
	);
	strip.panner.pan.rampTo(pad.mixer.pan, 0.02);
	strip.chokeGroup = pad.chokeGroup;
	const dynamics = readPadDynamics(pad);
	strip.pitch = dynamics.pitch;
	strip.attack = dynamics.attack;
	strip.decay = dynamics.decay;
}

function stopActiveVoice(voice: ActiveVoice, time: Tone.Unit.Time): void {
	if (voice.stopped) return;
	voice.stopped = true;
	// A short release so a choke or an overlapping re-hit does not click. The
	// player disposes itself via its own `onstop`, which the stop below fires.
	const releaseSeconds = 0.005;
	voice.envelope.gain.cancelScheduledValues(Tone.Time(time).toSeconds());
	voice.envelope.gain.setValueAtTime(
		voice.envelope.gain.value,
		Tone.Time(time).toSeconds(),
	);
	voice.envelope.gain.linearRampTo(0, releaseSeconds, time);
	voice.player.stop(Tone.Time(time).toSeconds() + releaseSeconds);
}

function releasePadStrip(strip: DrumPadStrip, scope: AudioProjectScope): void {
	if (strip.active && !strip.active.stopped) {
		strip.active.stopped = true;
		try {
			strip.active.player.stop();
		} catch {
			// The player may already have stopped and disposed; disposal is idempotent.
		}
	}
	strip.active = null;
	releaseAssetVoice(strip, scope);
	strip.panner.dispose();
	strip.level.dispose();
}

function createDrumMachineInstrumentNode(
	instrument: DrumMachineInstrument,
	context: InstrumentGraphContext,
): InstrumentNode {
	const output = new Tone.Gain(1);
	const strips = new Map<PadId, DrumPadStrip>();
	/**
	 * Every pad's own mute/solo lives in the pad mixer; "solo wins if any pad is
	 * soloed, and an explicit mute always wins over solo" is decided here, on the
	 * current pad set, so it is correct even mid-playback after an edit.
	 */
	let audiblePads = new Set<PadId>();

	function recomputeAudible(pads: readonly DrumPad[]): void {
		const anySolo = pads.some((pad) => pad.mixer.soloed);
		audiblePads = new Set(
			pads
				.filter((pad) => !pad.mixer.muted && (!anySolo || pad.mixer.soloed))
				.map((pad) => pad.id),
		);
	}

	function reconcilePads(pads: readonly DrumPad[]): void {
		const nextIds = new Set(pads.map((pad) => pad.id));
		for (const [id, strip] of strips) {
			if (!nextIds.has(id)) {
				releasePadStrip(strip, context.scope);
				strips.delete(id);
			}
		}
		for (const pad of pads) {
			const existing = strips.get(pad.id);
			if (existing) {
				updateDrumPadStrip(existing, pad, context);
			} else {
				strips.set(pad.id, createDrumPadStrip(pad, context, output));
			}
		}
		recomputeAudible(pads);
	}
	reconcilePads(instrument.pads);

	/** Stops every currently-sounding voice in `chokeGroup` other than `exceptId`. */
	function chokeGroup(
		group: number,
		exceptId: PadId,
		time: Tone.Unit.Time,
	): void {
		for (const [id, strip] of strips) {
			if (id === exceptId) continue;
			if (strip.chokeGroup === group && strip.active) {
				stopActiveVoice(strip.active, time);
				strip.active = null;
			}
		}
	}

	return {
		kind: "drumMachine",
		output,
		trigger(trigger, time, duration, velocity) {
			if (trigger.kind !== "pad") return;
			const strip = strips.get(trigger.padId);
			if (!strip?.buffer) return;
			if (!audiblePads.has(trigger.padId)) return;

			// A pad in a choke group silences both any earlier voice from another
			// pad in the same group and its own still-ringing voice, so a
			// hi-hat closes an open hat and a rapid re-hit does not stack.
			if (strip.chokeGroup !== null) {
				chokeGroup(strip.chokeGroup, trigger.padId, time);
			}
			if (strip.active) {
				stopActiveVoice(strip.active, time);
				strip.active = null;
			}

			const envelope = new Tone.Gain(0).connect(strip.panner);
			const player = new Tone.Player(strip.buffer).connect(envelope);
			player.playbackRate = pitchToPlaybackRate(strip.pitch);
			const voice: ActiveVoice = { player, envelope, stopped: false };
			strip.active = voice;

			const startSeconds = Tone.Time(time).toSeconds();
			const peak = Math.max(0, Math.min(1, velocity));
			// A short-lived AD amp envelope: ramp to the velocity peak over the
			// attack, then decay to silence. `decay` bounds the tail, so a long
			// sample under a short decay is a tight hit rather than a full loop.
			envelope.gain.setValueAtTime(0, startSeconds);
			envelope.gain.linearRampToValueAtTime(
				peak,
				startSeconds + Math.max(0.0005, strip.attack),
			);
			envelope.gain.linearRampToValueAtTime(
				0,
				startSeconds + Math.max(0.0005, strip.attack) + strip.decay,
			);

			// The scheduled note duration still bounds a very long decay; whichever
			// is shorter ends the voice. The player self-disposes on stop.
			const noteSeconds = Tone.Time(duration).toSeconds();
			const voiceSeconds = Math.min(
				strip.attack + strip.decay,
				Number.isFinite(noteSeconds) && noteSeconds > 0
					? noteSeconds
					: Number.POSITIVE_INFINITY,
			);
			player.onstop = () => {
				player.dispose();
				envelope.dispose();
				if (strip.active === voice) strip.active = null;
			};
			player.start(time, 0);
			if (Number.isFinite(voiceSeconds)) {
				player.stop(startSeconds + voiceSeconds);
			}
		},
		update(next) {
			if (next.kind !== "drumMachine") return;
			reconcilePads(next.pads);
		},
		dispose() {
			for (const strip of strips.values()) {
				releasePadStrip(strip, context.scope);
			}
			strips.clear();
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
