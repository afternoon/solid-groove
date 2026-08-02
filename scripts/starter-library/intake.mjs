// Intake states and quarantine isolation (docs/sample-library.md section 11).
//
// `CNT-000` recorded a single honest intake state (`metadata-review`) as a
// string on every asset. `CNT-001` makes the whole section 11 ladder real,
// because acquired content genuinely moves along it: a downloaded file is
// hashed and **quarantined** before anything looks at it, and an asset that has
// not reached metadata review must not appear in a production manifest.
//
// The rule this file exists to enforce is the one in section 11 state 3:
// quarantined material is "isolated from production manifests". Isolation is a
// build-time partition, not a validation error — a quarantined asset is not
// broken, it is simply not shippable yet, so it is reported and withheld while
// the rest of the library still builds. The same partition is what keeps a
// missing or corrupt file from taking the build down with it.

/** The section 11 ladder, in order. An asset's state is one of these. */
export const INTAKE_STATES = [
	"candidate",
	"rights-review",
	"quarantine",
	"audio-preparation",
	"metadata-review",
	"musical-review",
	"approved",
	"deprecated",
	"removed",
];

/**
 * States whose assets may appear in a published pack manifest.
 *
 * `metadata-review` is the floor: by then the asset has a pack, a role, tags,
 * and a user-facing name, which is the minimum a manifest entry needs to be
 * meaningful. `deprecated` is included because section 11 state 8 is explicit
 * that a deprecated asset stays *resolvable* for projects that already
 * reference it — it is hidden from new selection, which is a browser concern
 * (`LOOP-013`), not a delivery one.
 *
 * `removed` is excluded even though it is later in the ladder: state 9 is
 * "delivery disabled".
 */
export const DELIVERABLE_STATES = [
	"metadata-review",
	"musical-review",
	"approved",
	"deprecated",
];

/** States that mean "held back deliberately", as opposed to "not a state". */
const WITHHELD_REASONS = {
	candidate: "recorded as a candidate only; rights have not been reviewed",
	"rights-review": "rights review has not completed",
	quarantine: "downloaded and hashed but not yet isolated-checked or prepared",
	"audio-preparation": "audio preparation has not completed",
	removed: "delivery is disabled for legal or security reasons",
};

export function isKnownIntakeState(state) {
	return INTAKE_STATES.includes(state);
}

export function isDeliverable(state) {
	return DELIVERABLE_STATES.includes(state);
}

/**
 * Why an asset in this state is withheld, or `null` when it ships.
 *
 * An unknown state is withheld too, and says so: a typo in a state name must
 * never be the reason something unreviewed reaches a bucket.
 */
export function withheldReason(state) {
	if (isDeliverable(state)) return null;
	return WITHHELD_REASONS[state] ?? `unknown intake state "${state}"`;
}

/**
 * Split built assets into what ships and what is isolated.
 *
 * Takes and returns `{ asset, bytes }` records — the shape `buildAsset` and the
 * acquisition ingest both produce — so the caller does not have to know which
 * pipeline an asset came from.
 *
 * `unreadable` covers the *corrupt* half of "missing/corrupt isolation": a
 * record whose bytes could not be produced or read is quarantined with a
 * reason instead of throwing, so one bad file cannot fail the whole build.
 */
export function partitionByIntake(built) {
	const delivered = [];
	const withheld = [];
	for (const record of built) {
		const state = record.asset?.provenance?.reviewState;
		const reason = withheldReason(state);
		const unreadable = unreadableReason(record);
		if (unreadable) {
			withheld.push({
				id: record.asset?.id ?? "<asset with no id>",
				state: state ?? null,
				reason: unreadable,
			});
			continue;
		}
		if (reason) {
			withheld.push({ id: record.asset.id, state: state ?? null, reason });
			continue;
		}
		delivered.push(record);
	}
	return { delivered, withheld };
}

function unreadableReason(record) {
	if (!record.asset?.id) return "record has no asset id";
	if (!record.bytes || record.bytes.length === 0) {
		return "asset bytes are missing or empty (corrupt or failed render)";
	}
	const declared = record.asset.files?.master?.bytes;
	if (declared !== undefined && declared !== record.bytes.length) {
		return `declared ${declared} bytes but ${record.bytes.length} were produced`;
	}
	return null;
}

/** One line per withheld asset, for the build and upload reports. */
export function formatWithheldReport(withheld) {
	if (withheld.length === 0) return "quarantine: nothing withheld";
	return [
		`quarantine: ${withheld.length} asset(s) withheld from delivery`,
		...withheld.map(
			(entry) =>
				`  ${entry.id.padEnd(32)} ${entry.state ?? "?"}  ${entry.reason}`,
		),
	].join("\n");
}
