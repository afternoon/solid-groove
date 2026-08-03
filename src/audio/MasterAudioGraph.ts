import * as Tone from "tone";
import type { AudioMasterProjection } from "../projection/audioProjection";
import type { AudioProjectScope } from "./AudioRuntime";
import { DeviceChain, type DeviceNodeFactory } from "./DeviceChain";

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
 * The master bus's audio subgraph (PRD AUD-08, section 9.7): an ordered
 * device chain feeding a volume stage, a metering tap, and a transparent
 * safety limiter (PRD AUD-04) connected to the runtime's shared destination.
 * There is exactly one of these per {@link ProjectAudioGraph} and it is never
 * rebuilt for a routine edit — only its device chain and volume are reconciled
 * in place, so a parameter edit never restarts the transport or reconstructs
 * the meter/limiter.
 */
export class MasterAudioGraph {
	private readonly deviceChain: DeviceChain;
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
		this.deviceChain = new DeviceChain(scope, createDeviceNode);
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

		// deviceChain -> volume -> limiter -> destination, with the meter tapping
		// the limited signal (a fan-out, not an insert, so it cannot colour it).
		this.deviceChain.output.connect(this.volume);
		this.volume.connect(this.limiter);
		this.limiter.connect(this.meter);
		this.limiter.connect(destination);
	}

	/** Where a track or return's post-fader signal connects. */
	get input(): Tone.ToneAudioNode {
		return this.deviceChain.input;
	}

	/**
	 * The master peak meter. Callers poll it for a level display; it is never
	 * the source of an analytics event, so metering adds no per-frame telemetry.
	 */
	get levelMeter(): Tone.Meter {
		return this.meter;
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
		void this.scope.release(this.meterHandle);
		void this.scope.release(this.limiterHandle);
	}
}
