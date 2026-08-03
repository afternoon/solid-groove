import * as Tone from "tone";
import type { AssetId, PlacementId, ReturnId, TrackId } from "../domain/ids";
import type {
	AudioAssetProjection,
	AudioClipProjection,
	AudioPlacementProjection,
	AudioSongProjection,
} from "../projection/audioProjection";
import {
	type AssetBufferLoader,
	AudioBufferCache,
	type AudioBufferCacheDiagnostics,
	type BufferSubscription,
} from "./AudioBufferCache";
import type { AudioHost, AudioProjectScope } from "./AudioRuntime";
import type { DeviceNodeFactory } from "./DeviceChain";
import type { InstrumentNodeFactory } from "./InstrumentGraph";
import { playOneShot } from "./InstrumentGraph";
import { MasterAudioGraph } from "./MasterAudioGraph";
import { ReturnAudioGraph } from "./ReturnAudioGraph";
import type { ResourceHandle } from "./resourceRegistry";
import {
	audioLoopDurationSeconds,
	audioLoopOffsetSeconds,
	computePlacementSchedule,
	ticksToToneTime,
} from "./scheduling";
import { TrackAudioGraph } from "./TrackAudioGraph";
import { toneBufferLoader } from "./toneBufferLoader";
import type { UnderrunMonitor } from "./underrun";

/**
 * The transport this graph schedules against. An interface rather than a
 * direct `Tone.getTransport()` reference so scheduling can be reconciled and
 * tested (owner-tracked handles, no leaked/duplicate schedules) without a
 * real Tone context (PRD AUD-03/AUD-08).
 */
export interface AudioTransport {
	bpm: { value: number };
	schedule(callback: (time: number) => void, time: string): number;
	clear(id: number): void;
}

const liveTransport: AudioTransport = {
	get bpm() {
		return Tone.getTransport().bpm;
	},
	schedule(callback, time) {
		return Tone.getTransport().schedule(callback, time);
	},
	clear(id) {
		Tone.getTransport().clear(id);
	},
};

/**
 * The audio clock the underrun monitor compares a scheduled event's intended
 * time against: the context's *true* current time, not `Tone.now()`.
 *
 * This distinction is the whole measurement. `Tone.now()` is
 * `currentTime + lookAhead` (default 0.1s), and Tone's `Clock._loop` dispatches
 * every event whose time falls in `(lastUpdate, Tone.now()]` — so inside a
 * scheduled callback, `Tone.now() >= intendedTime` *always*, on perfectly
 * healthy playback. Comparing against it would count most events as drops and
 * turn `audio_underrun` into per-note telemetry, exactly what PRD OPS-02
 * forbids. `immediate()` is `currentTime`, which at dispatch sits a whole
 * lookahead window (50-100ms with Tone's defaults) *before* the intended time
 * and only passes it on a genuinely late dispatch.
 */
export function audioClockNow(): number {
	return Tone.getContext().immediate();
}

export interface ProjectAudioGraphOptions {
	transport?: AudioTransport;
	bufferLoader?: AssetBufferLoader<Tone.ToneAudioBuffer>;
	createInstrument?: InstrumentNodeFactory;
	createDeviceNode?: DeviceNodeFactory;
	/**
	 * Sampled scheduling-underrun monitor (PRD AUD-03/OPS-02). Each scheduled
	 * callback reports its (intended, actual) audio time to this, so a late
	 * dispatch is detected and sampled rather than emitting per-event telemetry.
	 * Optional: without it, scheduling behaves identically but underruns are not
	 * measured.
	 */
	underrunMonitor?: UnderrunMonitor;
	/** The current audio time, in seconds. Defaults to {@link audioClockNow};
	 * injectable for tests. */
	now?: () => number;
}

/** Everything scheduled for one placement, so a later reconcile pass can tell
 * whether it needs to be re-derived (placement, clip, or tempo changed) or
 * left alone, and can release exactly this placement's handles either way. */
interface PlacementScheduleEntry {
	placementRef: AudioPlacementProjection;
	clipRef: AudioClipProjection;
	tempo: number;
	handles: ResourceHandle[];
}

/**
 * The audio engine's stable, ID-keyed project graph (PRD AUD-03, AUD-08;
 * section 9.7). Owns the master bus, return buses, track graphs, the asset
 * buffer cache, and the arrangement's transport schedule, all reconciled from
 * a read-only {@link AudioSongProjection} instead of rebuilt from a mutable
 * project object. Replacing this graph (e.g. opening a different project)
 * leaves the {@link AudioRuntime}'s shared context and transport intact.
 */
export class ProjectAudioGraph {
	private readonly scope: AudioProjectScope;
	private readonly transport: AudioTransport;
	private readonly bufferCache: AudioBufferCache<Tone.ToneAudioBuffer>;
	private readonly master: MasterAudioGraph;
	private readonly returns = new Map<ReturnId, ReturnAudioGraph>();
	private readonly tracks = new Map<TrackId, TrackAudioGraph>();
	private readonly placementSchedules = new Map<
		PlacementId,
		PlacementScheduleEntry
	>();
	private readonly createInstrument?: InstrumentNodeFactory;
	private readonly createDeviceNode?: DeviceNodeFactory;
	private readonly underrunMonitor?: UnderrunMonitor;
	private readonly now: () => number;
	/**
	 * One persistent map, mutated in place every reconcile rather than
	 * replaced. Track/instrument graphs are constructed once and capture a
	 * reference to this same map; if it were rebuilt fresh each reconcile,
	 * every already-constructed graph would keep looking up assets in a
	 * stale, ever-older snapshot instead of the current asset list.
	 */
	private readonly assetsById = new Map<AssetId, AudioAssetProjection>();
	private lastProjection: AudioSongProjection | null = null;
	private disposed = false;

	constructor(
		private readonly runtime: AudioHost,
		ownerId: string,
		options: ProjectAudioGraphOptions = {},
	) {
		this.scope = runtime.openProjectScope(ownerId);
		this.transport = options.transport ?? liveTransport;
		this.bufferCache = new AudioBufferCache(
			options.bufferLoader ?? toneBufferLoader,
		);
		this.createInstrument = options.createInstrument;
		this.createDeviceNode = options.createDeviceNode;
		this.underrunMonitor = options.underrunMonitor;
		this.now = options.now ?? audioClockNow;
		this.master = new MasterAudioGraph(
			this.scope,
			this.runtime.getDestination(),
			this.createDeviceNode,
		);
	}

	/** Read access for tests and diagnostics; not part of the reconciliation contract. */
	get trackGraphs(): ReadonlyMap<TrackId, TrackAudioGraph> {
		return this.tracks;
	}

	/** The master bus's peak meter, for a level display (PRD AUD-04). */
	get masterMeter(): Tone.Meter {
		return this.master.levelMeter;
	}

	/**
	 * The project disposal scope, so a session-scoped companion (e.g. the
	 * transport metronome) can register its resources under the same owner and
	 * be torn down when the project graph is disposed.
	 */
	get projectScope(): AudioProjectScope {
		return this.scope;
	}

	/** The master bus input — where an auxiliary source (the metronome) taps in
	 * so it too passes through the safety limiter (PRD AUD-04). */
	get masterInput(): Tone.ToneAudioNode {
		return this.master.input;
	}

	get returnGraphs(): ReadonlyMap<ReturnId, ReturnAudioGraph> {
		return this.returns;
	}

	diagnostics(): {
		tracks: number;
		returns: number;
		scheduledPlacements: number;
		buffers: AudioBufferCacheDiagnostics;
	} {
		return {
			tracks: this.tracks.size,
			returns: this.returns.size,
			scheduledPlacements: this.placementSchedules.size,
			buffers: this.bufferCache.diagnostics(),
		};
	}

	/**
	 * Reconciles this graph against `next`. Passing the exact projection
	 * object the audio projection handed back last time is a complete no-op —
	 * every entry within it that is itself unchanged (by reference) is
	 * likewise skipped, so an edit to one track, return, or placement never
	 * touches any other entity's nodes or schedule.
	 */
	reconcile(next: AudioSongProjection): void {
		if (this.lastProjection === next) return;

		this.assetsById.clear();
		for (const asset of next.assets) {
			this.assetsById.set(asset.id, asset);
			this.bufferCache.refresh(asset);
		}

		this.transport.bpm.value = next.tempo;

		this.master.reconcile(next.master);
		this.syncReturns(next);

		const anySolo = next.tracks.some((track) => track.mixer.soloed);
		this.syncTracks(next, anySolo);

		// Returns no longer referenced are only safe to dispose once no track
		// send still targets them — i.e. after `syncTracks` above.
		this.pruneReturns(next);

		this.syncSchedule(next);

		this.lastProjection = next;
	}

	private syncReturns(next: AudioSongProjection): void {
		for (const returnProjection of next.returns) {
			let graph = this.returns.get(returnProjection.id);
			if (!graph) {
				graph = new ReturnAudioGraph(
					returnProjection.id,
					this.scope,
					this.master.input,
					this.createDeviceNode,
				);
				this.returns.set(returnProjection.id, graph);
			}
			graph.reconcile(returnProjection);
		}
	}

	private pruneReturns(next: AudioSongProjection): void {
		for (const [id, graph] of this.returns) {
			if (!next.returnsById.has(id)) {
				graph.dispose();
				this.returns.delete(id);
			}
		}
	}

	private syncTracks(next: AudioSongProjection, anySolo: boolean): void {
		for (const [id, graph] of this.tracks) {
			if (!next.tracksById.has(id)) {
				graph.dispose();
				this.tracks.delete(id);
			}
		}

		for (const trackProjection of next.tracks) {
			let graph = this.tracks.get(trackProjection.id);
			if (!graph) {
				graph = new TrackAudioGraph(
					trackProjection.id,
					{
						scope: this.scope,
						assetsById: this.assetsById,
						bufferCache: this.bufferCache,
						getReturnInput: (returnId) => this.returns.get(returnId)?.input,
						createInstrument: this.createInstrument,
						createDeviceNode: this.createDeviceNode,
					},
					this.master.input,
				);
				this.tracks.set(trackProjection.id, graph);
			}
			const effectiveMuted =
				trackProjection.mixer.muted ||
				(anySolo && !trackProjection.mixer.soloed);
			graph.reconcile(trackProjection, effectiveMuted);
		}
	}

	private syncSchedule(next: AudioSongProjection): void {
		const nextIds = new Set(next.placements.map((placement) => placement.id));

		for (const [id, entry] of this.placementSchedules) {
			if (!nextIds.has(id)) {
				this.releaseSchedule(entry);
				this.placementSchedules.delete(id);
			}
		}

		for (const placement of next.placements) {
			const clip = next.clipsById.get(placement.clipId);
			if (!clip) continue; // domain invariants forbid a dangling clip reference; defensive only

			const existing = this.placementSchedules.get(placement.id);
			if (
				existing &&
				existing.placementRef === placement &&
				existing.clipRef === clip &&
				existing.tempo === next.tempo
			) {
				continue;
			}
			if (existing) this.releaseSchedule(existing);

			const entry: PlacementScheduleEntry = {
				placementRef: placement,
				clipRef: clip,
				tempo: next.tempo,
				handles: [],
			};
			this.scheduleNotesAndLoops(placement, clip, next.tempo, entry);
			this.placementSchedules.set(placement.id, entry);
		}
	}

	private scheduleNotesAndLoops(
		placement: AudioPlacementProjection,
		clip: AudioClipProjection,
		tempo: number,
		entry: PlacementScheduleEntry,
	): void {
		const { notes, audioLoops } = computePlacementSchedule(
			placement,
			clip,
			tempo,
		);

		for (const note of notes) {
			const scheduleId = this.transport.schedule((time) => {
				this.underrunMonitor?.observe(time, this.now());
				this.tracks
					.get(note.trackId)
					?.trigger(
						note.trigger,
						time,
						ticksToToneTime(note.durationTicks),
						note.velocity,
					);
			}, ticksToToneTime(note.absoluteTicks));
			entry.handles.push(
				this.scope.register("schedule", () => this.transport.clear(scheduleId)),
			);
		}

		for (const loop of audioLoops) {
			const bufferBox: { current: Tone.ToneAudioBuffer | null } = {
				current: null,
			};
			const asset = this.assetsById.get(loop.assetId);
			if (asset) {
				entry.handles.push(this.subscribeAudioLoopAsset(asset, bufferBox));
			}
			const offsetSeconds = audioLoopOffsetSeconds(loop, tempo);
			const durationSeconds = audioLoopDurationSeconds(loop, tempo);
			const scheduleId = this.transport.schedule((time) => {
				this.underrunMonitor?.observe(time, this.now());
				const track = this.tracks.get(loop.trackId);
				if (track && bufferBox.current) {
					playOneShot(
						bufferBox.current,
						track.audioInput,
						time,
						durationSeconds,
						loop.playbackRate,
						offsetSeconds,
					);
				}
			}, ticksToToneTime(loop.absoluteTicks));
			entry.handles.push(
				this.scope.register("schedule", () => this.transport.clear(scheduleId)),
			);
		}
	}

	private subscribeAudioLoopAsset(
		asset: AudioAssetProjection,
		bufferBox: { current: Tone.ToneAudioBuffer | null },
	): ResourceHandle {
		const subscription: BufferSubscription = this.bufferCache.subscribe(
			asset,
			(buffer) => {
				bufferBox.current = buffer;
			},
		);
		return this.scope.register("subscription", () => subscription.release());
	}

	private releaseSchedule(entry: PlacementScheduleEntry): void {
		for (const handle of entry.handles) void this.scope.release(handle);
	}

	/**
	 * Tears down every track, return, and the master bus, clears the
	 * arrangement schedule, and releases the buffer cache. Safe to call more
	 * than once; the runtime/context and any other project graph are
	 * untouched (PRD AUD-07).
	 */
	async dispose(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;

		for (const [, entry] of this.placementSchedules) {
			this.releaseSchedule(entry);
		}
		this.placementSchedules.clear();

		for (const [, graph] of this.tracks) graph.dispose();
		this.tracks.clear();

		for (const [, graph] of this.returns) graph.dispose();
		this.returns.clear();

		this.master.dispose();
		this.bufferCache.dispose();

		await this.scope.dispose();
	}
}
