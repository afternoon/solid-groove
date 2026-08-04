import type {
	Asset,
	AutomationLane,
	AutomationTarget,
	Clip,
	ClipContent,
	Device,
	Instrument,
	NoteTrigger,
	Placement,
	Project,
	ReturnBus,
	Section,
	Song,
	Track,
} from "./entities";
import { type Clock, createFactoryContext } from "./factories";
import type {
	AssetId,
	ClipId,
	DeviceId,
	IdFactory,
	PadId,
	ReturnId,
	SectionId,
	TrackId,
} from "./ids";
import { derivePackDependencies } from "./packs";
import { assertProject } from "./parse";

/**
 * Independent deep duplication of a whole project (PRD `PRJ-02`: "A duplicate
 * receives independent IDs for all mutable entities").
 *
 * Every entity that owns a persistent ID — tracks, devices, drum pads, return
 * buses, sections, placements, clips, note events, automation lanes, and asset
 * references — gets a freshly minted one, and every reference to those IDs
 * (sends, automation targets, clip/track/asset links, pad triggers) is rewritten
 * to match. `assertProject` is run on the result, so a missed reference fails
 * loudly here rather than silently producing a project with dangling links.
 *
 * Packs themselves are never duplicated: `packId`/`packVersion` name library
 * content the duplicate still resolves from, so they are copied unchanged onto
 * the fresh asset rows, and `derivePackDependencies` recomputes the metadata
 * tier's dependency list from those unchanged pack references. The pack shelf
 * (`addedPacks`, LIB-08) carries over from the source unchanged, so an
 * added-but-unused pack the user shelved is still shelved in the copy.
 */
export interface DuplicateProjectOptions {
	/** Defaults to the source project's owner. */
	ownerId?: string;
	/** Defaults to a "<name> copy" derived name. */
	name?: string;
	ids?: IdFactory;
	now?: number | Clock;
}

export function duplicateProject(
	source: Project,
	options: DuplicateProjectOptions = {},
): Project {
	const context = createFactoryContext({ ids: options.ids, now: options.now });

	const assetIds = new Map<AssetId, AssetId>();
	const returnIds = new Map<ReturnId, ReturnId>();
	const trackIds = new Map<TrackId, TrackId>();
	const deviceIds = new Map<DeviceId, DeviceId>();
	const padIds = new Map<PadId, PadId>();
	const clipIds = new Map<ClipId, ClipId>();
	const sectionIds = new Map<SectionId, SectionId>();

	function remapped<K>(map: Map<K, K>, key: K): K {
		const next = map.get(key);
		if (next === undefined) {
			throw new Error(
				"duplicateProject: reference resolved before its owner was remapped",
			);
		}
		return next;
	}

	function remapDevices(devices: readonly Device[]): Device[] {
		return devices.map((device) => {
			const id = context.ids("device");
			deviceIds.set(device.id, id);
			return { ...device, id };
		});
	}

	// Assets first: nothing they reference (pack fields are copied verbatim),
	// and everything else (instruments, drum pads, audio-loop clips) references
	// them.
	const assets: Asset[] = source.song.assets.map((asset) => {
		const id = context.ids("asset");
		assetIds.set(asset.id, id);
		return { ...asset, id };
	});

	// Returns before tracks: a track's `sendConfig` names a return bus.
	const returns: ReturnBus[] = source.song.returns.map((returnBus) => {
		const id = context.ids("return");
		returnIds.set(returnBus.id, id);
		return { ...returnBus, id, devices: remapDevices(returnBus.devices) };
	});

	function remapInstrument(instrument: Instrument | null): Instrument | null {
		if (!instrument) return null;
		if (instrument.kind === "synth") {
			return { ...instrument };
		}
		if (instrument.kind === "sampler") {
			return {
				...instrument,
				assetId: instrument.assetId
					? remapped(assetIds, instrument.assetId)
					: null,
			};
		}
		return {
			...instrument,
			pads: instrument.pads.map((pad) => {
				const id = context.ids("pad");
				padIds.set(pad.id, id);
				return {
					...pad,
					id,
					assetId: pad.assetId ? remapped(assetIds, pad.assetId) : null,
				};
			}),
		};
	}

	const tracks: Track[] = source.song.tracks.map((track) => {
		const id = context.ids("track");
		trackIds.set(track.id, id);
		return {
			...track,
			id,
			instrument: remapInstrument(track.instrument),
			devices: remapDevices(track.devices),
			sendConfig: track.sendConfig.map((send) => ({
				...send,
				returnId: remapped(returnIds, send.returnId),
			})),
		};
	});

	const master = {
		...source.song.master,
		devices: remapDevices(source.song.master.devices),
	};

	const sections: Section[] = source.song.sections.map((section) => {
		const id = context.ids("section");
		sectionIds.set(section.id, id);
		return { ...section, id };
	});

	function remapClipContent(content: ClipContent): ClipContent {
		if (content.kind === "audioLoop") {
			return { ...content, assetId: remapped(assetIds, content.assetId) };
		}
		return {
			...content,
			events: content.events.map((event) => ({
				...event,
				id: context.ids("event"),
				trigger: remapTrigger(event.trigger),
			})),
		};
	}

	function remapTrigger(trigger: NoteTrigger): NoteTrigger {
		if (trigger.kind === "pad") {
			return { ...trigger, padId: remapped(padIds, trigger.padId) };
		}
		return { ...trigger };
	}

	const clips: Clip[] = source.clips.map((clip) => {
		const id = context.ids("clip");
		clipIds.set(clip.id, id);
		return {
			...clip,
			id,
			trackId: remapped(trackIds, clip.trackId),
			content: remapClipContent(clip.content),
		};
	});

	const placements: Placement[] = source.song.placements.map((placement) => ({
		...placement,
		id: context.ids("placement"),
		clipId: remapped(clipIds, placement.clipId),
		trackId: remapped(trackIds, placement.trackId),
	}));

	function remapAutomationTarget(target: AutomationTarget): AutomationTarget {
		switch (target.scope) {
			case "track":
				return { ...target, trackId: remapped(trackIds, target.trackId) };
			case "trackDevice":
				return {
					...target,
					trackId: remapped(trackIds, target.trackId),
					deviceId: remapped(deviceIds, target.deviceId),
				};
			case "send":
				return {
					...target,
					trackId: remapped(trackIds, target.trackId),
					returnId: remapped(returnIds, target.returnId),
				};
			case "return":
				return { ...target, returnId: remapped(returnIds, target.returnId) };
			case "master":
				return { ...target };
		}
	}

	const automation: AutomationLane[] = source.song.automation.map((lane) => ({
		...lane,
		id: context.ids("automation"),
		target: remapAutomationTarget(lane.target),
		points: lane.points.map((point) => ({ ...point })),
	}));

	const song: Song = {
		...source.song,
		tracks,
		returns,
		master,
		sections,
		placements,
		automation,
		assets,
	};

	const timestamp = context.now();
	return assertProject({
		metadata: {
			...source.metadata,
			id: context.ids("project"),
			revision: 0,
			name: options.name ?? duplicateName(source.metadata.name),
			ownerId: options.ownerId ?? source.metadata.ownerId,
			collaboratorIds: [],
			createdAt: timestamp,
			modifiedAt: timestamp,
			packDependencies: derivePackDependencies(song),
		},
		song,
		clips,
	});
}

function duplicateName(name: string): string {
	return `${name} copy`;
}
