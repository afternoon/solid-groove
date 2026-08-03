import * as Tone from "tone";
import type { DrumPad, Instrument, NoteTrigger } from "../domain/entities";
import type { AssetId, PadId } from "../domain/ids";
import { PAD_ATTACK, PAD_DECAY, PAD_PITCH } from "../domain/parameters";
import type { AudioAssetProjection } from "../projection/audioProjection";
import type { AudioBufferCache, BufferSubscription } from "./AudioBufferCache";
import type { AudioProjectScope } from "./AudioRuntime";

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

function createSamplerInstrumentNode(
	instrument: SamplerInstrument,
	context: InstrumentGraphContext,
): InstrumentNode {
	const output = new Tone.Gain(1);
	const voice = createAssetVoice();
	attachAssetVoice(voice, context, instrument.assetId);

	return {
		kind: "sampler",
		output,
		trigger(trigger, time, duration) {
			// Per-pitch playback rate and round-robin are Alpha Milestone 1 sampler-device
			// concerns; the v1 scaffold plays the loaded one-shot at normal rate
			// on any pitch trigger so the note-scheduling contract is provable
			// ahead of that DSP.
			if (trigger.kind !== "pitch" || !voice.buffer) return;
			playOneShot(voice.buffer, output, time, duration);
		},
		update(next) {
			if (next.kind !== "sampler") return;
			if (next.assetId !== voice.assetId) {
				attachAssetVoice(voice, context, next.assetId);
			}
		},
		dispose() {
			releaseAssetVoice(voice, context.scope);
			output.dispose();
		},
	};
}

// --- Synth ---------------------------------------------------------------

function createSynthInstrumentNode(
	_instrument: SynthInstrument,
	_context: InstrumentGraphContext,
): InstrumentNode {
	const synth = new Tone.PolySynth(Tone.Synth);
	const output = new Tone.Gain(1);
	synth.connect(output);

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
			// Schema v1 defines no synth parameters yet — Alpha Milestone 1 authors them
			// with the synth device (PRD section 9.5 invariant 10). `parameters`
			// is carried through for forward compatibility only.
		},
		dispose() {
			synth.dispose();
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
