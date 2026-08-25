import * as Tone from "tone";
import type { ReturnId } from "../domain/ids";
import type { AudioReturnProjection } from "../projection/audioProjection";
import type { AudioProjectScope } from "./AudioRuntime";
import { DeviceChain, type DeviceNodeFactory } from "./DeviceChain";

/**
 * One return bus's audio subgraph, keyed by its stable id (PRD AUD-08,
 * section 9.7): an ordered device chain feeding a pan/volume/mute channel
 * strip. Track sends connect into {@link ReturnAudioGraph.input}; the strip's
 * output feeds the master bus.
 */
export class ReturnAudioGraph {
  readonly id: ReturnId;
  private readonly deviceChain: DeviceChain;
  private readonly panVol: Tone.PanVol;
  private readonly panVolHandle: ReturnType<AudioProjectScope["register"]>;
  private lastProjection: AudioReturnProjection | null = null;
  private disposed = false;

  constructor(
    id: ReturnId,
    private readonly scope: AudioProjectScope,
    destination: Tone.ToneAudioNode,
    createDeviceNode?: DeviceNodeFactory,
  ) {
    this.id = id;
    this.deviceChain = new DeviceChain(scope, createDeviceNode);
    // Explicit channelCount: 2 — Tone.PanVol's Panner otherwise inherits
    // Web Audio's channelCount: 1 / channelCountMode: "explicit" default and
    // downmixes every stereo signal to mono before panning.
    this.panVol = new Tone.PanVol({ pan: 0, volume: 0, channelCount: 2 });
    this.panVolHandle = scope.register("node", () => {
      this.panVol.dispose();
    });
    this.deviceChain.output.connect(this.panVol.input);
    this.panVol.connect(destination);
  }

  /** Where a track's send gain connects. */
  get input(): Tone.ToneAudioNode {
    return this.deviceChain.input;
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

  /** Tears down every node this return bus owns. Safe to call more than once. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.deviceChain.dispose();
    void this.scope.release(this.panVolHandle);
  }
}
