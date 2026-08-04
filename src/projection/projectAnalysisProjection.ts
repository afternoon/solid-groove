import type {
	Clip,
	Device,
	Instrument,
	NoteEvent,
	Project,
	Track,
} from "../domain/entities";
import { TICKS_PER_BAR } from "../domain/time";
import type { SelectionState } from "../selection/types";
import { buildAssistantContext } from "./assistantContextProjection";
import { fingerprintOf } from "./fingerprint";

/**
 * Deterministic compact project analysis and suggestions (PRD AI-01, AI-02,
 * AI-05; task AI-002).
 *
 * `buildAssistantContext` (PRD 9.8) is the *shape* of the project the assistant
 * reads — tracks, sections, tempo, selection. This module is the *analysis* of
 * that shape: for the whole song and per-track it derives note, register,
 * density, and repetition facts, folds in mixer and device state, records what
 * was recently done, and turns all of that into a small set of scoped next-step
 * suggestions ("Create an arrangement", "Add variation", "Balance this
 * section"). AI-05 asks the assistant to "summarize likely repetition, density,
 * register, or balance issues using deterministic project data where possible";
 * everything here is a pure function of the project (plus the current selection
 * and a caller-supplied recent-action list) so the same project always analyzes
 * the same way.
 *
 * ## What this is not
 *
 * - It is not the full persistence document. It carries counts, ranges, and
 *   coarse ratios — never a note-by-note event dump, a Firestore document, or a
 *   provider object. It carries per-track counts and ranges rather than events,
 *   so its size tracks the track count, not the note count; the test suite
 *   proves the serialized analysis stays small even for the 40-track
 *   ten-minute reference project and barely grows when the note count doubles.
 * - It carries no account data: owner id, collaborator ids, timestamps, storage
 *   refs, asset URLs, and tokens are all excluded. Only musical structure that
 *   helps the assistant reason about the song is included.
 * - Its suggestions never gate free-form conversation (AI-02): they are a list
 *   the UI *may* offer, each with a stable id and a scope, and an empty list is
 *   a valid, expected result.
 *
 * ## Missing context is explicit
 *
 * Where the analysis genuinely cannot answer something — a project with no
 * notes has no register, a track with no clips has no density — the field is an
 * explicit `null`/empty marker with a matching `missing` entry, never a
 * fabricated zero that reads as real data. AI-01 requires the assistant to
 * "say when it lacks required context rather than inventing project state"; the
 * `missing` list is how it knows.
 */

// ---------------------------------------------------------------------------
// Note / register / density / repetition facts
// ---------------------------------------------------------------------------

/**
 * The pitched register a set of note events occupies, as MIDI pitch numbers
 * (0-127). Null when there are no *pitched* notes to measure — a drum clip
 * whose events all trigger pads has no register, and that absence is reported
 * rather than defaulted to zero.
 */
export interface RegisterSummary {
	readonly lowestPitch: number;
	readonly highestPitch: number;
	/** Mean pitch, rounded to the nearest integer for a stable fingerprint. */
	readonly meanPitch: number;
	/** Distinct pitch classes (0-11) used, e.g. how "chromatic" the part is. */
	readonly distinctPitchClasses: number;
}

export interface NoteSummary {
	readonly noteCount: number;
	/** Notes that trigger a drum pad rather than a pitch. */
	readonly padNoteCount: number;
	/** Register of the pitched notes, or null when there are none. */
	readonly register: RegisterSummary | null;
	/** Mean velocity across all notes (0-1), rounded, or null when empty. */
	readonly meanVelocity: number | null;
	/** How many notes carry an explicit probability below 1 (i.e. are humanized). */
	readonly probabilisticNoteCount: number;
}

/** A coarse, stable label for how busy a region is, in notes per bar. */
export type DensityLabel = "empty" | "sparse" | "moderate" | "busy" | "dense";

export interface DensitySummary {
	/** Notes per occupied bar, rounded to one decimal. */
	readonly notesPerBar: number;
	readonly label: DensityLabel;
}

/**
 * How much of a track is repeated material. A track that plays the same clip in
 * every placement is highly repetitive; one whose placements each reference a
 * distinct clip is not. `distinctClipCount / placementCount` is the ratio the
 * assistant reads to suggest "Add variation".
 */
export interface RepetitionSummary {
	readonly placementCount: number;
	readonly distinctClipCount: number;
	/** 1 = every placement is the same clip; near 0 = all distinct. */
	readonly repetitionRatio: number;
	/** The single most-placed clip's placement count (0 when there are none). */
	readonly mostRepeatedClipPlacements: number;
}

// ---------------------------------------------------------------------------
// Mixer / device state
// ---------------------------------------------------------------------------

export interface TrackMixerAnalysis {
	readonly volume: number;
	readonly pan: number;
	readonly muted: boolean;
	readonly soloed: boolean;
	readonly sendCount: number;
	/** Devices in the insert chain, and how many are bypassed. */
	readonly deviceCount: number;
	readonly bypassedDeviceCount: number;
}

// ---------------------------------------------------------------------------
// Per-track and whole-song analysis
// ---------------------------------------------------------------------------

export interface TrackAnalysis {
	readonly id: string;
	readonly name: string;
	readonly type: Track["type"];
	readonly instrumentKind: Instrument["kind"] | null;
	readonly clipCount: number;
	readonly notes: NoteSummary;
	readonly density: DensitySummary | null;
	readonly repetition: RepetitionSummary;
	readonly mixer: TrackMixerAnalysis;
}

export interface SongAnalysis {
	readonly trackCount: number;
	readonly sectionCount: number;
	readonly clipCount: number;
	readonly placementCount: number;
	readonly automationLaneCount: number;
	readonly totalBars: number;
	readonly notes: NoteSummary;
	readonly density: DensitySummary | null;
	/** How many tracks are muted / soloed right now — a balance signal. */
	readonly mutedTrackCount: number;
	readonly soloedTrackCount: number;
}

// ---------------------------------------------------------------------------
// Recent actions
// ---------------------------------------------------------------------------

/**
 * One recent edit, in the compact form the analysis carries it. The caller
 * (the assistant session) passes recent command-history entries; the analysis
 * keeps only the actor and the one-line summary a history entry already
 * exposes, never the command payloads or affected IDs. Newest first.
 */
export interface RecentAction {
	readonly actor: "user" | "assistant" | "system";
	readonly summary: string;
}

/** The most recent actions the analysis will retain, newest-first. */
export const MAX_RECENT_ACTIONS = 8;

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------

/**
 * Stable suggestion identifiers. These are a published set (they key
 * `assistant_suggestion_clicked`'s `suggestion_id` and drive AI-004's UI), so
 * adding one is a deliberate change, and the analysis only ever emits an id
 * from this list. AI-02's named examples map directly onto them.
 */
export const SUGGESTION_IDS = [
	"create_arrangement",
	"add_variation",
	"build_transition",
	"balance_section",
	"add_track",
	"fill_empty_track",
] as const;
export type SuggestionId = (typeof SUGGESTION_IDS)[number];

/** The scope a suggestion applies to, so the UI can show what it will affect. */
export type SuggestionScope = "song" | "section" | "track" | "clip";

export interface Suggestion {
	readonly id: SuggestionId;
	readonly scope: SuggestionScope;
	/** A short, plain label — never taste presented as fact (AI-04). */
	readonly label: string;
	/** The deterministic project fact this suggestion is grounded in. */
	readonly rationale: string;
}

/** The most suggestions the analysis offers at once — kept small (AI-02). */
export const MAX_SUGGESTIONS = 4;

// ---------------------------------------------------------------------------
// Missing context
// ---------------------------------------------------------------------------

/**
 * Something the assistant would need but the project does not currently provide,
 * so the assistant can say it plainly instead of inventing it (AI-01). Each
 * entry is a stable machine key plus a human sentence.
 */
export interface MissingContext {
	readonly key:
		| "no_tracks"
		| "no_sections"
		| "no_clips"
		| "no_notes"
		| "no_pitched_notes";
	readonly detail: string;
}

// ---------------------------------------------------------------------------
// The analysis result
// ---------------------------------------------------------------------------

export interface ProjectAnalysis {
	readonly projectId: string;
	readonly projectName: string;
	readonly tempo: number;
	readonly song: SongAnalysis;
	readonly tracks: readonly TrackAnalysis[];
	/** A short human description of the current selection, or null. */
	readonly selection: string | null;
	readonly recentActions: readonly RecentAction[];
	readonly suggestions: readonly Suggestion[];
	readonly missing: readonly MissingContext[];
	readonly fingerprint: string;
}

export interface ProjectAnalysisOptions {
	readonly selection?: SelectionState;
	/** Recent command-history entries, newest first; trimmed to the last few. */
	readonly recentActions?: readonly RecentAction[];
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function round(value: number, decimals = 0): number {
	const factor = 10 ** decimals;
	return Math.round(value * factor) / factor;
}

function densityLabel(notesPerBar: number): DensityLabel {
	if (notesPerBar <= 0) return "empty";
	if (notesPerBar < 2) return "sparse";
	if (notesPerBar < 6) return "moderate";
	if (notesPerBar < 12) return "busy";
	return "dense";
}

function noteEventsOf(clip: Clip): readonly NoteEvent[] {
	return clip.content.kind === "notes" ? clip.content.events : [];
}

function summarizeNotes(events: readonly NoteEvent[]): NoteSummary {
	if (events.length === 0) {
		return {
			noteCount: 0,
			padNoteCount: 0,
			register: null,
			meanVelocity: null,
			probabilisticNoteCount: 0,
		};
	}

	const pitches: number[] = [];
	const pitchClasses = new Set<number>();
	let padNoteCount = 0;
	let velocitySum = 0;
	let probabilisticNoteCount = 0;

	for (const event of events) {
		velocitySum += event.velocity;
		if (event.probability !== null && event.probability < 1) {
			probabilisticNoteCount += 1;
		}
		if (event.trigger.kind === "pitch") {
			pitches.push(event.trigger.pitch);
			pitchClasses.add(event.trigger.pitch % 12);
		} else {
			padNoteCount += 1;
		}
	}

	const register: RegisterSummary | null =
		pitches.length === 0
			? null
			: {
					lowestPitch: Math.min(...pitches),
					highestPitch: Math.max(...pitches),
					meanPitch: Math.round(
						pitches.reduce((sum, p) => sum + p, 0) / pitches.length,
					),
					distinctPitchClasses: pitchClasses.size,
				};

	return {
		noteCount: events.length,
		padNoteCount,
		register,
		meanVelocity: round(velocitySum / events.length, 2),
		probabilisticNoteCount,
	};
}

/**
 * Density measured over the *occupied* span, not the whole song: a track with
 * one busy bar at the start of a ten-minute arrangement is dense, not empty.
 * Occupied bars are derived from placement spans so an unplaced clip does not
 * dilute the figure. Null when there is nothing placed to measure.
 */
function summarizeDensity(
	noteCount: number,
	occupiedTicks: number,
): DensitySummary | null {
	if (occupiedTicks <= 0) {
		return null;
	}
	const occupiedBars = occupiedTicks / TICKS_PER_BAR;
	const notesPerBar = occupiedBars > 0 ? round(noteCount / occupiedBars, 1) : 0;
	return { notesPerBar, label: densityLabel(notesPerBar) };
}

function summarizeRepetition(
	placements: readonly { clipId: string }[],
): RepetitionSummary {
	const placementCount = placements.length;
	if (placementCount === 0) {
		return {
			placementCount: 0,
			distinctClipCount: 0,
			repetitionRatio: 0,
			mostRepeatedClipPlacements: 0,
		};
	}
	const perClip = new Map<string, number>();
	for (const placement of placements) {
		perClip.set(placement.clipId, (perClip.get(placement.clipId) ?? 0) + 1);
	}
	const distinctClipCount = perClip.size;
	const mostRepeatedClipPlacements = Math.max(...perClip.values());
	// 1 when every placement is the same clip; approaches 0 as they diverge.
	const repetitionRatio = round(
		(placementCount - distinctClipCount) / Math.max(1, placementCount - 1),
		2,
	);
	return {
		placementCount,
		distinctClipCount,
		repetitionRatio,
		mostRepeatedClipPlacements,
	};
}

function bypassedDeviceCount(devices: readonly Device[]): number {
	return devices.filter((device) => device.bypassed).length;
}

function analyzeTrack(track: Track, project: Project): TrackAnalysis {
	const trackClips = project.clips.filter((clip) => clip.trackId === track.id);
	const trackPlacements = project.song.placements.filter(
		(placement) => placement.trackId === track.id,
	);

	const allEvents = trackClips.flatMap(noteEventsOf);
	const occupiedTicks = trackPlacements.reduce(
		(sum, placement) => sum + placement.durationTicks,
		0,
	);

	return {
		id: track.id,
		name: track.name,
		type: track.type,
		instrumentKind: track.instrument?.kind ?? null,
		clipCount: trackClips.length,
		notes: summarizeNotes(allEvents),
		density: summarizeDensity(allEvents.length, occupiedTicks),
		repetition: summarizeRepetition(trackPlacements),
		mixer: {
			volume: track.mixer.volume,
			pan: track.mixer.pan,
			muted: track.mixer.muted,
			soloed: track.mixer.soloed,
			sendCount: track.sendConfig.length,
			deviceCount: track.devices.length,
			bypassedDeviceCount: bypassedDeviceCount(track.devices),
		},
	};
}

function analyzeSong(
	project: Project,
	tracks: readonly TrackAnalysis[],
): SongAnalysis {
	const allEvents = project.clips.flatMap(noteEventsOf);
	const totalTicks = Math.max(
		0,
		...project.song.placements.map((p) => p.startTicks + p.durationTicks),
		...project.song.sections.map((s) => s.startTicks + s.durationTicks),
	);
	const occupiedTicks = project.song.placements.reduce(
		(sum, placement) => sum + placement.durationTicks,
		0,
	);

	return {
		trackCount: project.song.tracks.length,
		sectionCount: project.song.sections.length,
		clipCount: project.clips.length,
		placementCount: project.song.placements.length,
		automationLaneCount: project.song.automation.length,
		totalBars: round(totalTicks / TICKS_PER_BAR, 1),
		notes: summarizeNotes(allEvents),
		density: summarizeDensity(allEvents.length, occupiedTicks),
		mutedTrackCount: tracks.filter((t) => t.mixer.muted).length,
		soloedTrackCount: tracks.filter((t) => t.mixer.soloed).length,
	};
}

function collectMissing(
	song: SongAnalysis,
	tracks: readonly TrackAnalysis[],
): MissingContext[] {
	const missing: MissingContext[] = [];
	if (song.trackCount === 0) {
		missing.push({
			key: "no_tracks",
			detail: "The project has no tracks yet.",
		});
	}
	if (song.sectionCount === 0) {
		missing.push({
			key: "no_sections",
			detail: "The arrangement has no sections yet.",
		});
	}
	if (song.trackCount > 0 && song.clipCount === 0) {
		missing.push({
			key: "no_clips",
			detail: "No clips have been written yet.",
		});
	}
	if (song.clipCount > 0 && song.notes.noteCount === 0) {
		missing.push({
			key: "no_notes",
			detail: "The clips contain no note events.",
		});
	}
	// Pitched register is unknowable when every note is a drum-pad trigger.
	if (
		song.notes.noteCount > 0 &&
		song.notes.register === null &&
		tracks.every((track) => track.notes.register === null)
	) {
		missing.push({
			key: "no_pitched_notes",
			detail:
				"Every note triggers a drum pad, so there is no pitched register.",
		});
	}
	return missing;
}

/**
 * Derives up to {@link MAX_SUGGESTIONS} scoped next-step suggestions from
 * deterministic project facts (AI-02). Order is fixed and de-duplicated, so the
 * same project always yields the same suggestion list. Every suggestion cites
 * the fact that produced it, so the UI can show *why* it is offered.
 */
function deriveSuggestions(
	song: SongAnalysis,
	tracks: readonly TrackAnalysis[],
): Suggestion[] {
	const suggestions: Suggestion[] = [];

	// An empty project's first useful step is a track, then a part in it.
	if (song.trackCount === 0) {
		suggestions.push({
			id: "add_track",
			scope: "song",
			label: "Add a track",
			rationale: "The project has no tracks.",
		});
		return suggestions;
	}

	// A track with an instrument but no clips is waiting for a part.
	const emptyTrack = tracks.find(
		(track) => track.clipCount === 0 && track.type === "instrument",
	);
	if (emptyTrack) {
		suggestions.push({
			id: "fill_empty_track",
			scope: "track",
			label: "Sketch a part for the empty track",
			rationale: `Track "${emptyTrack.name}" has an instrument but no clips.`,
		});
	}

	// Material but no sections: an arrangement is the natural next move.
	if (song.clipCount > 0 && song.sectionCount === 0) {
		suggestions.push({
			id: "create_arrangement",
			scope: "song",
			label: "Create an arrangement",
			rationale: "There is written material but no section structure yet.",
		});
	}

	// A highly repetitive track can use variation.
	const repetitiveTrack = tracks.find(
		(track) =>
			track.repetition.placementCount >= 4 &&
			track.repetition.repetitionRatio >= 0.75,
	);
	if (repetitiveTrack) {
		suggestions.push({
			id: "add_variation",
			scope: "track",
			label: "Add variation",
			rationale: `Track "${repetitiveTrack.name}" repeats one clip across ${repetitiveTrack.repetition.placementCount} placements.`,
		});
	}

	// Multiple sections invite a transition between them.
	if (song.sectionCount >= 2) {
		suggestions.push({
			id: "build_transition",
			scope: "section",
			label: "Build a transition",
			rationale: `The arrangement has ${song.sectionCount} sections.`,
		});
	}

	// Muting/soloing in play is a balance signal.
	if (song.mutedTrackCount > 0 || song.soloedTrackCount > 0) {
		suggestions.push({
			id: "balance_section",
			scope: "song",
			label: "Balance this section",
			rationale:
				song.soloedTrackCount > 0
					? `${song.soloedTrackCount} track(s) are soloed.`
					: `${song.mutedTrackCount} track(s) are muted.`,
		});
	}

	return suggestions.slice(0, MAX_SUGGESTIONS);
}

/**
 * Builds the deterministic project analysis. Pure over its inputs: the same
 * project, selection, and recent-action list always produce an equal result
 * (an equal `fingerprint`), and the source project is never mutated.
 */
export function buildProjectAnalysis(
	project: Project,
	options: ProjectAnalysisOptions = {},
): ProjectAnalysis {
	const orderedTracks = [...project.song.tracks].sort(
		(a, b) => a.order - b.order,
	);
	const tracks = orderedTracks.map((track) => analyzeTrack(track, project));
	const song = analyzeSong(project, tracks);
	const missing = collectMissing(song, tracks);
	const suggestions = deriveSuggestions(song, tracks);

	// The compact selection description reuses the 9.8 context builder, so the
	// two never describe the same selection two different ways.
	const selection = options.selection
		? (buildAssistantContext(project, options.selection).selection
				?.description ?? null)
		: null;

	const recentActions = (options.recentActions ?? []).slice(
		0,
		MAX_RECENT_ACTIONS,
	);

	// The fingerprint excludes projectId (identity, not content) so two builds of
	// the same musical content agree; recent actions and selection are content
	// the assistant reasons about, so they are included.
	const shape = {
		projectName: project.metadata.name,
		tempo: project.song.tempo,
		song,
		tracks,
		selection,
		recentActions,
		suggestions,
		missing,
	};

	return {
		projectId: project.metadata.id,
		projectName: project.metadata.name,
		tempo: project.song.tempo,
		song,
		tracks,
		selection,
		recentActions,
		suggestions,
		missing,
		fingerprint: fingerprintOf(shape),
	};
}
