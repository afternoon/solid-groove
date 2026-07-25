import type {
	AutomationLane,
	AutomationTarget,
	Project,
	Track,
} from "../domain/entities";
import type {
	AssetId,
	AutomationId,
	ClipId,
	PlacementId,
	SectionId,
	TrackId,
} from "../domain/ids";
import { TICKS_PER_BAR, type Ticks, toTicks } from "../domain/time";
import { fingerprintOf } from "./fingerprint";

/**
 * The arrangement renderer's read-only projection (PRD section 9.3).
 *
 * This is the "domain selector" the section describes: stable IDs, integer
 * musical bounds, track order, colors, labels, compact clip/automation
 * preview data, and revision counters "so unrelated edits do not invalidate
 * all cached geometry." It does not do any of the *drawing* work section 9.3
 * assigns to the Phase 2 renderer (`ARR-005`) or its Phase 0 spike
 * (`FND-008`): no canvas layers, no viewport/zoom transform, no waveform
 * peak pyramids, no LRU visual cache. What it gives that renderer is the data
 * to draw from, plus the two lookups 9.3 calls out by name — a track row at a
 * given pixel offset, and the placements/automation a track has in a tick
 * range — so the renderer can do its own culling without walking the whole
 * project on every frame.
 *
 * Row height is a placeholder the renderer overrides via `rowHeight` (default
 * a fixed constant): actual row sizing, and whether a track is expanded, are
 * viewport/UI concerns this projection does not model.
 */

const DEFAULT_ROW_HEIGHT = 64;

export type ArrangementClipPreview =
	| {
			readonly kind: "notes";
			readonly noteCount: number;
			readonly minPitch: number | null;
			readonly maxPitch: number | null;
			/** Notes per bar, for a density sketch when zoomed too far to draw individual notes. */
			readonly density: number;
	  }
	| {
			readonly kind: "audioLoop";
			readonly assetId: AssetId;
			readonly sourceTempo: number;
	  };

export interface ArrangementClip {
	readonly id: ClipId;
	readonly trackId: TrackId;
	readonly name: string;
	readonly color: string;
	readonly lengthTicks: Ticks;
	readonly preview: ArrangementClipPreview;
	readonly fingerprint: string;
}

export interface ArrangementPlacement {
	readonly id: PlacementId;
	readonly clipId: ClipId;
	readonly trackId: TrackId;
	readonly startTicks: Ticks;
	readonly durationTicks: Ticks;
	readonly endTicks: Ticks;
	readonly clipOffsetTicks: Ticks;
	readonly looped: boolean;
	readonly fingerprint: string;
}

export interface ArrangementTrackRow {
	readonly id: TrackId;
	readonly name: string;
	readonly color: string;
	readonly order: number;
	readonly type: Track["type"];
	/** Index into `ArrangementProjection.rows`, i.e. visible position top-to-bottom. */
	readonly rowIndex: number;
	/** Pixel offset of this row's top edge — the "prefix sum" section 9.3 asks for. */
	readonly rowTop: number;
	readonly rowHeight: number;
	readonly fingerprint: string;
}

export interface ArrangementSection {
	readonly id: SectionId;
	readonly name: string;
	readonly color: string;
	readonly startTicks: Ticks;
	readonly durationTicks: Ticks;
	readonly endTicks: Ticks;
	readonly fingerprint: string;
}

export interface ArrangementAutomationLane {
	readonly id: AutomationId;
	readonly target: AutomationTarget;
	readonly interpolation: AutomationLane["interpolation"];
	readonly points: readonly AutomationLane["points"][number][];
	readonly minValue: number;
	readonly maxValue: number;
	readonly fingerprint: string;
}

export interface ArrangementProjection {
	readonly revision: number;
	readonly tempo: number;
	/** The end of the arrangement: the furthest placement or section end. */
	readonly totalTicks: Ticks;
	readonly totalRowHeight: number;
	readonly rows: readonly ArrangementTrackRow[];
	readonly rowsById: ReadonlyMap<TrackId, ArrangementTrackRow>;
	readonly clips: readonly ArrangementClip[];
	readonly clipsById: ReadonlyMap<ClipId, ArrangementClip>;
	readonly placements: readonly ArrangementPlacement[];
	readonly placementsById: ReadonlyMap<PlacementId, ArrangementPlacement>;
	/** Every track's placements, sorted by `startTicks`, for range queries. */
	readonly placementsByTrack: ReadonlyMap<
		TrackId,
		readonly ArrangementPlacement[]
	>;
	readonly sections: readonly ArrangementSection[];
	readonly automation: readonly ArrangementAutomationLane[];
	readonly automationByTrack: ReadonlyMap<
		TrackId,
		readonly ArrangementAutomationLane[]
	>;
}

export interface BuildArrangementProjectionOptions {
	/** Pixel height for one track's row. Defaults to a fixed constant. */
	rowHeight?: (track: Track) => number;
}

function compareStrings(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

function clipPreviewShape(
	clip: Project["clips"][number],
): ArrangementClipPreview {
	if (clip.content.kind === "audioLoop") {
		return {
			kind: "audioLoop",
			assetId: clip.content.assetId,
			sourceTempo: clip.content.sourceTempo,
		};
	}
	const pitches = clip.content.events
		.filter((event) => event.trigger.kind === "pitch")
		.map((event) => (event.trigger as { kind: "pitch"; pitch: number }).pitch);
	const bars = Math.max(1, clip.lengthTicks / TICKS_PER_BAR);
	return {
		kind: "notes",
		noteCount: clip.content.events.length,
		minPitch: pitches.length > 0 ? Math.min(...pitches) : null,
		maxPitch: pitches.length > 0 ? Math.max(...pitches) : null,
		density: clip.content.events.length / bars,
	};
}

function buildClip(
	clip: Project["clips"][number],
	previous: ArrangementClip | undefined,
): ArrangementClip {
	const preview = clipPreviewShape(clip);
	const shape = {
		trackId: clip.trackId,
		name: clip.name,
		color: clip.color,
		lengthTicks: clip.lengthTicks,
		preview,
	};
	const fingerprint = fingerprintOf(shape);
	if (previous && previous.fingerprint === fingerprint) {
		return previous;
	}
	return {
		id: clip.id,
		trackId: clip.trackId,
		name: clip.name,
		color: clip.color,
		lengthTicks: clip.lengthTicks,
		preview,
		fingerprint,
	};
}

function buildPlacement(
	placement: Project["song"]["placements"][number],
	previous: ArrangementPlacement | undefined,
): ArrangementPlacement {
	const endTicks = toTicks(placement.startTicks + placement.durationTicks);
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
	return {
		id: placement.id,
		clipId: placement.clipId,
		trackId: placement.trackId,
		startTicks: placement.startTicks,
		durationTicks: placement.durationTicks,
		endTicks,
		clipOffsetTicks: placement.clipOffsetTicks,
		looped: placement.looped,
		fingerprint,
	};
}

function buildSection(
	section: Project["song"]["sections"][number],
	previous: ArrangementSection | undefined,
): ArrangementSection {
	const endTicks = toTicks(section.startTicks + section.durationTicks);
	const shape = {
		name: section.name,
		color: section.color,
		startTicks: section.startTicks,
		durationTicks: section.durationTicks,
	};
	const fingerprint = fingerprintOf(shape);
	if (previous && previous.fingerprint === fingerprint) {
		return previous;
	}
	return {
		id: section.id,
		name: section.name,
		color: section.color,
		startTicks: section.startTicks,
		durationTicks: section.durationTicks,
		endTicks,
		fingerprint,
	};
}

function buildAutomationLane(
	lane: AutomationLane,
	previous: ArrangementAutomationLane | undefined,
): ArrangementAutomationLane {
	const points = [...lane.points].sort((a, b) => a.tick - b.tick);
	const values = points.map((point) => point.value);
	const minValue = values.length > 0 ? Math.min(...values) : 0;
	const maxValue = values.length > 0 ? Math.max(...values) : 0;
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
		minValue,
		maxValue,
		fingerprint,
	};
}

function buildRow(
	track: Track,
	rowIndex: number,
	rowTop: number,
	rowHeight: number,
	previous: ArrangementTrackRow | undefined,
): ArrangementTrackRow {
	const shape = {
		name: track.name,
		color: track.color,
		order: track.order,
		type: track.type,
		rowIndex,
		rowTop,
		rowHeight,
	};
	const fingerprint = fingerprintOf(shape);
	if (previous && previous.fingerprint === fingerprint) {
		return previous;
	}
	return {
		id: track.id,
		name: track.name,
		color: track.color,
		order: track.order,
		type: track.type,
		rowIndex,
		rowTop,
		rowHeight,
		fingerprint,
	};
}

/**
 * Builds (or incrementally rebuilds) the arrangement renderer's projection.
 * Passing the previous projection as `previous` reuses every row, clip,
 * placement, section, and automation-lane entry whose relevant fields have
 * not changed, so a redraw driven by object identity does not repaint
 * geometry for anything the edit did not touch.
 */
export function buildArrangementProjection(
	project: Project,
	previous?: ArrangementProjection,
	options: BuildArrangementProjectionOptions = {},
): ArrangementProjection {
	const rowHeightOf = options.rowHeight ?? (() => DEFAULT_ROW_HEIGHT);

	const orderedTracks = [...project.song.tracks].sort(
		(a, b) => a.order - b.order || compareStrings(a.id, b.id),
	);
	let rowTop = 0;
	const rows: ArrangementTrackRow[] = [];
	for (const [rowIndex, track] of orderedTracks.entries()) {
		const rowHeight = rowHeightOf(track);
		rows.push(
			buildRow(
				track,
				rowIndex,
				rowTop,
				rowHeight,
				previous?.rowsById.get(track.id),
			),
		);
		rowTop += rowHeight;
	}
	const totalRowHeight = rowTop;

	const clips = [...project.clips]
		.sort((a, b) => compareStrings(a.id, b.id))
		.map((clip) => buildClip(clip, previous?.clipsById.get(clip.id)));

	const previousPlacements = previous
		? new Map(previous.placements.map((p) => [p.id, p]))
		: undefined;
	const placementsByTrack = new Map<TrackId, ArrangementPlacement[]>();
	const placements = [...project.song.placements]
		.sort((a, b) => a.startTicks - b.startTicks || compareStrings(a.id, b.id))
		.map((placement) => {
			const built = buildPlacement(
				placement,
				previousPlacements?.get(placement.id),
			);
			const forTrack = placementsByTrack.get(built.trackId) ?? [];
			forTrack.push(built);
			placementsByTrack.set(built.trackId, forTrack);
			return built;
		});

	const previousSections = previous
		? new Map(previous.sections.map((s) => [s.id, s]))
		: undefined;
	const sections = [...project.song.sections]
		.sort((a, b) => a.startTicks - b.startTicks || compareStrings(a.id, b.id))
		.map((section) => buildSection(section, previousSections?.get(section.id)));

	const previousAutomation = previous
		? new Map(previous.automation.map((lane) => [lane.id, lane]))
		: undefined;
	const automationByTrack = new Map<TrackId, ArrangementAutomationLane[]>();
	const automation = [...project.song.automation]
		.sort((a, b) => compareStrings(a.id, b.id))
		.map((lane) => {
			const built = buildAutomationLane(lane, previousAutomation?.get(lane.id));
			if ("trackId" in lane.target) {
				const forTrack = automationByTrack.get(lane.target.trackId) ?? [];
				forTrack.push(built);
				automationByTrack.set(lane.target.trackId, forTrack);
			}
			return built;
		});

	const totalTicks = toTicks(
		Math.max(
			0,
			...placements.map((p) => p.endTicks),
			...sections.map((s) => s.endTicks),
		),
	);

	return {
		revision: project.metadata.revision,
		tempo: project.song.tempo,
		totalTicks,
		totalRowHeight,
		rows,
		rowsById: new Map(rows.map((row) => [row.id, row])),
		clips,
		clipsById: new Map(clips.map((clip) => [clip.id, clip])),
		placements,
		placementsById: new Map(placements.map((p) => [p.id, p])),
		placementsByTrack,
		sections,
		automation,
		automationByTrack,
	};
}

/**
 * Binary search for the row whose `[rowTop, rowTop + rowHeight)` span
 * contains `offset` (e.g. a pointer Y coordinate translated into arrangement
 * space). Returns `null` above the first row or at/below the last row's
 * bottom edge. Works with variable row heights (e.g. an expanded track),
 * since it searches the rows' actual prefix sums rather than assuming a
 * uniform height.
 */
export function findRowAtOffset(
	projection: ArrangementProjection,
	offset: number,
): ArrangementTrackRow | null {
	const { rows } = projection;
	if (offset < 0 || rows.length === 0 || offset >= projection.totalRowHeight) {
		return null;
	}
	let low = 0;
	let high = rows.length - 1;
	while (low <= high) {
		const mid = (low + high) >> 1;
		const row = rows[mid];
		if (offset < row.rowTop) {
			high = mid - 1;
		} else if (offset >= row.rowTop + row.rowHeight) {
			low = mid + 1;
		} else {
			return row;
		}
	}
	return null;
}

/**
 * Placements on `trackId` whose span overlaps `[startTicks, endTicks)`. Uses
 * the track's `startTicks`-sorted array (an upper-bound binary search cuts
 * the scan to placements starting before the range ends, then a linear
 * filter keeps only those that also end after the range starts) rather than
 * scanning the whole project on every viewport change.
 */
export function queryPlacementsInRange(
	projection: ArrangementProjection,
	trackId: TrackId,
	startTicks: number,
	endTicks: number,
): readonly ArrangementPlacement[] {
	const forTrack = projection.placementsByTrack.get(trackId);
	if (!forTrack || forTrack.length === 0) {
		return [];
	}
	let low = 0;
	let high = forTrack.length;
	while (low < high) {
		const mid = (low + high) >> 1;
		if (forTrack[mid].startTicks < endTicks) {
			low = mid + 1;
		} else {
			high = mid;
		}
	}
	const candidates = forTrack.slice(0, low);
	return candidates.filter((placement) => placement.endTicks > startTicks);
}
