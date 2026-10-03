import * as Tone from "tone";
import type { NoteTrigger, Send } from "../domain/entities";
import type { AssetId, DeviceId, ReturnId, TrackId } from "../domain/ids";
import type {
  AudioAssetProjection,
  AudioTrackProjection,
} from "../projection/audioProjection";
import type { AudioBufferCache } from "./AudioBufferCache";
import type { AudioProjectScope } from "./AudioRuntime";
import { CompensationDelay } from "./compensationDelay";
import { DeviceChain, type DeviceNode, type DeviceNodeFactory } from "./DeviceChain";
import {
  createInstrumentNode,
  type InstrumentNode,
  type InstrumentNodeFactory,
} from "./InstrumentGraph";
import { type LevelReading, loudestDb, peakDbOf } from "./levels";
import { SummingBus } from "./summingBus";

/**
 * The ramp time applied to every continuous channel-strip change — volume,
 * pan, and send level (PRD TRK-02: "No control change creates audible zipper
 * noise under normal use"). Short enough to feel instant, long enough that a
 * fader move glides the gain instead of stepping it sample-to-sample.
 */
export const MIXER_SMOOTHING_SECONDS = 0.02;

/**
 * The fixed gain every instrument plays through before its track's device
 * chain (#837). A fader at its 0 dB default is unity, so without this a
 * 7-track song at default levels sums well past 0 dBFS and exports clipped.
 * Live gives Simpler the same -12 dB default for the same reason; here it is a
 * trim rather than a parameter, so faders keep starting at unity and saved
 * projects get the headroom too. An audio track's loops are not trimmed.
 */
export const INSTRUMENT_HEADROOM_DB = -12;

/** Samples per channel in the peak tap: about one 60 Hz frame at 48 kHz. */
const PEAK_WINDOW = 1024;

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
  /** The bus a send to return `id` joins. */
  getReturnInput(id: ReturnId): SummingBus | undefined;
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
  /** The instrument and every loop player, summed in order (#867). */
  private readonly inputs: SummingBus;
  private readonly inputsHandle: ReturnType<AudioProjectScope["register"]>;
  private readonly detachFromDestination: () => void;
  private readonly deviceChain: DeviceChain;
  /** Plugin delay compensation after the devices, before the sends (#883). */
  private readonly alignDelay: CompensationDelay;
  /** Plugin delay compensation on the direct output to the master (#883). */
  private readonly outputDelay: CompensationDelay;
  private readonly delaysHandle: ReturnType<AudioProjectScope["register"]>;
  private readonly panVol: Tone.PanVol;
  private readonly panVolHandle: ReturnType<AudioProjectScope["register"]>;
  private readonly meter: Tone.Meter;
  private readonly meterHandle: ReturnType<AudioProjectScope["register"]>;
  private readonly peakTap: Tone.Analyser;
  private readonly peakTapHandle: ReturnType<AudioProjectScope["register"]>;
  private readonly instrumentTrim: Tone.Gain<"decibels">;
  private readonly instrumentTrimHandle: ReturnType<AudioProjectScope["register"]>;
  private instrumentNode: InstrumentNode | null = null;
  private instrumentHandle: ReturnType<AudioProjectScope["register"]> | null = null;
  private lastInstrumentRef: AudioTrackProjection["instrument"] | null = null;
  private readonly sends = new Map<ReturnId, TrackedSend>();
  private lastProjection: AudioTrackProjection | null = null;
  private readonly muteGain: Tone.Gain;
  private readonly muteGainHandle: ReturnType<AudioProjectScope["register"]>;
  private muted = false;
  private disposed = false;

  constructor(
    id: TrackId,
    private readonly context: TrackAudioGraphContext,
    destination: SummingBus,
  ) {
    this.id = id;
    this.inputs = new SummingBus();
    this.inputsHandle = context.scope.register("node", () => {
      this.inputs.dispose();
    });
    this.deviceChain = new DeviceChain(context.scope, context.createDeviceNode);
    this.alignDelay = new CompensationDelay();
    this.outputDelay = new CompensationDelay();
    this.delaysHandle = context.scope.register("node", () => {
      this.alignDelay.dispose();
      this.outputDelay.dispose();
    });
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
    // The samples themselves, per channel, for the clip state (#447): an RMS
    // meter smooths a full-scale sine to -3 dB, so only the peaks can say a
    // track went over. One frame's worth, read by the editor's frame loop.
    this.peakTap = new Tone.Analyser({
      type: "waveform",
      size: PEAK_WINDOW,
      channels: 2,
    });
    this.peakTapHandle = context.scope.register("node", () => {
      this.peakTap.dispose();
    });
    // Mute is its own gain stage, not `PanVol.mute`: Tone's mute stashes the
    // fader value and restores it on unmute, so a volume ramp that lands while
    // the strip is muted (an edit made under another track's solo) corrupts
    // the stash and the track comes back silent.
    this.muteGain = new Tone.Gain(1);
    this.muteGainHandle = context.scope.register("node", () => {
      this.muteGain.dispose();
    });
    this.instrumentTrim = new Tone.Gain(INSTRUMENT_HEADROOM_DB, "decibels");
    this.instrumentTrimHandle = context.scope.register("node", () => {
      this.instrumentTrim.dispose();
    });
    this.inputs.add(this.instrumentTrim);
    this.inputs.output.connect(this.deviceChain.input);
    this.deviceChain.output.connect(this.alignDelay.node);
    this.alignDelay.node.connect(this.muteGain);
    this.muteGain.connect(this.panVol.input);
    this.panVol.connect(this.outputDelay.node);
    this.detachFromDestination = destination.add(this.outputDelay.node);
    this.panVol.connect(this.meter);
    this.panVol.connect(this.peakTap);
  }

  /**
   * This track's post-fader peak meter. The mixer polls it for a level
   * display; it is never the source of an analytics event, so metering adds no
   * per-frame telemetry (PRD TRK-02/OPS-02).
   */
  get levelMeter(): Tone.Meter {
    return this.meter;
  }

  /** This track's post-fader level now: its RMS, and its latest peak. */
  readLevel(): LevelReading {
    const samples = this.peakTap.getValue();
    return {
      rmsDb: loudestDb(this.meter.getValue()),
      peakDb: peakDbOf(Array.isArray(samples) ? samples : [samples]),
    };
  }

  /**
   * Whether this track's channel strip is currently silenced — its own mute or
   * the project-wide solo rule. Read access for tests and diagnostics; the
   * value is set by {@link reconcile}'s `effectiveMuted` argument.
   */
  get isMuted(): boolean {
    return this.muted;
  }

  /** The live node for one of this track's devices, for a panel readout (gain
   * reduction, a synced delay's resolved time) or a test. */
  deviceNode(id: DeviceId): DeviceNode | undefined {
    return this.deviceChain.deviceNode(id);
  }

  /**
   * Applies this track's share of the song's plugin delay compensation
   * (`latencyCompensation.ts`): `alignFrames` after its devices, so its sends
   * leave in step with every other track's, and `outputFrames` on its direct
   * output, so it reaches the master in step with the returns. A change ramps
   * rather than jumps, and rebuilds nothing.
   */
  setLatencyCompensation(alignFrames: number, outputFrames: number): void {
    this.alignDelay.set(alignFrames);
    this.outputDelay.set(outputFrames);
  }

  /** The frames this track is compensated by, after its devices and on its
   * direct output. Read access for tests and diagnostics. */
  get latencyCompensation(): {
    readonly alignFrames: number;
    readonly outputFrames: number;
  } {
    return {
      alignFrames: this.alignDelay.compensationFrames,
      outputFrames: this.outputDelay.compensationFrames,
    };
  }

  /** The pre-fader tap point: after devices and their compensation, before
   * pan/volume/mute. */
  private get preFaderTap(): Tone.ToneAudioNode {
    return this.alignDelay.node;
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
    this.muted = effectiveMuted;
    this.muteGain.gain.value = effectiveMuted ? 0 : 1;
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

  /** The bus an `audioLoop` clip's player joins for this (`audio`-type) track. */
  get audioInput(): SummingBus {
    return this.inputs;
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
    this.instrumentHandle = this.context.scope.register("node", () => node.dispose());
    node.output.connect(this.instrumentTrim);
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
        const detach = target.add(gain);
        const handle = this.context.scope.register("node", () => {
          detach();
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
        const previousTap = existing.preFader ? this.preFaderTap : this.postFaderTap;
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
    this.detachFromDestination();
    this.disposeInstrument();
    void this.context.scope.release(this.instrumentTrimHandle);
    void this.context.scope.release(this.inputsHandle);
    for (const [, tracked] of this.sends) {
      void this.context.scope.release(tracked.handle);
    }
    this.sends.clear();
    this.deviceChain.dispose();
    void this.context.scope.release(this.delaysHandle);
    void this.context.scope.release(this.muteGainHandle);
    void this.context.scope.release(this.panVolHandle);
    void this.context.scope.release(this.meterHandle);
    void this.context.scope.release(this.peakTapHandle);
  }
}
