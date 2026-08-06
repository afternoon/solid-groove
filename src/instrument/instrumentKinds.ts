import type { Instrument, Project } from "../domain/entities";
import {
	createDrumMachineInstrument,
	createDrumPad,
	createSamplerInstrument,
	createSynthInstrument,
	type DomainFactoryContext,
} from "../domain/factories";
import type { ClipId, EventId, TrackId } from "../domain/ids";

/**
 * The pure half of changing a track's instrument (#224).
 *
 * A track's instrument is replaced by the existing `instrument.change` command,
 * which takes the whole replacement instrument in its payload — so the choice
 * of *what* to install, and what a switch costs the track's clips, is decided
 * here rather than in the command layer. Both answers are plain functions of
 * the project, so `InstrumentKindPicker` stays a thin dispatch surface.
 */

export type InstrumentKind = Instrument["kind"];

export interface InstrumentKindChoice {
	readonly kind: InstrumentKind;
	readonly label: string;
}

/** The instrument kinds a track can be switched to, in panel order. */
export const INSTRUMENT_KIND_CHOICES: readonly InstrumentKindChoice[] = [
	{ kind: "sampler", label: "Sampler" },
	{ kind: "synth", label: "Synth" },
	{ kind: "drumMachine", label: "Drum machine" },
];

/**
 * The pads a track gets when it becomes a drum machine. A machine with no pads
 * has nothing to load a sample into and no lane to program — and no UI adds a
 * pad yet (`drum.addPad` exists, `DrumMachinePanel` does not expose it) — so a
 * switch that produced an empty machine would be a dead end. Four named,
 * sample-less pads give the user somewhere to drop sounds immediately.
 */
export const DEFAULT_DRUM_PAD_NAMES: readonly string[] = [
	"Kick",
	"Snare",
	"Hat",
	"Clap",
];

/** The OPS-02 `instrument_type` (and `feature_first_use`) key for a kind. */
export function instrumentTypeKey(
	kind: InstrumentKind,
): "sampler" | "synth" | "drum_machine" {
	switch (kind) {
		case "sampler":
			return "sampler";
		case "synth":
			return "synth";
		case "drumMachine":
			return "drum_machine";
	}
}

/**
 * A fresh instrument of `kind`, at its defaults: an empty sampler, a synth, or
 * a drum machine with {@link DEFAULT_DRUM_PAD_NAMES}. Every ID it needs is
 * minted here, so the command payload carries them explicitly and a replay,
 * redo, or assistant preview reproduces the same project.
 */
export function createInstrumentOfKind(
	kind: InstrumentKind,
	context: DomainFactoryContext,
): Instrument {
	switch (kind) {
		case "sampler":
			return createSamplerInstrument(null);
		case "synth":
			return createSynthInstrument();
		case "drumMachine":
			return createDrumMachineInstrument(
				DEFAULT_DRUM_PAD_NAMES.map((name) => createDrumPad(context, { name })),
			);
	}
}

/** Notes in one clip that trigger a pad rather than a pitch. */
export interface PadTriggeredHits {
	readonly clipId: ClipId;
	readonly eventIds: readonly EventId[];
}

/**
 * Every pad-triggered note in a track's clips.
 *
 * A note may only name a pad its own track owns (the domain's pad-trigger
 * invariant), so leaving a drum machine strands exactly these notes: the
 * transaction would be rejected whole and the switch would silently do
 * nothing. They are what the picker warns about and removes in the same
 * transaction, so undo restores the hits and the machine together.
 */
export function padTriggeredHits(
	project: Project | null,
	trackId: TrackId,
): readonly PadTriggeredHits[] {
	if (!project) return [];
	return project.clips.flatMap((clip) => {
		if (clip.trackId !== trackId || clip.content.kind !== "notes") return [];
		const eventIds = clip.content.events
			.filter((event) => event.trigger.kind === "pad")
			.map((event) => event.id);
		return eventIds.length > 0 ? [{ clipId: clip.id, eventIds }] : [];
	});
}

/** How many notes {@link padTriggeredHits} found, across every clip. */
export function countPadTriggeredHits(
	hits: readonly PadTriggeredHits[],
): number {
	return hits.reduce((total, hit) => total + hit.eventIds.length, 0);
}
