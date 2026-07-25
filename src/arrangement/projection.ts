import type { Asset, AutomationLane, Clip, Project } from "../domain/entities";
import type { AssetId, ClipId, PlacementId, TrackId } from "../domain/ids";
import {
	buildRowOffsets,
	type RowMetrics,
	type RowRange,
	type TickRange,
} from "./geometry";
import { combineRevisions, revisionOf } from "./revision";

/**
 * The renderer-specific `ArrangementProjection` PRD section 9.3 calls for:
 * "Domain selectors build a renderer-specific `ArrangementProjection` with
 * stable IDs, integer musical bounds, track order, colors, labels, compact
 * preview data, and revision counters. Canvas code never traverses
 * Firestore-shaped data."
 *
 * This module has no DOM/Canvas/SolidJS imports either — it turns a schema-v1
 * `Project` into flat, pre-sorted, pre-indexed geometry once, so drawing and
 * hit testing never walk the domain shape (nested tracks/clips/placements)
 * per frame or per pointer event.
 */

export type PlacementPreview =
	| {
			readonly kind: "notes";
			/** Note start ticks relative to the placement, for a compact
			 * tick-mark preview instead of drawing every note event's full shape. */
			readonly noteStartTicks: readonly number[];
	  }
	| {
			readonly kind: "waveform";
			readonly assetId: AssetId;
			/** Changes only when the referenced asset's own record changes
			 * (e.g. a new decode), matching the PRD's "cached by asset ID and
			 * source revision" waveform-cache key. */
			readonly assetRevision: number;
	  };

export interface TrackRow {
	readonly id: TrackId;
	readonly rowIndex: number;
	readonly order: number;
	readonly name: string;
	readonly color: string;
	readonly type: "instrument" | "audio";
	readonly muted: boolean;
	readonly soloed: boolean;
	readonly revision: number;
}

export interface PlacementGeometry {
	readonly id: PlacementId;
	readonly trackId: TrackId;
	readonly clipId: ClipId;
	readonly rowIndex: number;
	readonly startTicks: number;
	readonly endTicks: number;
	readonly color: string;
	readonly label: string;
	readonly preview: PlacementPreview;
	readonly revision: number;
}

export interface AutomationLaneGeometry {
	readonly id: string;
	readonly trackId: TrackId;
	readonly rowIndex: number;
	readonly parameterId: string;
	readonly interpolation: AutomationLane["interpolation"];
	readonly points: ReadonlyArray<{
		readonly tick: number;
		readonly value: number;
	}>;
	readonly revision: number;
}

/** Placements for one track, sorted by `startTicks` and indexed for culling. */
export interface TrackPlacementIndex {
	readonly items: readonly PlacementGeometry[];
	/** The longest placement duration on this track. Bounds how far back a
	 * cull query must look for a placement that starts before the visible
	 * range but still overlaps it. */
	readonly maxDurationTicks: number;
}

export interface ArrangementProjection {
	readonly songRevision: number;
	readonly tempo: number;
	/** The last tick occupied by any placement or section. */
	readonly lengthTicks: number;
	readonly rowMetrics: RowMetrics;
	/** Length `tracks.length + 1`; see `buildRowOffsets`. */
	readonly rowOffsets: readonly number[];
	/** Sorted by `order` — index `i` is row `i`. */
	readonly tracks: readonly TrackRow[];
	readonly placementsByTrack: ReadonlyMap<TrackId, TrackPlacementIndex>;
	readonly placementsById: ReadonlyMap<PlacementId, PlacementGeometry>;
	/** At most one lane per track: "a track can show one automation lane at
	 * a time" (PRD ARR-04). Picking which one is a UI concern the spike does
	 * not model; this keeps the first lane found per track. */
	readonly automationByTrack: ReadonlyMap<TrackId, AutomationLaneGeometry>;
}

export function buildArrangementProjection(
	project: Project,
	rowMetrics: RowMetrics,
): ArrangementProjection {
	const clipsById = new Map<ClipId, Clip>(
		project.clips.map((clip) => [clip.id, clip]),
	);
	const assetsById = new Map<AssetId, Asset>(
		project.song.assets.map((asset) => [asset.id, asset]),
	);

	const tracksSorted = [...project.song.tracks].sort(
		(a, b) => a.order - b.order,
	);
	const rowIndexByTrackId = new Map<TrackId, number>(
		tracksSorted.map((track, index) => [track.id, index]),
	);

	const tracks: TrackRow[] = tracksSorted.map((track, index) => ({
		id: track.id,
		rowIndex: index,
		order: track.order,
		name: track.name,
		color: track.color,
		type: track.type,
		muted: track.mixer.muted,
		soloed: track.mixer.soloed,
		revision: revisionOf(track),
	}));

	const placementsById = new Map<PlacementId, PlacementGeometry>();
	const placementsByTrackMutable = new Map<
		TrackId,
		{ items: PlacementGeometry[]; maxDurationTicks: number }
	>();

	for (const placement of project.song.placements) {
		const rowIndex = rowIndexByTrackId.get(placement.trackId);
		const clip = clipsById.get(placement.clipId);
		// A dangling reference cannot survive `parseProject`; this guard only
		// protects the projection builder against being handed a `Project`
		// some other, buggier path constructed by hand (e.g. in a test).
		if (rowIndex === undefined || !clip) continue;

		const durationTicks = placement.durationTicks;
		const geometry: PlacementGeometry = {
			id: placement.id,
			trackId: placement.trackId,
			clipId: placement.clipId,
			rowIndex,
			startTicks: placement.startTicks,
			endTicks: placement.startTicks + durationTicks,
			color: clip.color,
			label: clip.name,
			preview: buildPreview(clip, assetsById),
			revision: combineRevisions(revisionOf(placement), revisionOf(clip)),
		};
		placementsById.set(placement.id, geometry);

		let bucket = placementsByTrackMutable.get(placement.trackId);
		if (!bucket) {
			bucket = { items: [], maxDurationTicks: 0 };
			placementsByTrackMutable.set(placement.trackId, bucket);
		}
		bucket.items.push(geometry);
		bucket.maxDurationTicks = Math.max(bucket.maxDurationTicks, durationTicks);
	}

	const placementsByTrack = new Map<TrackId, TrackPlacementIndex>();
	for (const [trackId, bucket] of placementsByTrackMutable) {
		bucket.items.sort((a, b) => a.startTicks - b.startTicks);
		placementsByTrack.set(trackId, {
			items: bucket.items,
			maxDurationTicks: bucket.maxDurationTicks,
		});
	}

	const automationByTrack = new Map<TrackId, AutomationLaneGeometry>();
	for (const lane of project.song.automation) {
		if (lane.target.scope !== "track") continue;
		if (automationByTrack.has(lane.target.trackId)) continue;
		const rowIndex = rowIndexByTrackId.get(lane.target.trackId);
		if (rowIndex === undefined) continue;
		automationByTrack.set(lane.target.trackId, {
			id: lane.id,
			trackId: lane.target.trackId,
			rowIndex,
			parameterId: lane.target.parameterId,
			interpolation: lane.interpolation,
			points: lane.points,
			revision: revisionOf(lane),
		});
	}

	return {
		songRevision: revisionOf(project.song),
		tempo: project.song.tempo,
		lengthTicks: arrangementLengthTicks(project),
		rowMetrics,
		rowOffsets: buildRowOffsets(tracks.length, rowMetrics),
		tracks,
		placementsByTrack,
		placementsById,
		automationByTrack,
	};
}

function buildPreview(
	clip: Clip,
	assetsById: ReadonlyMap<AssetId, Asset>,
): PlacementPreview {
	if (clip.content.kind === "audioLoop") {
		const asset = assetsById.get(clip.content.assetId);
		return {
			kind: "waveform",
			assetId: clip.content.assetId,
			assetRevision: asset ? revisionOf(asset) : 0,
		};
	}
	return {
		kind: "notes",
		noteStartTicks: clip.content.events.map((event) => event.startTicks),
	};
}

function arrangementLengthTicks(project: Project): number {
	let lengthTicks = 0;
	for (const placement of project.song.placements) {
		lengthTicks = Math.max(
			lengthTicks,
			placement.startTicks + placement.durationTicks,
		);
	}
	for (const section of project.song.sections) {
		lengthTicks = Math.max(
			lengthTicks,
			section.startTicks + section.durationTicks,
		);
	}
	return lengthTicks;
}

/**
 * Placements on one track's sorted index that intersect `tickRange`,
 * expanded implicitly by the track's longest placement so a placement that
 * starts before the visible range but still overlaps it is not missed. Cost
 * is `O(log n + k)` for `k` matches, not `O(n)` — the point of building the
 * per-track index instead of scanning `project.song.placements` directly.
 */
export function visiblePlacementsForTrack(
	index: TrackPlacementIndex,
	tickRange: TickRange,
): PlacementGeometry[] {
	if (index.items.length === 0) return [];
	const lowerBoundStart = tickRange.startTick - index.maxDurationTicks;
	let low = 0;
	let high = index.items.length;
	while (low < high) {
		const mid = (low + high) >> 1;
		if (index.items[mid].startTicks < lowerBoundStart) {
			low = mid + 1;
		} else {
			high = mid;
		}
	}
	const result: PlacementGeometry[] = [];
	for (let cursor = low; cursor < index.items.length; cursor += 1) {
		const placement = index.items[cursor];
		if (placement.startTicks > tickRange.endTick) break;
		if (placement.endTicks < tickRange.startTick) continue;
		result.push(placement);
	}
	return result;
}

/** All placements visible in `tickRange` across the rows in `rowRange`. */
export function visiblePlacements(
	projection: ArrangementProjection,
	tickRange: TickRange,
	rowRange: RowRange,
): PlacementGeometry[] {
	const result: PlacementGeometry[] = [];
	for (const track of projection.tracks) {
		if (
			track.rowIndex < rowRange.startRow ||
			track.rowIndex > rowRange.endRow
		) {
			continue;
		}
		const index = projection.placementsByTrack.get(track.id);
		if (!index) continue;
		result.push(...visiblePlacementsForTrack(index, tickRange));
	}
	return result;
}

export type HitTestResult =
	| { readonly kind: "empty" }
	| {
			readonly kind: "placement";
			readonly placementId: PlacementId;
			readonly handle: "start" | "end" | "body";
	  };

export interface HitTestPoint {
	readonly rowIndex: number;
	readonly tick: number;
}

/**
 * "Hit testing queries only the visible track's sorted objects and checks
 * handles before bodies" (PRD 9.3). `handleWidthTicks` is the resize-handle
 * width converted to musical ticks at the caller's current zoom, so the
 * handle stays a constant pixel width regardless of zoom level.
 */
export function hitTestArrangement(
	projection: ArrangementProjection,
	point: HitTestPoint,
	handleWidthTicks: number,
): HitTestResult {
	const track = projection.tracks[point.rowIndex];
	if (!track) return { kind: "empty" };
	const index = projection.placementsByTrack.get(track.id);
	if (!index) return { kind: "empty" };

	const candidates = visiblePlacementsForTrack(index, {
		startTick: point.tick - handleWidthTicks,
		endTick: point.tick + handleWidthTicks,
	});

	let match: PlacementGeometry | undefined;
	for (const placement of candidates) {
		if (
			point.tick >= placement.startTicks - handleWidthTicks &&
			point.tick <= placement.endTicks + handleWidthTicks
		) {
			match = placement;
			break;
		}
	}
	if (!match) return { kind: "empty" };

	if (Math.abs(point.tick - match.startTicks) <= handleWidthTicks) {
		return { kind: "placement", placementId: match.id, handle: "start" };
	}
	if (Math.abs(point.tick - match.endTicks) <= handleWidthTicks) {
		return { kind: "placement", placementId: match.id, handle: "end" };
	}
	if (point.tick >= match.startTicks && point.tick <= match.endTicks) {
		return { kind: "placement", placementId: match.id, handle: "body" };
	}
	return { kind: "empty" };
}
