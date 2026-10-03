import * as Tone from "tone";
import type { DeviceId, ReturnId } from "../domain/ids";
import type { AudioReturnProjection } from "../projection/audioProjection";
import type { AudioProjectScope } from "./AudioRuntime";
import { CompensationDelay } from "./compensationDelay";
import { DeviceChain, type DeviceNode, type DeviceNodeFactory } from "./DeviceChain";
import { SummingBus } from "./summingBus";

/**
 * One return bus's audio subgraph, keyed by its stable id (PRD AUD-08,
 * section 9.7): an ordered device chain feeding a pan/volume/mute channel
 * strip. Track sends join {@link ReturnAudioGraph.input}, a bus that sums them
 * in order (#867); the strip's output feeds the master bus.
 */
export class ReturnAudioGraph {
  readonly id: ReturnId;
  private readonly sends: SummingBus;
  private readonly sendsHandle: ReturnType<AudioProjectScope["register"]>;
  private readonly detachFromDestination: () => void;
  private readonly deviceChain: DeviceChain;
  /** Plugin delay compensation after the devices (#883). */
  private readonly alignDelay: CompensationDelay;
  private readonly alignHandle: ReturnType<AudioProjectScope["register"]>;
  private readonly panVol: Tone.PanVol;
  private readonly panVolHandle: ReturnType<AudioProjectScope["register"]>;
  private lastProjection: AudioReturnProjection | null = null;
  private disposed = false;

  constructor(
    id: ReturnId,
    private readonly scope: AudioProjectScope,
    destination: SummingBus,
    createDeviceNode?: DeviceNodeFactory,
  ) {
    this.id = id;
    this.sends = new SummingBus();
    this.sendsHandle = scope.register("node", () => {
      this.sends.dispose();
    });
    this.deviceChain = new DeviceChain(scope, createDeviceNode);
    this.alignDelay = new CompensationDelay();
    this.alignHandle = scope.register("node", () => {
      this.alignDelay.dispose();
    });
    // Explicit channelCount: 2 — Tone.PanVol's Panner otherwise inherits
    // Web Audio's channelCount: 1 / channelCountMode: "explicit" default and
    // downmixes every stereo signal to mono before panning.
    this.panVol = new Tone.PanVol({ pan: 0, volume: 0, channelCount: 2 });
    this.panVolHandle = scope.register("node", () => {
      this.panVol.dispose();
    });
    this.sends.output.connect(this.deviceChain.input);
    this.deviceChain.output.connect(this.alignDelay.node);
    this.alignDelay.node.connect(this.panVol.input);
    this.detachFromDestination = destination.add(this.panVol);
  }

  /** The bus a track's send gain joins. */
  get input(): SummingBus {
    return this.sends;
  }

  /**
   * Applies this return's share of the song's plugin delay compensation
   * (`latencyCompensation.ts`): `frames` after its devices, so it reaches the
   * master in step with the slowest return. A change ramps rather than jumps.
   */
  setLatencyCompensation(frames: number): void {
    this.alignDelay.set(frames);
  }

  /** The frames this return is compensated by. For tests and diagnostics. */
  get latencyCompensationFrames(): number {
    return this.alignDelay.compensationFrames;
  }

  /**
   * `reapplyDevices` reports that state outside this return's projection moved
   * (the song tempo, which a synced delay resolves against) and so must survive
   * the reference short-circuit — otherwise a tempo-only edit, which leaves this
   * projection reference-identical, would never reach the device chain.
   */
  reconcile(next: AudioReturnProjection, reapplyDevices = false): void {
    if (this.lastProjection === next) {
      if (reapplyDevices) this.deviceChain.reconcile(next.devices, true);
      return;
    }
    this.deviceChain.reconcile(next.devices, reapplyDevices);
    this.panVol.volume.rampTo(next.mixer.volume, 0.02);
    this.panVol.pan.rampTo(next.mixer.pan, 0.02);
    this.panVol.mute = next.mixer.muted;
    this.lastProjection = next;
  }

  /** The live node for one of this bus's devices, for a panel readout. */
  deviceNode(id: DeviceId): DeviceNode | undefined {
    return this.deviceChain.deviceNode(id);
  }

  /** Tears down every node this return bus owns. Safe to call more than once. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.detachFromDestination();
    void this.scope.release(this.sendsHandle);
    this.deviceChain.dispose();
    void this.scope.release(this.alignHandle);
    void this.scope.release(this.panVolHandle);
  }
}
