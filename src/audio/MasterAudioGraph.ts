import * as Tone from "tone";
import type { AudioMasterProjection } from "../projection/audioProjection";
import type { AudioProjectScope } from "./AudioRuntime";
import { CompensationDelay } from "./compensationDelay";
import { DeviceChain, type DeviceNodeFactory } from "./DeviceChain";
import { type DeclaredLatency, dynamicsLookaheadFrames } from "./latency";
import { SummingBus } from "./summingBus";

/**
 * The transparent safety limiter's threshold, in dBFS (PRD AUD-04). It sits
 * just under 0 dBFS so ordinary, already-safe material passes through
 * unaffected while genuinely dangerous or clipped peaks are caught before they
 * reach the output device. It is deliberately *not* a creative or
 * loudness-normalizing stage — `DEC-004` requires export to preserve project
 * gain exactly, and this same limiter is all AUD-05/AUD-06 keep in the master
 * path for that reason.
 */
export const MASTER_LIMITER_THRESHOLD_DB = -0.5;

/**
 * How many frames the safety limiter delays everything by (EXP-001, #883).
 * `Tone.Limiter` is a `DynamicsCompressorNode`, so it holds the signal back by
 * the engine's compressor lookahead. Live that is an imperceptible lag behind
 * the playhead; an offline render drops it from the front, with the rest of
 * the song's latency (`latencyCompensation.ts`), so bar 1 is the file's first
 * frame. Declared, like every device's latency, not measured.
 */
export const masterLimiterLatencyFrames: DeclaredLatency = dynamicsLookaheadFrames;

/**
 * The master bus's audio subgraph (PRD AUD-08, section 9.7): an ordered
 * device chain feeding a volume stage, a metering tap, and a transparent
 * safety limiter (PRD AUD-04) connected to the runtime's shared destination.
 * There is exactly one of these per {@link ProjectAudioGraph} and it is never
 * rebuilt for a routine edit — only its device chain and volume are reconciled
 * in place, so a parameter edit never restarts the transport or reconstructs
 * the meter/limiter.
 */
export class MasterAudioGraph {
  /** Every track and return, summed in order (#867). */
  readonly mix: SummingBus;
  private readonly mixHandle: ReturnType<AudioProjectScope["register"]>;
  private readonly deviceChain: DeviceChain;
  /** Holds an auxiliary source (the metronome) back by the mix's plugin
   * delay compensation, so it stays on the beat the tracks are on (#883). */
  private readonly auxAlign: CompensationDelay;
  private readonly auxAlignHandle: ReturnType<AudioProjectScope["register"]>;
  private readonly volume: Tone.Volume;
  private readonly meter: Tone.Meter;
  private readonly limiter: Tone.Limiter;
  private readonly volumeHandle: ReturnType<AudioProjectScope["register"]>;
  private readonly meterHandle: ReturnType<AudioProjectScope["register"]>;
  private readonly limiterHandle: ReturnType<AudioProjectScope["register"]>;
  private lastProjection: AudioMasterProjection | null = null;
  private disposed = false;

  constructor(
    private readonly scope: AudioProjectScope,
    destination: Tone.ToneAudioNode,
    createDeviceNode?: DeviceNodeFactory,
  ) {
    this.mix = new SummingBus();
    this.mixHandle = scope.register("node", () => {
      this.mix.dispose();
    });
    this.deviceChain = new DeviceChain(scope, createDeviceNode);
    this.auxAlign = new CompensationDelay();
    this.auxAlignHandle = scope.register("node", () => {
      this.auxAlign.dispose();
    });
    this.volume = new Tone.Volume(0);
    this.volumeHandle = scope.register("node", () => {
      this.volume.dispose();
    });
    // A peak meter, so a browser test or diagnostic can observe output level
    // without adding a per-frame analytics event (PRD AUD-04/OPS-02).
    this.meter = new Tone.Meter();
    this.meterHandle = scope.register("node", () => {
      this.meter.dispose();
    });
    // The transparent safety limiter is the last stage before the shared
    // destination, so nothing after it can push a dangerous peak to the
    // hardware (PRD AUD-04).
    this.limiter = new Tone.Limiter(MASTER_LIMITER_THRESHOLD_DB);
    this.limiterHandle = scope.register("node", () => {
      this.limiter.dispose();
    });

    // mix -> deviceChain -> volume -> limiter -> destination, with the meter
    // tapping the limited signal (a fan-out, not an insert, so it cannot
    // colour it).
    this.mix.output.connect(this.deviceChain.input);
    this.auxAlign.node.connect(this.deviceChain.input);
    this.deviceChain.output.connect(this.volume);
    this.volume.connect(this.limiter);
    this.limiter.connect(this.meter);
    this.limiter.connect(destination);
  }

  /** Where an auxiliary source (the metronome) connects, beside {@link mix}
   * and delayed to match it: a track or a return joins the mix instead. */
  get input(): Tone.ToneAudioNode {
    return this.auxAlign.node;
  }

  /** Delays the auxiliary input by the frames every compensated path takes to
   * reach the mix (`LatencyCompensationPlan.mixFrames`). */
  setLatencyCompensation(mixFrames: number): void {
    this.auxAlign.set(mixFrames);
  }

  /**
   * The master peak meter. Callers poll it for a level display; it is never
   * the source of an analytics event, so metering adds no per-frame telemetry.
   */
  get levelMeter(): Tone.Meter {
    return this.meter;
  }

  /**
   * `reapplyDevices` reports that state outside the master projection moved
   * (the song tempo, which a synced delay resolves against) and so must survive
   * the reference short-circuit — otherwise a tempo-only edit, which leaves this
   * projection reference-identical, would never reach the device chain.
   */
  reconcile(next: AudioMasterProjection, reapplyDevices = false): void {
    if (this.lastProjection === next) {
      if (reapplyDevices) this.deviceChain.reconcile(next.devices, true);
      return;
    }
    this.deviceChain.reconcile(next.devices, reapplyDevices);
    this.volume.volume.rampTo(next.volume, 0.02);
    this.lastProjection = next;
  }

  /** Tears down every node the master bus owns. Safe to call more than once. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    void this.scope.release(this.mixHandle);
    this.deviceChain.dispose();
    void this.scope.release(this.auxAlignHandle);
    void this.scope.release(this.volumeHandle);
    void this.scope.release(this.meterHandle);
    void this.scope.release(this.limiterHandle);
  }
}
