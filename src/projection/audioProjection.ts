import type {
	AutomationLane,
	AutomationPoint,
	AutomationTarget,
	ClipContent,
	Device,
	Instrument,
	MasterSettings,
	Placement,
	Project,
	ReturnBus,
	Send,
	Track,
	TrackMixer,
} from "../domain/entities";
import type {
	AssetId,
	AutomationId,
	ClipId,
	PlacementId,
	ReturnId,
	TrackId,
} from "../domain/ids";
import type { Ticks } from "../domain/time";
import { fingerprintOf } from "./fingerprint";

/**
 * The audio engine's read-only song projection (PRD section 9.7).
 *
 * `buildAudioProjection` never mutates the `Project` it reads, and its output
 * carries only what a `ProjectAudioGraph` needs to build or reconcile Tone
 * nodes: no `name`, `color`, UI selection, viewport, or assistant state can
 * reach it, because those fields simply are not part of this shape (`FND-006`
 * and `FND-007` build the runtime that consumes this; this task owns the
 * projection they will read).
 *
 * Every entry carries a `fingerprint`: a deterministic digest of exactly the
 * fields this projection exposes for that entity (see `fingerprint.ts`).
 * Passing the previous build as `previous` lets unrelated edits reuse the
 * exact same entry object — a track whose `fingerprint` has not changed comes
 * back as the identical reference, so a consumer that keys its own resources
 * off object identity (or does a `===` check before doing any work) never
 * sees a track it did not actually change. Renaming a track, clip, or return
 * bus changes neither `fingerprint` nor `topologyFingerprint` on this
 * projection, because `name`/`color` never appear in it at all — by
 * construction, a rename cannot look like an audio change, topology or
 * otherwise.
 */

export interface AudioTrackProjection {
	readonly id: TrackId;
	readonly type: Track["type"];
	readonly instrument: Instrument | null;
	/** Ordered by chain position (the `order` field), not array insertion order. */
	readonly devices: readonly Device[];
	readonly sendConfig: readonly Send[];
	readonly mixer: TrackMixer;
	/** Changes for any audio-relevant edit to this track. */
	readonly fingerprint: string;
	/**
	 * Changes only when the node graph's *shape* would need to change: track
	 * type, instrument kind/asset, drum pad identity, device chain composition
	 * and order, or which return buses a send targets and whether it taps
	 * pre- or post-fader. Continuous values (mixer volume/pan, device
	 * parameters, send levels, device bypass) are excluded, since those update
	 * an existing node rather than reshape the graph.
	 */
	readonly topologyFingerprint: string;
}

export interface AudioReturnProjection {
	readonly id: ReturnId;
	readonly order: number;
	/** Ordered by chain position (the `order` field), not array insertion order. */
	readonly devices: readonly Device[];
	readonly mixer: ReturnBus["mixer"];
	/** Changes for any audio-relevant edit to this return bus. */
	readonly fingerprint: string;
	/**
	 * Changes only when the return bus's node graph *shape* would need to
	 * change: device chain composition and order. Continuous values (mixer
	 * volume/pan/muted, device parameters, device bypass) are excluded, since
	 * those update an existing node rather than reshape the graph.
	 */
	readonly topologyFingerprint: string;
}

export interface AudioClipProjection {
	readonly id: ClipId;
	readonly trackId: TrackId;
	readonly lengthTicks: Ticks;
	readonly content: ClipContent;
	readonly fingerprint: string;
}

export interface AudioPlacementProjection {
	readonly id: PlacementId;
	readonly clipId: ClipId;
	readonly trackId: TrackId;
	readonly startTicks: Ticks;
	readonly durationTicks: Ticks;
	readonly clipOffsetTicks: Ticks;
	readonly looped: boolean;
	readonly fingerprint: string;
}

export interface AudioAutomationProjection {
	readonly id: AutomationId;
	readonly target: AutomationTarget;
	readonly interpolation: AutomationLane["interpolation"];
	readonly points: readonly AutomationPoint[];
	readonly fingerprint: string;
}

export interface AudioAssetProjection {
	readonly id: AssetId;
	readonly kind: string;
	readonly storageRef: string;
	readonly url: string | null;
	readonly durationSeconds: number | null;
	readonly sampleRate: number | null;
	readonly channelCount: number | null;
	readonly fingerprint: string;
}

export interface AudioMasterProjection {
	readonly volume: MasterSettings["volume"];
	/** Ordered by chain position (the `order` field), not array insertion order. */
	readonly devices: readonly Device[];
	/** Changes for any audio-relevant edit to the master bus. */
	readonly fingerprint: string;
	/** Changes only when the master device chain's composition or order changes. */
	readonly topologyFingerprint: string;
}

export interface AudioSongProjection {
	/** The project's own revision counter — the real, stored "song" granularity. */
	readonly revision: number;
	readonly tempo: number;
	readonly timeSignature: Readonly<{ numerator: number; denominator: number }>;
	readonly master: AudioMasterProjection;
	readonly returns: readonly AudioReturnProjection[];
	readonly returnsById: ReadonlyMap<ReturnId, AudioReturnProjection>;
	readonly tracks: readonly AudioTrackProjection[];
	readonly tracksById: ReadonlyMap<TrackId, AudioTrackProjection>;
	readonly clips: readonly AudioClipProjection[];
	readonly clipsById: ReadonlyMap<ClipId, AudioClipProjection>;
	readonly placements: readonly AudioPlacementProjection[];
	readonly automation: readonly AudioAutomationProjection[];
	readonly assets: readonly AudioAssetProjection[];
}

function compareStrings(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

function sortDevices(devices: readonly Device[]): Device[] {
	return [...devices].sort(
		(a, b) => a.order - b.order || compareStrings(a.id, b.id),
	);
}

function sortSends(sendConfig: readonly Send[]): Send[] {
	return [...sendConfig].sort((a, b) => compareStrings(a.returnId, b.returnId));
}

function instrumentTopologyShape(instrument: Instrument | null): unknown {
	if (!instrument) return null;
	switch (instrument.kind) {
		case "sampler":
			return { kind: instrument.kind, assetId: instrument.assetId };
		case "synth":
			return { kind: instrument.kind };
		case "drumMachine":
			return {
				kind: instrument.kind,
				pads: [...instrument.pads]
					.map((pad) => ({ id: pad.id, assetId: pad.assetId }))
					.sort((a, b) => compareStrings(a.id, b.id)),
			};
	}
}

function trackTopologyShape(track: Track, devices: readonly Device[]): unknown {
	return {
		type: track.type,
		instrument: instrumentTopologyShape(track.instrument),
		devices: devices.map((device) => ({ id: device.id, type: device.type })),
		sends: sortSends(track.sendConfig).map((send) => ({
			returnId: send.returnId,
			preFader: send.preFader,
		})),
	};
}

function trackFullShape(track: Track, devices: readonly Device[]): unknown {
	return {
		topology: trackTopologyShape(track, devices),
		devices: devices.map((device) => ({
			id: device.id,
			bypassed: device.bypassed,
			parameters: device.parameters,
		})),
		sends: sortSends(track.sendConfig).map((send) => ({
			returnId: send.returnId,
			level: send.level,
			preFader: send.preFader,
		})),
		instrumentParameters:
			track.instrument?.kind === "drumMachine"
				? {
						parameters: track.instrument.parameters,
						pads: [...track.instrument.pads]
							.map((pad) => ({
								id: pad.id,
								chokeGroup: pad.chokeGroup,
								parameters: pad.parameters,
								mixer: pad.mixer,
							}))
							.sort((a, b) => compareStrings(a.id, b.id)),
					}
				: (track.instrument?.parameters ?? null),
		mixer: track.mixer,
	};
}

function buildAudioTrack(
	track: Track,
	previous: AudioTrackProjection | undefined,
): AudioTrackProjection {
	const devices = sortDevices(track.devices);
	const topologyFingerprint = fingerprintOf(trackTopologyShape(track, devices));
	const fingerprint = fingerprintOf(trackFullShape(track, devices));
	if (
		previous &&
		previous.fingerprint === fingerprint &&
		previous.topologyFingerprint === topologyFingerprint
	) {
		return previous;
	}
	return {
		id: track.id,
		type: track.type,
		instrument: track.instrument,
		devices,
		sendConfig: sortSends(track.sendConfig),
		mixer: track.mixer,
		fingerprint,
		topologyFingerprint,
	};
}

function returnTopologyShape(devices: readonly Device[]): unknown {
	return {
		devices: devices.map((device) => ({ id: device.id, type: device.type })),
	};
}

function returnFullShape(
	order: number,
	devices: readonly Device[],
	mixer: ReturnBus["mixer"],
): unknown {
	return {
		order,
		topology: returnTopologyShape(devices),
		devices: devices.map((device) => ({
			id: device.id,
			bypassed: device.bypassed,
			parameters: device.parameters,
		})),
		mixer,
	};
}

function buildAudioReturn(
	bus: ReturnBus,
	previous: AudioReturnProjection | undefined,
): AudioReturnProjection {
	const devices = sortDevices(bus.devices);
	const topologyFingerprint = fingerprintOf(returnTopologyShape(devices));
	const fingerprint = fingerprintOf(
		returnFullShape(bus.order, devices, bus.mixer),
	);
	if (
		previous &&
		previous.fingerprint === fingerprint &&
		previous.topologyFingerprint === topologyFingerprint
	) {
		return previous;
	}
	return {
		id: bus.id,
		order: bus.order,
		devices,
		mixer: bus.mixer,
		fingerprint,
		topologyFingerprint,
	};
}

function buildAudioMaster(
	master: MasterSettings,
	previous: AudioMasterProjection | undefined,
): AudioMasterProjection {
	const devices = sortDevices(master.devices);
	const topologyFingerprint = fingerprintOf(returnTopologyShape(devices));
	const fingerprint = fingerprintOf({
		volume: master.volume,
		devices: devices.map((device) => ({
			id: device.id,
			bypassed: device.bypassed,
			parameters: device.parameters,
		})),
	});
	if (
		previous &&
		previous.fingerprint === fingerprint &&
		previous.topologyFingerprint === topologyFingerprint
	) {
		return previous;
	}
	return {
		volume: master.volume,
		devices,
		fingerprint,
		topologyFingerprint,
	};
}

function buildAudioClip(
	clip: Project["clips"][number],
	previous: AudioClipProjection | undefined,
): AudioClipProjection {
	const shape = {
		trackId: clip.trackId,
		lengthTicks: clip.lengthTicks,
		content: clip.content,
	};
	const fingerprint = fingerprintOf(shape);
	if (previous && previous.fingerprint === fingerprint) {
		return previous;
	}
	return {
		id: clip.id,
		trackId: clip.trackId,
		lengthTicks: clip.lengthTicks,
		content: clip.content,
		fingerprint,
	};
}

function buildAudioPlacement(
	placement: Placement,
	previous: AudioPlacementProjection | undefined,
): AudioPlacementProjection {
	const shape = {
		clipId: placement.clipId,
		trackId: placement.trackId,
		startTicks: placement.startTicks,
		durationTicks: placement.durationTicks,
		clipOffsetTicks: placement.clipOffsetTicks,
		looped: placement.looped,
	};
	const fingerprint = fingerprintOf(shape);
	if (previous && previous.fingerprint === fingerprint) {
		return previous;
	}
	return { id: placement.id, ...shape, fingerprint };
}

function buildAudioAutomation(
	lane: AutomationLane,
	previous: AudioAutomationProjection | undefined,
): AudioAutomationProjection {
	const points = [...lane.points].sort((a, b) => a.tick - b.tick);
	const shape = {
		target: lane.target,
		interpolation: lane.interpolation,
		points,
	};
	const fingerprint = fingerprintOf(shape);
	if (previous && previous.fingerprint === fingerprint) {
		return previous;
	}
	return {
		id: lane.id,
		target: lane.target,
		interpolation: lane.interpolation,
		points,
		fingerprint,
	};
}

function buildAudioAsset(
	asset: Project["song"]["assets"][number],
	previous: AudioAssetProjection | undefined,
): AudioAssetProjection {
	const shape = {
		kind: asset.kind,
		storageRef: asset.storageRef,
		url: asset.url,
		durationSeconds: asset.durationSeconds,
		sampleRate: asset.sampleRate,
		channelCount: asset.channelCount,
	};
	const fingerprint = fingerprintOf(shape);
	if (previous && previous.fingerprint === fingerprint) {
		return previous;
	}
	return { id: asset.id, ...shape, fingerprint };
}

/**
 * Builds (or incrementally rebuilds) the audio engine's song projection.
 * Passing the previous projection as `previous` reuses every entry whose
 * relevant fields have not changed, so unrelated edits do not appear as an
 * audio change to anything downstream that compares object identity.
 */
export function buildAudioProjection(
	project: Project,
	previous?: AudioSongProjection,
): AudioSongProjection {
	const tracks = [...project.song.tracks]
		.sort((a, b) => compareStrings(a.id, b.id))
		.map((track) => buildAudioTrack(track, previous?.tracksById.get(track.id)));

	const returns = [...project.song.returns]
		.sort((a, b) => compareStrings(a.id, b.id))
		.map((bus) => buildAudioReturn(bus, previous?.returnsById.get(bus.id)));

	const master = buildAudioMaster(project.song.master, previous?.master);

	const clips = [...project.clips]
		.sort((a, b) => compareStrings(a.id, b.id))
		.map((clip) => buildAudioClip(clip, previous?.clipsById.get(clip.id)));

	const previousPlacements = previous
		? new Map(previous.placements.map((p) => [p.id, p]))
		: undefined;
	const placements = [...project.song.placements]
		.sort((a, b) => compareStrings(a.id, b.id))
		.map((placement) =>
			buildAudioPlacement(placement, previousPlacements?.get(placement.id)),
		);

	const previousAutomation = previous
		? new Map(previous.automation.map((lane) => [lane.id, lane]))
		: undefined;
	const automation = [...project.song.automation]
		.sort((a, b) => compareStrings(a.id, b.id))
		.map((lane) =>
			buildAudioAutomation(lane, previousAutomation?.get(lane.id)),
		);

	const previousAssets = previous
		? new Map(previous.assets.map((asset) => [asset.id, asset]))
		: undefined;
	const assets = [...project.song.assets]
		.sort((a, b) => compareStrings(a.id, b.id))
		.map((asset) => buildAudioAsset(asset, previousAssets?.get(asset.id)));

	return {
		revision: project.metadata.revision,
		tempo: project.song.tempo,
		timeSignature: project.song.timeSignature,
		master,
		returns,
		returnsById: new Map(returns.map((bus) => [bus.id, bus])),
		tracks,
		tracksById: new Map(tracks.map((track) => [track.id, track])),
		clips,
		clipsById: new Map(clips.map((clip) => [clip.id, clip])),
		placements,
		automation,
		assets,
	};
}
