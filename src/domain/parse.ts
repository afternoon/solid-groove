/**
 * Parsing and cross-entity integrity (PRD section 9.5).
 *
 * `parseProject` is the only way to obtain a `Project`. It validates shape,
 * schema version, and every relationship, and either returns a complete valid
 * project or a list of issues — it never mutates its input and never returns
 * partially repaired state.
 *
 * The implementation lives in `./parse/*`, split by concern so a new invariant
 * lands in its own module instead of appending to one growing file. This
 * module re-exports the same public surface the monolith used to (nothing
 * more — the per-concern helpers stay module-private the way they were
 * before), so no importer needs to change.
 */

export { checkClipInvariants } from "./parse/clip";
export {
	type DomainIssue,
	type DomainIssueCode,
	DomainValidationError,
	formatIssue,
	type ParseResult,
} from "./parse/primitives";
export {
	assertProject,
	checkProjectIntegrity,
	isProject,
	parseClip,
	parseProject,
	parseProjectMetadata,
	parseSong,
} from "./parse/project";
export {
	checkSongIntegrity,
	MAX_RETURN_BUSES,
	MAX_TRACK_INSERTS,
} from "./parse/song";
