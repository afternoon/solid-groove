import * as Tone from "tone";
import type { NoteTrigger, Send } from "../domain/entities";
import type { AssetId, DeviceId, ReturnId, TrackId } from "../domain/ids";
import type {
	AudioAssetProjection,
	AudioTrackProjection,
} from "../projection/audioProjection";
import type { AudioBufferCache } from "./AudioBufferCache";
import type { AudioProjectScope } from "./AudioRuntime";
import {
	DeviceChain,
	type DeviceNode,
	type DeviceNodeFactory,
} from "./DeviceChain";
import {
	createInstrumentNode,
	type InstrumentNode,
	type InstrumentNodeFactory,
} from "./InstrumentGraph";

/**
 * The ramp time applied to every continuous channel-strip change — volume,
 * pan, and send level (PRD TRK-02: "No control change creates audible zipper
 * noise under normal use"). Short enough to feel instant, long enough that a
 * fader move glides the gain instead of stepping it sample-to-sample.
 */
export const MIXER_SMOOTHING_SECONDS = 0.02;

/** One track's send: which return it targets, its own gain node, and which
 * fader stage it currently taps (needed to reconnect in place if `preFader`
 * flips without the send itself being added or removed). */
interface TrackedSend {
	readonly gain: Tone.Gain;
	readonly handle: ReturnType<AudioProjectScope["register"]>;
	preFader: boolean;
}

export interface TrackAudioGraphContext {
	readonly scope: AudioProjectScope;
	readonly assetsById: ReadonlyMap<AssetId, AudioAssetProjection>;
	readonly bufferCache: AudioBufferCache<Tone.ToneAudioBuffer>;
	getReturnInput(id: ReturnId): Tone.ToneAudioNode | undefined;
	readonly createInstrument?: InstrumentNodeFactory;
	readonly createDeviceNode?: DeviceNodeFactory;
}

/**
 * One track's audio subgraph, keyed by the track's stable id (PRD AUD-08,
 * section 9.7): an instrument, an ordered device chain, sends, and a
 * channel-strip (pan/volume/mute). Reconciling against an unchanged
 * `AudioTrackProjection` (the exact object reference the audio projection
 * handed back last time) is a complete no-op — renaming, reordering, or any
 * other non-audio edit to this track never touches its nodes.
 */
export class TrackAudioGraph {
	readonly id: TrackId;
	private readonly deviceChain: DeviceChain;
	private readonly panVol: Tone.PanVol;
	private readonly panVolHandle: ReturnType<AudioProjectScope["register"]>;
	private readonly meter: Tone.Meter;
	private readonly meterHandle: ReturnType<AudioProjectScope["register"]>;
	private instrumentNode: InstrumentNode | null = null;
	private instrumentHandle: ReturnType<AudioProjectScope["register"]> | null =
		null;
	private lastInstrumentRef: AudioTrackProjection["instrument"] | null = null;
	private readonly sends = new Map<ReturnId, TrackedSend>();
	private lastProjection: AudioTrackProjection | null = null;
	private disposed = false;

	constructor(
		id: TrackId,
		private readonly context: TrackAudioGraphContext,
		destination: Tone.ToneAudioNode,
	) {
		this.id = id;
		this.deviceChain = new DeviceChain(context.scope, context.createDeviceNode);
		// Explicit channelCount: 2 — Tone.PanVol's Panner otherwise inherits
		// Web Audio's channelCount: 1 / channelCountMode: "explicit" default and
		// downmixes every stereo signal to mono before panning.
		this.panVol = new Tone.PanVol({ pan: 0, volume: 0, channelCount: 2 });
		this.panVolHandle = context.scope.register("node", () => {
			this.panVol.dispose();
		});
		// A per-track peak meter (PRD TRK-02: "Every track provides ... a level
		// meter"). It taps the post-fader signal as a fan-out, so it reflects what
		// mute/solo/volume actually let through without colouring the signal, and
		// is polled by the mixer UI rather than sourcing any per-frame telemetry.
		this.meter = new Tone.Meter();
		this.meterHandle = context.scope.register("node", () => {
			this.meter.dispose();
		});
		this.deviceChain.output.connect(this.panVol.input);
		this.panVol.connect(destination);
		this.panVol.connect(this.meter);
	}

	/**
	 * This track's post-fader peak meter. The mixer polls it for a level
	 * display; it is never the source of an analytics event, so metering adds no
	 * per-frame telemetry (PRD TRK-02/OPS-02).
	 */
	get levelMeter(): Tone.Meter {
		return this.meter;
	}

	/**
	 * Whether this track's channel strip is currently silenced — its own mute or
	 * the project-wide solo rule. Read access for tests and diagnostics; the
	 * value is set by {@link reconcile}'s `effectiveMuted` argument.
	 */
	get isMuted(): boolean {
		return this.panVol.mute;
	}

	/** The live node for one of this track's devices, for a panel readout (gain
	 * reduction, a synced delay's resolved time) or a test. */
	deviceNode(id: DeviceId): DeviceNode | undefined {
		return this.deviceChain.deviceNode(id);
	}

	/** The pre-fader tap point: after devices, before pan/volume/mute. */
	private get preFaderTap(): Tone.ToneAudioNode {
		return this.deviceChain.output;
	}

	/**
	 * The post-fader tap point: after pan/volume/mute. `PanVol.output` is
	 * typed as the general `OutputNode` union (it can, for other Tone
	 * components, be a raw `AudioNode`) but is always the `Tone.Volume`
	 * instance `PanVol` itself constructs.
	 */
	private get postFaderTap(): Tone.ToneAudioNode {
		return this.panVol.output as Tone.ToneAudioNode;
	}

	/**
	 * Reconciles this track against `next`. `effectiveMuted` folds in the
	 * project-wide mute/solo rule (mute wins; any soloed track silences every
	 * non-soloed one) and is re-applied every pass since it depends on every
	 * other track's solo state, not just this track's own projection.
	 *
	 * `reapplyDevices` is likewise re-applied every pass regardless of the
	 * reference short-circuit below, for the same reason: it reports that state
	 * *outside* this track's projection moved (the song tempo, which a synced
	 * delay resolves its division against). A tempo-only edit leaves this track's
	 * projection reference-identical, so without this the early return would
	 * swallow it and the delay would never leave the old grid.
	 */
	reconcile(
		next: AudioTrackProjection,
		effectiveMuted: boolean,
		reapplyDevices = false,
	): void {
		if (this.lastProjection !== next) {
			this.reconcileInstrument(next.instrument);
			this.deviceChain.reconcile(next.devices, reapplyDevices);
			this.reconcileSends(next.sendConfig);
			this.panVol.volume.rampTo(next.mixer.volume, MIXER_SMOOTHING_SECONDS);
			this.panVol.pan.rampTo(next.mixer.pan, MIXER_SMOOTHING_SECONDS);
			this.lastProjection = next;
		} else if (reapplyDevices) {
			this.deviceChain.reconcile(next.devices, true);
		}
		this.panVol.mute = effectiveMuted;
	}

	/** Triggers this track's instrument, if it has one. A no-op for `audio` tracks (no instrument) or while nothing is loaded yet. */
	trigger(
		trigger: NoteTrigger,
		time: Tone.Unit.Time,
		duration: Tone.Unit.Time,
		velocity: number,
	): void {
		this.instrumentNode?.trigger(trigger, time, duration, velocity);
	}

	/** Where an `audioLoop` clip's player connects for this (`audio`-type) track. */
	get audioInput(): Tone.ToneAudioNode {
		return this.deviceChain.input;
	}

	private reconcileInstrument(next: AudioTrackProjection["instrument"]): void {
		if (!next) {
			this.disposeInstrument();
			this.lastInstrumentRef = null;
			return;
		}
		if (next === this.lastInstrumentRef) return;
		if (this.instrumentNode && this.instrumentNode.kind === next.kind) {
			this.instrumentNode.update(next);
			this.lastInstrumentRef = next;
			return;
		}
		this.disposeInstrument();
		const factory = this.context.createInstrument ?? createInstrumentNode;
		const node = factory(next, {
			scope: this.context.scope,
			assetsById: this.context.assetsById,
			bufferCache: this.context.bufferCache,
		});
		this.instrumentHandle = this.context.scope.register("node", () =>
			node.dispose(),
		);
		node.output.connect(this.deviceChain.input);
		this.instrumentNode = node;
		this.lastInstrumentRef = next;
	}

	private disposeInstrument(): void {
		if (this.instrumentHandle) {
			void this.context.scope.release(this.instrumentHandle);
			this.instrumentHandle = null;
		}
		this.instrumentNode = null;
	}

	private reconcileSends(sendConfig: readonly Send[]): void {
		const nextIds = new Set(sendConfig.map((send) => send.returnId));
		for (const [returnId, tracked] of this.sends) {
			if (!nextIds.has(returnId)) {
				void this.context.scope.release(tracked.handle);
				this.sends.delete(returnId);
			}
		}

		for (const send of sendConfig) {
			const target = this.context.getReturnInput(send.returnId);
			if (!target) continue; // domain invariants forbid a dangling return reference; defensive only

			const existing = this.sends.get(send.returnId);
			const tap = send.preFader ? this.preFaderTap : this.postFaderTap;
			if (!existing) {
				const gain = new Tone.Gain(send.level);
				tap.connect(gain);
				gain.connect(target);
				const handle = this.context.scope.register("node", () => {
					gain.dispose();
				});
				this.sends.set(send.returnId, {
					gain,
					handle,
					preFader: send.preFader,
				});
				continue;
			}

			existing.gain.gain.rampTo(send.level, MIXER_SMOOTHING_SECONDS);
			if (existing.preFader !== send.preFader) {
				const previousTap = existing.preFader
					? this.preFaderTap
					: this.postFaderTap;
				previousTap.disconnect(existing.gain);
				tap.connect(existing.gain);
				existing.preFader = send.preFader;
			}
		}
	}

	/** Tears down every node this track owns. Safe to call more than once. */
	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.disposeInstrument();
		for (const [, tracked] of this.sends) {
			void this.context.scope.release(tracked.handle);
		}
		this.sends.clear();
		this.deviceChain.dispose();
		void this.context.scope.release(this.panVolHandle);
		void this.context.scope.release(this.meterHandle);
	}
}
