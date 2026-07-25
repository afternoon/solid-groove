import type { Project } from "../domain/entities";
import type { Ticks } from "../domain/time";
import type { SelectionScope, SelectionState } from "./types";

/**
 * Pure selection/focus operations (PRD sections 9.2-9.3).
 *
 * Every function here is a pure `(state, ...) => state` transition: nothing
 * touches a `Project`, except `reconcileSelection`, which only *reads* one to
 * decide which scopes still name a live entity. None of these ever mutate
 * their `Project` or `SelectionState` argument, and a call that would not
 * change anything returns the exact same `SelectionState` reference it was
 * given, so an unaffected consumer (e.g. a memoized Solid computation) can
 * skip recomputing.
 */

const EMPTY_SELECTION: SelectionState = Object.freeze({
	scopes: Object.freeze([]) as readonly SelectionScope[],
	focus: null,
});

/** The canonical empty selection. Always the same reference. */
export function emptySelection(): SelectionState {
	return EMPTY_SELECTION;
}

export function isEmptySelection(state: SelectionState): boolean {
	return state.scopes.length === 0;
}

/** A stable string key two scopes share if and only if they refer to the same thing. */
export function scopeKey(scope: SelectionScope): string {
	switch (scope.kind) {
		case "project":
		case "track":
		case "clip":
		case "placement":
		case "event":
		case "section":
		case "device":
			return `${scope.kind}:${scope.id}`;
		case "automationPoint":
			return `automationPoint:${scope.laneId}:${scope.tick}`;
		case "barRange":
			return `barRange:${scope.startTicks}:${scope.endTicks}:${[...scope.trackIds].sort().join(",")}`;
	}
}

export function scopesEqual(a: SelectionScope, b: SelectionScope): boolean {
	return scopeKey(a) === scopeKey(b);
}

function findByKey(
	scopes: readonly SelectionScope[],
	key: string,
): SelectionScope | undefined {
	return scopes.find((scope) => scopeKey(scope) === key);
}

/** Replaces the whole selection with a single scope, which becomes focus. */
export function selectOnly(scope: SelectionScope): SelectionState {
	return { scopes: [scope], focus: scope };
}

/** Clears the selection. Equivalent to {@link emptySelection}. */
export function clearSelection(): SelectionState {
	return EMPTY_SELECTION;
}

/**
 * Adds `scope` to the selection and makes it the focus. A no-op (returning
 * the same reference) if `scope` is already selected and already focused.
 */
export function addToSelection(
	state: SelectionState,
	scope: SelectionScope,
): SelectionState {
	const key = scopeKey(scope);
	const existing = findByKey(state.scopes, key);
	if (existing) {
		if (state.focus && scopeKey(state.focus) === key) {
			return state;
		}
		return { scopes: state.scopes, focus: existing };
	}
	return { scopes: [...state.scopes, scope], focus: scope };
}

/**
 * Removes `scope` from the selection. A no-op if it was not selected. If the
 * removed scope was the focus, the new focus becomes the last remaining
 * scope, or `null` if none remain.
 */
export function removeFromSelection(
	state: SelectionState,
	scope: SelectionScope,
): SelectionState {
	const key = scopeKey(scope);
	if (!findByKey(state.scopes, key)) {
		return state;
	}
	const scopes = state.scopes.filter((entry) => scopeKey(entry) !== key);
	const focus =
		state.focus && scopeKey(state.focus) === key
			? (scopes[scopes.length - 1] ?? null)
			: state.focus;
	return { scopes, focus };
}

/** Adds `scope` if absent, removes it if present. */
export function toggleInSelection(
	state: SelectionState,
	scope: SelectionScope,
): SelectionState {
	return findByKey(state.scopes, scopeKey(scope))
		? removeFromSelection(state, scope)
		: addToSelection(state, scope);
}

/**
 * Moves focus to `scope`, adding it to the selection first if it is not
 * already selected. A no-op if `scope` is already both selected and focused.
 */
export function setFocus(
	state: SelectionState,
	scope: SelectionScope,
): SelectionState {
	const key = scopeKey(scope);
	const existing = findByKey(state.scopes, key);
	if (!existing) {
		return addToSelection(state, scope);
	}
	if (state.focus && scopeKey(state.focus) === key) {
		return state;
	}
	return { scopes: state.scopes, focus: existing };
}

/** Existence sets used to reconcile a selection against a live project. */
export interface SelectionEntityIndex {
	readonly projectId: string;
	readonly trackIds: ReadonlySet<string>;
	readonly clipIds: ReadonlySet<string>;
	readonly placementIds: ReadonlySet<string>;
	readonly eventIds: ReadonlySet<string>;
	readonly sectionIds: ReadonlySet<string>;
	readonly deviceIds: ReadonlySet<string>;
	/** Ticks with a point, keyed by automation lane ID. */
	readonly automationPointTicks: ReadonlyMap<string, ReadonlySet<Ticks>>;
}

/** Builds the existence index {@link reconcileSelection} checks scopes against. */
export function buildSelectionEntityIndex(
	project: Project,
): SelectionEntityIndex {
	const trackIds = new Set<string>();
	const deviceIds = new Set<string>();
	const eventIds = new Set<string>();

	for (const track of project.song.tracks) {
		trackIds.add(track.id);
		for (const device of track.devices) {
			deviceIds.add(device.id);
		}
	}
	for (const bus of project.song.returns) {
		for (const device of bus.devices) {
			deviceIds.add(device.id);
		}
	}
	for (const device of project.song.master.devices) {
		deviceIds.add(device.id);
	}
	for (const clip of project.clips) {
		if (clip.content.kind === "notes") {
			for (const event of clip.content.events) {
				eventIds.add(event.id);
			}
		}
	}

	const automationPointTicks = new Map<string, ReadonlySet<Ticks>>();
	for (const lane of project.song.automation) {
		automationPointTicks.set(
			lane.id,
			new Set(lane.points.map((point) => point.tick)),
		);
	}

	return {
		projectId: project.metadata.id,
		trackIds,
		clipIds: new Set(project.clips.map((clip) => clip.id)),
		placementIds: new Set(project.song.placements.map((p) => p.id)),
		eventIds,
		sectionIds: new Set(project.song.sections.map((section) => section.id)),
		deviceIds,
		automationPointTicks,
	};
}

function scopeIsLive(
	scope: SelectionScope,
	index: SelectionEntityIndex,
): SelectionScope | null {
	switch (scope.kind) {
		case "project":
			return scope.id === index.projectId ? scope : null;
		case "track":
			return index.trackIds.has(scope.id) ? scope : null;
		case "clip":
			return index.clipIds.has(scope.id) ? scope : null;
		case "placement":
			return index.placementIds.has(scope.id) ? scope : null;
		case "event":
			return index.eventIds.has(scope.id) ? scope : null;
		case "section":
			return index.sectionIds.has(scope.id) ? scope : null;
		case "device":
			return index.deviceIds.has(scope.id) ? scope : null;
		case "automationPoint": {
			const ticks = index.automationPointTicks.get(scope.laneId);
			return ticks?.has(scope.tick) ? scope : null;
		}
		case "barRange": {
			if (scope.trackIds.length === 0) {
				// Applies across all tracks; no per-track existence to check.
				return scope;
			}
			const survivingTrackIds = scope.trackIds.filter((id) =>
				index.trackIds.has(id),
			);
			if (survivingTrackIds.length === 0) {
				return null;
			}
			if (survivingTrackIds.length === scope.trackIds.length) {
				return scope;
			}
			return { ...scope, trackIds: survivingTrackIds };
		}
	}
}

/**
 * Drops any scope that no longer names a live entity in `project` (a deleted
 * track, clip, placement, event, section, device, or automation point), and
 * narrows a `barRange` whose track list has shrunk. Reordering an entity
 * (track order, section order, automation point order) never invalidates a
 * selection, because every scope names its entity by stable ID, never by
 * position.
 *
 * Returns the exact same `state` reference when nothing needed to change, so
 * callers can use reference equality to skip downstream work.
 */
export function reconcileSelection(
	state: SelectionState,
	project: Project,
): SelectionState {
	if (isEmptySelection(state)) {
		return state;
	}
	const index = buildSelectionEntityIndex(project);
	let changed = false;
	const scopes: SelectionScope[] = [];
	// A surviving `barRange` gets a new key when its track list is narrowed, so
	// focus is tracked by the *original* key it was found under rather than by
	// re-deriving a key from the (possibly now-different) survivor.
	const survivorByOriginalKey = new Map<string, SelectionScope>();
	for (const scope of state.scopes) {
		const originalKey = scopeKey(scope);
		const survivor = scopeIsLive(scope, index);
		if (survivor === null) {
			changed = true;
			continue;
		}
		if (survivor !== scope) {
			changed = true;
		}
		scopes.push(survivor);
		survivorByOriginalKey.set(originalKey, survivor);
	}
	if (!changed) {
		return state;
	}
	const focus =
		state.focus === null
			? null
			: (survivorByOriginalKey.get(scopeKey(state.focus)) ??
				scopes[scopes.length - 1] ??
				null);
	return { scopes, focus };
}
