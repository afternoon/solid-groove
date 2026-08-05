import type {
	Asset,
	Clip,
	Instrument,
	Project,
	Track,
} from "../domain/entities";
import type { TrackId } from "../domain/ids";
import { formatBarsBeatsSixteenths } from "../domain/time";
import type { SampleChoice } from "../instrument/SamplerPanel";

/**
 * Pure, framework-free derivations behind `EditorView`.
 *
 * `EditorView` is a composition root: it owns the session, the audio wiring,
 * and the layout, and every one of these is a plain function of the open
 * `Project` (plus, where noted, one piece of session or transport state). They
 * live here rather than as inline `createMemo` bodies so each can be unit
 * tested without rendering the editor; the component keeps a one-line memo
 * wrapper around each so reactivity is unchanged.
 *
 * Nothing here mutates a project — the operations that do (`applyTempo`,
 * `auditionInstrument`, `deleteSelection`) need the session's `dispatch` and
 * the audio graph, so they stay in the component.
 */

/** One tempo-labelled loop clip paired with the asset it resolves to. */
export interface LoopClipEntry {
	readonly clip: Clip;
	readonly asset: Asset | null;
}

/**
 * The packs this editing session has added on top of the ones the project
 * already depends on.
 *
 * `metadata.packDependencies` is *derived* from the assets a project uses
 * (`derivePackDependencies`), so it answers "which packs does this project
 * need to open?" — not "which packs has the user put on their shelf?". The
 * second is a new piece of project state and a new command, which is a domain
 * contract change and its own task (see the LOOP-013 follow-up); until that
 * lands, an added pack lives for the session, which is enough for the browser
 * to show it and for the user to work out of it.
 */
export function addedPackIds(
	project: Project | null,
	sessionPackIds: readonly string[],
): readonly string[] {
	const fromProject = (project?.metadata.packDependencies ?? []).map(
		(dependency) => dependency.packId,
	);
	return [...new Set([...fromProject, ...sessionPackIds])];
}

/**
 * The transport position as a musician reads it. Shows a 1-based bar:beat,
 * dropping the sixteenth fraction.
 */
export function playheadLabel(positionTicks: number): string {
	const bbs = formatBarsBeatsSixteenths(positionTicks);
	const [bars, beats] = bbs.split(":");
	return `${Number(bars) + 1}.${Number(beats) + 1}`;
}

/** The track this slice edits: the project's first. */
export function editedTrack(project: Project | null): Track | null {
	return project?.song.tracks[0] ?? null;
}

/**
 * The first drum-machine track, if any, gets its instrument panel. The
 * `FND-009` starter is sampler-only; this surfaces the `LOOP-005` drum
 * machine wherever a project has one (e.g. the drum-machine fixture).
 */
export function drumTrack(project: Project | null): Track | null {
	return (
		project?.song.tracks.find(
			(candidate) => candidate.instrument?.kind === "drumMachine",
		) ?? null
	);
}

/** Every `sample`-kind asset the project carries. */
export function sampleAssets(project: Project | null): readonly Asset[] {
	return (project?.song.assets ?? []).filter(
		(asset) => asset.kind === "sample",
	);
}

/** The clip on the edited track, if it has one. */
export function editedClip(project: Project | null): Clip | null {
	const track = editedTrack(project);
	if (!project || !track) return null;
	return project.clips.find((c) => c.trackId === track.id) ?? null;
}

/** The instrument of the slice's first track, and the audition note it plays. */
export function editedInstrument(project: Project | null): Instrument | null {
	return editedTrack(project)?.instrument ?? null;
}

/**
 * Every tempo-labelled loop clip in the project, paired with its resolved
 * asset (or null when the asset is missing) — LOOP-006 renders one loop-info
 * panel per loop so a user can tell a tempo-following loop from a pitched
 * one-shot and read the alpha's stretch behaviour honestly.
 */
export function loopClips(project: Project | null): readonly LoopClipEntry[] {
	if (!project) return [];
	return project.clips.flatMap((c) => {
		if (c.content.kind !== "audioLoop") return [];
		const assetId = c.content.assetId;
		const asset = project.song.assets.find((a) => a.id === assetId) ?? null;
		return [{ clip: c, asset }];
	});
}

/** The name of the sample the edited track's sampler is loaded with. */
export function sampleName(project: Project | null): string | null {
	const current = editedInstrument(project);
	if (current?.kind !== "sampler" || !current.assetId) return null;
	return (
		project?.song.assets.find((asset) => asset.id === current.assetId)?.name ??
		null
	);
}

/**
 * Samples the sampler panel can swap to: every `sample`-kind asset the
 * project already carries. A richer, genre-filtered browser lands with
 * LOOP-013; here it is a straight list of the project's own samples.
 */
export function replacementOptions(
	project: Project | null,
): readonly SampleChoice[] {
	return sampleAssets(project).map((asset) => ({
		assetId: asset.id,
		name: asset.name,
	}));
}

/** The project's first pack dependency, labelled for display. */
export function packDependencyLabel(project: Project | null): string | null {
	const dependency = project?.metadata.packDependencies[0];
	return dependency ? `${dependency.packId} @ ${dependency.version}` : null;
}

/**
 * A synth track holding a note clip gets the CLP-03 piano roll instead of the
 * FND-009 step grid: pitched notes want two dimensions (pitch x time), which
 * the 16-step grid cannot show.
 */
export function showPianoRoll(project: Project | null): boolean {
	const clip = editedClip(project);
	return (
		editedInstrument(project)?.kind === "synth" &&
		clip?.content.kind === "notes"
	);
}

/**
 * The track id, only when it carries an instrument this slice renders a panel
 * for (sampler or synth). The drum machine's panel lands with LOOP-005.
 */
export function instrumentPanelTrackId(
	project: Project | null,
): TrackId | null {
	const kind = editedInstrument(project)?.kind;
	return kind === "sampler" || kind === "synth"
		? (editedTrack(project)?.id ?? null)
		: null;
}
