import * as Tone from "tone";
import type { AudioMasterProjection } from "../projection/audioProjection";
import type { AudioProjectScope } from "./AudioRuntime";
import { DeviceChain, type DeviceNodeFactory } from "./DeviceChain";

/**
 * The master bus's audio subgraph (PRD AUD-08, section 9.7): an ordered
 * device chain feeding a volume stage connected to the runtime's shared
 * destination. There is exactly one of these per {@link ProjectAudioGraph}
 * and it is never rebuilt for a routine edit — only its device chain and
 * volume are reconciled in place.
 */
export class MasterAudioGraph {
	private readonly deviceChain: DeviceChain;
	private readonly volume: Tone.Volume;
	private readonly volumeHandle: ReturnType<AudioProjectScope["register"]>;
	private lastProjection: AudioMasterProjection | null = null;
	private disposed = false;

	constructor(
		private readonly scope: AudioProjectScope,
		destination: Tone.ToneAudioNode,
		createDeviceNode?: DeviceNodeFactory,
	) {
		this.deviceChain = new DeviceChain(scope, createDeviceNode);
		this.volume = new Tone.Volume(0);
		this.volumeHandle = scope.register("node", () => {
			this.volume.dispose();
		});
		this.deviceChain.output.connect(this.volume);
		this.volume.connect(destination);
	}

	/** Where a track or return's post-fader signal connects. */
	get input(): Tone.ToneAudioNode {
		return this.deviceChain.input;
	}

	reconcile(next: AudioMasterProjection): void {
		if (this.lastProjection === next) return;
		this.deviceChain.reconcile(next.devices);
		this.volume.volume.rampTo(next.volume, 0.02);
		this.lastProjection = next;
	}

	/** Tears down every node the master bus owns. Safe to call more than once. */
	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.deviceChain.dispose();
		void this.scope.release(this.volumeHandle);
	}
}
