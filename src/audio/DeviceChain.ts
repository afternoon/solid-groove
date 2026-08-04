import * as Tone from "tone";
import type { Device } from "../domain/entities";
import type { DeviceId } from "../domain/ids";
import type { CancelScheduled, Scheduler } from "../shared/scheduler";
import { timeoutScheduler } from "../shared/scheduler";
import type { AudioProjectScope } from "./AudioRuntime";

/**
 * One node (or small internal subgraph) in an ordered insert chain, keyed by
 * the device's stable id (PRD AUD-08, section 9.7). `update()` must apply
 * bypass and parameter changes to the *existing* node — a device is only ever
 * recreated when its `type` changes, which `DeviceChain` treats as "remove
 * the old id, add the new one" since a device's `id` is stable across a type
 * change only if a future command explicitly retypes it in place (schema v1
 * has no such command yet).
 */
export interface DeviceNode {
	readonly id: DeviceId;
	readonly type: string;
	readonly input: Tone.ToneAudioNode;
	readonly output: Tone.ToneAudioNode;
	update(device: Device): void;
	dispose(): void;
}

export type DeviceNodeFactory = (device: Device) => DeviceNode;

/**
 * Schema v1 defines the generic `Device` shape (id, type, order, bypass,
 * parameters) but no concrete processors — filter/EQ, overdrive, compression,
 * delay, and reverb are authored with their devices in Alpha Milestone 1 (PRD section
 * 7.3). Until a factory is registered for a `device.type`, the chain gives it
 * an inert passthrough node instead of refusing to build the graph, so
 * topology — insertion, removal, and reordering — is fully provable ahead of
 * any real DSP.
 */
export function createPassthroughDeviceNode(device: Device): DeviceNode {
	const node = new Tone.Gain(1);
	return {
		id: device.id,
		type: device.type,
		input: node,
		output: node,
		update() {
			// A passthrough has no parameters to apply or smooth.
		},
		dispose() {
			node.dispose();
		},
	};
}

const defaultDeviceNodeFactory: DeviceNodeFactory = createPassthroughDeviceNode;

/**
 * The gain dip applied around a chain relink so composition or order changes do
 * not click (PRD FX-01: a reorder's reconnection must be click-safe). A Web
 * Audio `disconnect()`/`connect()` is an instantaneous topology change: the
 * sample the graph produces on the block after the change can jump from the old
 * routing's value to the new one, and that step is an audible transient. Ramping
 * the chain's own output to zero, relinking, then ramping back masks the step in
 * a fade far shorter than a fader move yet long enough to avoid the click. It
 * costs nothing on a parameter- or bypass-only reconcile, which never relinks.
 */
export const RELINK_FADE_SECONDS = 0.005;

interface TrackedDevice {
	node: DeviceNode;
	handle: ReturnType<AudioProjectScope["register"]>;
}

/**
 * An ordered, ID-keyed insert chain shared by tracks, return buses, and the
 * master bus. Reconciling against a new `Device[]` reuses every node whose id
 * is still present — only devices actually added or removed create or
 * dispose a node — and only relinks the signal path when composition or order
 * changed, never on a bypass/parameter-only edit.
 */
export class DeviceChain {
	readonly input: Tone.Gain;
	readonly output: Tone.Gain;
	private readonly nodes = new Map<DeviceId, TrackedDevice>();
	private order: DeviceId[] = [];
	private readonly chainHandle: ReturnType<AudioProjectScope["register"]>;
	/** True once the signal path has been wired at least once. Guards the very
	 * first `relink()` (empty -> initial topology) so it connects directly at
	 * gain 1 instead of scheduling a spurious dip nothing was ever routed
	 * through in the first place. */
	private linked = false;
	/** Cancels a rewire deferred by a relink still fading out, so a second
	 * relink arriving before the first completes supersedes it instead of
	 * racing it (see `relink()`). */
	private pendingRelink: CancelScheduled | null = null;

	constructor(
		private readonly scope: AudioProjectScope,
		private readonly createNode: DeviceNodeFactory = defaultDeviceNodeFactory,
		private readonly scheduler: Scheduler = timeoutScheduler,
	) {
		this.input = new Tone.Gain(1);
		this.output = new Tone.Gain(1);
		this.input.connect(this.output);
		this.chainHandle = this.scope.register("node", () => {
			this.input.dispose();
			this.output.dispose();
		});
	}

	/** Reconciles this chain's devices, ordered by chain position (`order`). */
	reconcile(devices: readonly Device[]): void {
		const nextIds = devices.map((device) => device.id);
		const nextIdSet = new Set(nextIds);

		for (const [id, tracked] of this.nodes) {
			if (!nextIdSet.has(id)) {
				void this.scope.release(tracked.handle);
				this.nodes.delete(id);
			}
		}

		let compositionChanged = false;
		for (const device of devices) {
			const existing = this.nodes.get(device.id);
			if (existing) {
				existing.node.update(device);
			} else {
				const node = this.createNode(device);
				const handle = this.scope.register("node", () => node.dispose());
				this.nodes.set(device.id, { node, handle });
				compositionChanged = true;
			}
		}

		const orderChanged =
			this.order.length !== nextIds.length ||
			this.order.some((id, index) => id !== nextIds[index]);
		this.order = nextIds;

		if (compositionChanged || orderChanged) this.relink();
	}

	/**
	 * Rewires the serial signal path with a true make-before-break: the output
	 * is ramped to zero across `RELINK_FADE_SECONDS`, and only once that ramp
	 * has actually reached silence does the topology change (deferred via the
	 * injectable `Scheduler`, so tests can drive it deterministically instead
	 * of racing a real timer). Rewiring synchronously — before the ramp
	 * completes — was the FX-01 bug this guards against: the graph's sample
	 * discontinuity would have played through at ~full gain, since a scheduled
	 * ramp is only a future automation curve, not an instantaneous value.
	 *
	 * The very first relink (nothing was ever live) skips the fade entirely —
	 * there is no prior routing to click away from, so dipping to 0 and back
	 * would just be an audible fade-in on project open.
	 *
	 * A relink that arrives while a previous one is still fading cancels the
	 * previous one's deferred rewire outright and starts its own down-ramp
	 * fresh from `now`; only the newest relink's rewire ever runs, reading
	 * `this.order`/`this.nodes` at fire time so the latest composition wins
	 * even if it changed again while waiting out the fade.
	 */
	private relink(): void {
		this.pendingRelink?.();
		this.pendingRelink = null;

		if (!this.linked) {
			this.rewire();
			this.linked = true;
			return;
		}

		const now = this.output.immediate();
		this.output.gain.cancelScheduledValues(now);
		this.output.gain.setValueAtTime(this.output.gain.value, now);
		this.output.gain.linearRampToValueAtTime(0, now + RELINK_FADE_SECONDS);

		this.pendingRelink = this.scheduler.schedule(() => {
			this.pendingRelink = null;
			this.rewire();
			const resumeNow = this.output.immediate();
			this.output.gain.cancelScheduledValues(resumeNow);
			this.output.gain.setValueAtTime(0, resumeNow);
			this.output.gain.linearRampToValueAtTime(
				1,
				resumeNow + RELINK_FADE_SECONDS,
			);
		}, RELINK_FADE_SECONDS * 1000);
	}

	/** Rebuilds the serial signal path from the current `order`/`nodes`. Only
	 * ever called while the output is silent (or, for the very first link,
	 * before anything has ever been connected), so the topology change itself
	 * is inaudible regardless of when it runs. */
	private rewire(): void {
		this.input.disconnect();
		let previous: Tone.ToneAudioNode = this.input;
		for (const id of this.order) {
			const tracked = this.nodes.get(id);
			if (!tracked) continue;
			tracked.node.output.disconnect();
			previous.connect(tracked.node.input);
			previous = tracked.node.output;
		}
		previous.connect(this.output);
	}

	/** Tears down every device node and this chain's own shell. Idempotent. */
	dispose(): void {
		this.pendingRelink?.();
		this.pendingRelink = null;
		for (const [, tracked] of this.nodes) {
			void this.scope.release(tracked.handle);
		}
		this.nodes.clear();
		this.order = [];
		void this.scope.release(this.chainHandle);
	}
}
