import type { Instrument, Project, Track } from "../domain/entities";
import type { SelectionScope, SelectionState } from "../selection/types";
import { fingerprintOf } from "./fingerprint";

/**
 * The assistant's project context (PRD section 9.8).
 *
 * "Project analysis produces a compact, serializable context rather than
 * sending the full persistence document by default." This is that compact
 * context: track/section summaries and counts, never a full note-by-note
 * clip dump, a Firestore document, or provider-specific objects. The current
 * selection is folded in as a short human-readable description (never as the
 * `SelectionScope` values verbatim), because a conversation turn or a
 * selection change is, per the same PRD section, something the assistant
 * reads about the user's intent, not a project mutation of its own.
 */

export interface AssistantTrackSummary {
	readonly id: string;
	readonly name: string;
	readonly type: Track["type"];
	readonly instrumentKind: Instrument["kind"] | null;
	readonly deviceCount: number;
	readonly muted: boolean;
	readonly soloed: boolean;
	readonly clipCount: number;
	readonly placementCount: number;
}

export interface AssistantSectionSummary {
	readonly id: string;
	readonly name: string;
	readonly startTicks: number;
	readonly durationTicks: number;
}

export interface AssistantSelectionSummary {
	/** A short human-readable description, e.g. "2 tracks and 1 placement selected". */
	readonly description: string;
	readonly countByKind: Readonly<
		Partial<Record<SelectionScope["kind"], number>>
	>;
}

export interface AssistantContext {
	readonly projectId: string;
	readonly projectName: string;
	readonly tempo: number;
	readonly timeSignature: Readonly<{ numerator: number; denominator: number }>;
	readonly totalTicks: number;
	readonly tracks: readonly AssistantTrackSummary[];
	readonly sections: readonly AssistantSectionSummary[];
	readonly selection: AssistantSelectionSummary | null;
	readonly fingerprint: string;
}

function summarizeTrack(track: Track, project: Project): AssistantTrackSummary {
	return {
		id: track.id,
		name: track.name,
		type: track.type,
		instrumentKind: track.instrument?.kind ?? null,
		deviceCount: track.devices.length,
		muted: track.mixer.muted,
		soloed: track.mixer.soloed,
		clipCount: project.clips.filter((clip) => clip.trackId === track.id).length,
		placementCount: project.song.placements.filter(
			(placement) => placement.trackId === track.id,
		).length,
	};
}

const SCOPE_KIND_LABELS: Record<
	SelectionScope["kind"],
	{ one: string; many: string }
> = {
	project: { one: "project", many: "projects" },
	track: { one: "track", many: "tracks" },
	clip: { one: "clip", many: "clips" },
	placement: { one: "placement", many: "placements" },
	event: { one: "note", many: "notes" },
	section: { one: "section", many: "sections" },
	device: { one: "device", many: "devices" },
	automationPoint: { one: "automation point", many: "automation points" },
	barRange: { one: "bar range", many: "bar ranges" },
};

/** A compact, human-readable summary of a selection: never the raw scopes. */
export function summarizeSelection(
	selection: SelectionState,
): AssistantSelectionSummary | null {
	if (selection.scopes.length === 0) {
		return null;
	}
	const countByKind: Partial<Record<SelectionScope["kind"], number>> = {};
	for (const scope of selection.scopes) {
		countByKind[scope.kind] = (countByKind[scope.kind] ?? 0) + 1;
	}
	const parts = (
		Object.entries(countByKind) as [SelectionScope["kind"], number][]
	)
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.map(([kind, count]) => {
			const label = SCOPE_KIND_LABELS[kind];
			return `${count} ${count === 1 ? label.one : label.many}`;
		});
	const description = `${parts.join(", ")} selected`;
	return { description, countByKind };
}

/**
 * Builds the assistant's project context. Pass the current `SelectionState`
 * to fold in a compact description of what the user has selected.
 */
export function buildAssistantContext(
	project: Project,
	selection?: SelectionState,
): AssistantContext {
	const orderedTracks = [...project.song.tracks].sort(
		(a, b) => a.order - b.order,
	);
	const tracks = orderedTracks.map((track) => summarizeTrack(track, project));
	const sections = [...project.song.sections]
		.sort((a, b) => a.startTicks - b.startTicks)
		.map((section) => ({
			id: section.id,
			name: section.name,
			startTicks: section.startTicks,
			durationTicks: section.durationTicks,
		}));
	const totalTicks = Math.max(
		0,
		...project.song.placements.map((p) => p.startTicks + p.durationTicks),
		...project.song.sections.map((s) => s.startTicks + s.durationTicks),
	);
	const selectionSummary = selection ? summarizeSelection(selection) : null;

	const shape = {
		projectName: project.metadata.name,
		tempo: project.song.tempo,
		timeSignature: project.song.timeSignature,
		totalTicks,
		tracks,
		sections,
		selection: selectionSummary,
	};

	return {
		projectId: project.metadata.id,
		projectName: project.metadata.name,
		tempo: project.song.tempo,
		timeSignature: project.song.timeSignature,
		totalTicks,
		tracks,
		sections,
		selection: selectionSummary,
		fingerprint: fingerprintOf(shape),
	};
}
