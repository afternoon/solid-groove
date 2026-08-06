import type { InstrumentTypeKey } from "../analytics/catalog";
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
 * The instrument kinds the app offers, and what moving a track between them
 * costs (#224, #223).
 *
 * Two surfaces choose an instrument kind — creating a track (`trackCreation`)
 * and changing an existing track's (`InstrumentKindPicker`) — and they were
 * written in parallel, each with its own copy of these facts. That divergence
 * was visible: a track *created* as a drum machine opened with different pads
 * from one *switched* to a drum machine. So the kind, its label, the
 * `instrument_type` it reports, and the instrument it mints are declared once,
 * here, and both surfaces read them.
 *
 * Nothing here mutates a project. `createInstrumentOfKind` builds the
 * instrument an `instrument.change` (or `track.add`) payload carries, so the
 * command layer stays the one mutation path (PRD section 9.6).
 */

export type InstrumentKind = Instrument["kind"];

export interface InstrumentKindSpec {
	readonly kind: InstrumentKind;
	/** The control's visible text. */
	readonly label: string;
	/** This kind's `instrument_type` in the OPS-02 catalog. */
	readonly analyticsType: InstrumentTypeKey;
}

/**
 * Every kind, in the order both surfaces offer them. Sampler leads because it
 * is what the starter project arrives with and what a loop is usually built
 * from.
 */
export const INSTRUMENT_KINDS: readonly InstrumentKindSpec[] = [
	{ kind: "sampler", label: "Sampler", analyticsType: "sampler" },
	{ kind: "drumMachine", label: "Drum machine", analyticsType: "drum_machine" },
	{ kind: "synth", label: "Synth", analyticsType: "synth" },
];

export function instrumentKindSpec(kind: InstrumentKind): InstrumentKindSpec {
	const spec = INSTRUMENT_KINDS.find((candidate) => candidate.kind === kind);
	if (!spec) throw new TypeError(`Unknown instrument kind "${kind}"`);
	return spec;
}

/** The `instrument_type` an existing track reports, or undefined if it has none. */
export function instrumentTypeKey(
	instrument: Instrument | null,
): InstrumentTypeKey | undefined {
	if (!instrument) return undefined;
	return INSTRUMENT_KINDS.find((spec) => spec.kind === instrument.kind)
		?.analyticsType;
}

/**
 * The lanes a new drum machine opens with: the four voices a beat is built
 * from. Each starts empty — a pad's sample is chosen in the drum panel, the
 * same way an existing kit's is (PRD INS-01). A machine with no pads at all
 * would be a dead end, since no surface exposes `drum.addPad` yet.
 */
const DEFAULT_PAD_NAMES = ["BD", "SD", "HH", "CP"] as const;

/**
 * A fresh instrument of `kind`, at its defaults. Every ID it needs is minted
 * here, so the command payload carries them explicitly and a replay, redo, or
 * assistant preview reproduces the same project.
 */
export function createInstrumentOfKind(
	context: DomainFactoryContext,
	kind: InstrumentKind,
): Instrument {
	switch (kind) {
		case "sampler":
			// No sample yet: one is loaded from the library or the sampler panel.
			return createSamplerInstrument();
		case "drumMachine":
			return createDrumMachineInstrument(
				DEFAULT_PAD_NAMES.map((name) => createDrumPad(context, { name })),
			);
		case "synth":
			return createSynthInstrument();
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
