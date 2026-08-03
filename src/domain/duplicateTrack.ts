import type {
	AutomationLane,
	Clip,
	ClipContent,
	Device,
	Instrument,
	NoteTrigger,
	Placement,
	Project,
	Track,
} from "./entities";
import { createFactoryContext, type DomainFactoryContext } from "./factories";
import type { ClipId, DeviceId, IdFactory, PadId } from "./ids";

/**
 * The independent deep duplicate of one track (PRD `TRK-01`, and the same
 * "independent IDs for every mutable entity" rule `PRJ-02` applies to a whole
 * project via {@link duplicateProject}).
 *
 * Duplicating a track is not a shallow copy: the track's devices, drum-machine
 * pads, its clips and their note events, the placements that put those clips on
 * the timeline, and any automation lane that targets the track all own
 * persistent IDs, and a duplicate that reused any of them would alias the
 * source. Every one is minted fresh here and every reference to it (a pad
 * trigger, a clip's `trackId`, a placement's `clipId`/`trackId`, an automation
 * target) is rewritten to match, so the copy is fully independent.
 *
 * Sends are copied verbatim: a `returnId` names a return bus that is *not*
 * duplicated (returns are song-level, not per-track), so the copy routes to the
 * same returns the source did — that is what "reorder/duplicate preserves
 * routing" means. Assets are likewise referenced, never duplicated: an
 * `assetId` names pack-qualified library content the copy still resolves from.
 *
 * The result is a set of new entities ready to hand to the `track.create`
 * command, whose payload already carries a track plus its companion clips,
 * placements, and automation. Duplication therefore reuses the one validated,
 * invertible insertion command rather than introducing a second one.
 */
export interface DuplicatedTrack {
	readonly track: Track;
	readonly clips: readonly Clip[];
	readonly placements: readonly Placement[];
	readonly automation: readonly AutomationLane[];
}

export interface DuplicateTrackOptions {
	/** Where to insert the copy. Defaults to immediately after the source. */
	readonly order?: number;
	/** Defaults to a "<name> copy" derived name. */
	readonly name?: string;
	readonly ids?: IdFactory;
}

export function duplicateTrack(
	project: Project,
	sourceTrackId: Track["id"],
	options: DuplicateTrackOptions = {},
): DuplicatedTrack {
	const source = project.song.tracks.find(
		(track) => track.id === sourceTrackId,
	);
	if (!source) {
		throw new Error(`duplicateTrack: track ${sourceTrackId} does not exist`);
	}

	const context = createFactoryContext({ ids: options.ids });
	const deviceIds = new Map<DeviceId, DeviceId>();
	const padIds = new Map<PadId, PadId>();
	const clipIds = new Map<ClipId, ClipId>();

	const trackId = context.ids("track");

	const track: Track = {
		...source,
		id: trackId,
		name: options.name ?? duplicateName(source.name),
		order: options.order ?? source.order + 1,
		instrument: remapInstrument(context, source.instrument, padIds),
		devices: remapDevices(context, source.devices, deviceIds),
		// Sends route to song-level return buses, which are not duplicated.
		sendConfig: source.sendConfig.map((send) => ({ ...send })),
	};

	const clips: Clip[] = project.clips
		.filter((clip) => clip.trackId === source.id)
		.map((clip) => {
			const id = context.ids("clip");
			clipIds.set(clip.id, id);
			return {
				...clip,
				id,
				trackId,
				content: remapClipContent(context, clip.content, padIds),
			};
		});

	const placements: Placement[] = project.song.placements
		.filter((placement) => placement.trackId === source.id)
		.map((placement) => ({
			...placement,
			id: context.ids("placement"),
			trackId,
			clipId: remap(clipIds, placement.clipId),
		}));

	const automation: AutomationLane[] = project.song.automation
		.filter(
			(lane) => "trackId" in lane.target && lane.target.trackId === source.id,
		)
		.map((lane) => ({
			...lane,
			id: context.ids("automation"),
			target:
				lane.target.scope === "trackDevice"
					? {
							...lane.target,
							trackId,
							deviceId: remap(deviceIds, lane.target.deviceId),
						}
					: { ...lane.target, trackId },
			points: lane.points.map((point) => ({ ...point })),
		}));

	return { track, clips, placements, automation };
}

function remapDevices(
	context: DomainFactoryContext,
	devices: readonly Device[],
	deviceIds: Map<DeviceId, DeviceId>,
): Device[] {
	return devices.map((device) => {
		const id = context.ids("device");
		deviceIds.set(device.id, id);
		return { ...device, id };
	});
}

function remapInstrument(
	context: DomainFactoryContext,
	instrument: Instrument | null,
	padIds: Map<PadId, PadId>,
): Instrument | null {
	if (!instrument) return null;
	if (instrument.kind === "synth" || instrument.kind === "sampler") {
		return { ...instrument };
	}
	return {
		...instrument,
		pads: instrument.pads.map((pad) => {
			const id = context.ids("pad");
			padIds.set(pad.id, id);
			return { ...pad, id };
		}),
	};
}

function remapClipContent(
	context: DomainFactoryContext,
	content: ClipContent,
	padIds: Map<PadId, PadId>,
): ClipContent {
	if (content.kind === "audioLoop") {
		return { ...content };
	}
	return {
		...content,
		events: content.events.map((event) => ({
			...event,
			id: context.ids("event"),
			trigger: remapTrigger(event.trigger, padIds),
		})),
	};
}

function remapTrigger(
	trigger: NoteTrigger,
	padIds: Map<PadId, PadId>,
): NoteTrigger {
	if (trigger.kind === "pad") {
		return { ...trigger, padId: remap(padIds, trigger.padId) };
	}
	return { ...trigger };
}

function remap<K>(map: Map<K, K>, key: K): K {
	const next = map.get(key);
	if (next === undefined) {
		throw new Error(
			"duplicateTrack: reference resolved before its owner was remapped",
		);
	}
	return next;
}

function duplicateName(name: string): string {
	return `${name} copy`;
}
