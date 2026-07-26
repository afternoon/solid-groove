// Marks a session as internal (team) traffic so it can be excluded from the
// PRD section 11 success measures -- see PRD `OPS-01` ("Team traffic is
// marked so internal sessions can be excluded") and `OPS-02`'s
// non-identifying `internal` user property.
//
// This module owns *detection and persistence* of the flag. `FND-001c` reads
// `isInternalTraffic()` to set the GA4 user property; nothing here talks to
// an analytics SDK.
//
// Mechanism: visiting the app with `?internal=1` (or `?internal=true`) once
// persists the flag in `localStorage` for that browser, so it survives
// navigation and future sessions without the query param needing to be
// present every time. `?internal=0` (or `?internal=false`) clears it, so a
// team member testing the anonymous/cohort experience can turn it back off.

export const INTERNAL_TRAFFIC_STORAGE_KEY = "sg_internal_traffic";

const TRUE_VALUES = new Set(["1", "true"]);
const FALSE_VALUES = new Set(["0", "false"]);

/**
 * Pure parse of a `?internal=` query value into a tri-state: `true`/`false`
 * to set the flag, or `undefined` if the URL made no claim about it (the
 * param was absent or held an unrecognized value).
 */
export function parseInternalTrafficParam(
	value: string | null,
): boolean | undefined {
	if (value === null) return undefined;
	const normalized = value.trim().toLowerCase();
	if (TRUE_VALUES.has(normalized)) return true;
	if (FALSE_VALUES.has(normalized)) return false;
	return undefined;
}

/** Reads the persisted flag. Fails closed (not internal) if storage throws. */
export function isInternalTraffic(storage: Storage = localStorage): boolean {
	try {
		return storage.getItem(INTERNAL_TRAFFIC_STORAGE_KEY) === "true";
	} catch {
		return false;
	}
}

function setInternalTraffic(value: boolean, storage: Storage): void {
	try {
		if (value) {
			storage.setItem(INTERNAL_TRAFFIC_STORAGE_KEY, "true");
		} else {
			storage.removeItem(INTERNAL_TRAFFIC_STORAGE_KEY);
		}
	} catch {
		// Storage can throw (private browsing, quota, disabled). Marking traffic
		// is a measurement nicety, never something that should surface an error
		// or block the app from loading.
	}
}

/**
 * Call once per app load. Reads `?internal=` off the given location, updates
 * persisted storage if the URL made a claim, and returns the resulting flag
 * state either way.
 */
export function syncInternalTraffic(
	location: Pick<Location, "search"> = window.location,
	storage: Storage = localStorage,
): boolean {
	const params = new URLSearchParams(location.search);
	const claim = parseInternalTrafficParam(params.get("internal"));
	if (claim !== undefined) {
		setInternalTraffic(claim, storage);
		return claim;
	}
	return isInternalTraffic(storage);
}
