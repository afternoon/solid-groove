import type { InstrumentTypeKey } from "../analytics/catalog";
import type { Clip, Instrument, Placement, Track } from "../domain/entities";
import {
	createDrumMachineInstrument,
	createDrumPad,
	createNoteClip,
	createPlacement,
	createSamplerInstrument,
	createSynthInstrument,
	createTrack,
	type DomainFactoryContext,
} from "../domain/factories";
import { TICKS_PER_BAR } from "../domain/time";

/**
 * What creating a track produces, and the kinds it can be created as (#223).
 *
 * Track creation used to mint a synth and nothing else, so a sampler or a drum
 * machine could only ever arrive with the starter project or a fixture. The
 * kinds live in one table here — framework-free and testable without rendering
 * the mixer — so the affordance that offers them, the instrument each mints,
 * and the analytics value each reports cannot drift apart.
 *
 * Nothing here mutates a project: it builds the entities a `track.add` command
 * carries, so the mixer's dispatch stays the one mutation path (PRD 9.6).
 */

/** The instrument kinds a new track can be created with. */
export type NewTrackKind = "sampler" | "drumMachine" | "synth";

export interface NewTrackKindSpec {
	readonly kind: NewTrackKind;
	/** The button's visible text. */
	readonly label: string;
	/**
	 * The button's accessible name. It contains {@link label} so the visible
	 * text is a prefix of what a speech-input user has to say (WCAG 2.5.3).
	 */
	readonly actionLabel: string;
	/** `track_added`'s `instrument_type` for a track of this kind (PRD OPS-02). */
	readonly analyticsType: InstrumentTypeKey;
}

/**
 * The kinds offered, in the order they are offered. Sampler leads because it is
 * what the starter project arrives with and what a loop is usually built from.
 */
export const NEW_TRACK_KINDS: readonly NewTrackKindSpec[] = [
	{
		kind: "sampler",
		label: "Sampler",
		actionLabel: "Add sampler track",
		analyticsType: "sampler",
	},
	{
		kind: "drumMachine",
		label: "Drum machine",
		actionLabel: "Add drum machine track",
		analyticsType: "drum_machine",
	},
	{
		kind: "synth",
		label: "Synth",
		actionLabel: "Add synth track",
		analyticsType: "synth",
	},
];

/**
 * The lanes a new drum machine opens with: the four voices a beat is built
 * from. Each starts empty — a pad's sample is chosen in the drum panel, the
 * same way an existing kit's is (PRD INS-01).
 */
const DEFAULT_PAD_NAMES = ["BD", "SD", "HH", "CP"] as const;

export interface NewTrack {
	readonly track: Track;
	/** An empty one-bar note clip, so the track can be programmed immediately. */
	readonly clip: Clip;
	/** That clip, placed at bar 1. */
	readonly placement: Placement;
}

export interface NewTrackOptions {
	readonly kind: NewTrackKind;
	/** The new track's position: the number of tracks the song already has. */
	readonly order: number;
	/** Names already taken, so the new one is distinguishable in the mixer. */
	readonly existingNames: readonly string[];
}

/**
 * Builds a track of `kind`, together with the empty one-bar clip and placement
 * that make it playable and programmable the moment it appears. A track with no
 * clip has nothing to edit, so creating one without a clip would trade "you
 * cannot create a sampler" for "you can, and there is nothing to do with it".
 */
export function createNewTrack(
	context: DomainFactoryContext,
	options: NewTrackOptions,
): NewTrack {
	const spec = newTrackKindSpec(options.kind);
	const name = uniqueTrackName(spec.label, options.existingNames);

	const track = createTrack(context, {
		name,
		order: options.order,
		type: "instrument",
		instrument: createInstrument(context, options.kind),
	});
	const clip = createNoteClip(context, {
		trackId: track.id,
		name,
		lengthTicks: TICKS_PER_BAR,
	});
	const placement = createPlacement(context, {
		clipId: clip.id,
		trackId: track.id,
		startTicks: 0,
		durationTicks: TICKS_PER_BAR,
	});

	return { track, clip, placement };
}

export function newTrackKindSpec(kind: NewTrackKind): NewTrackKindSpec {
	const spec = NEW_TRACK_KINDS.find((candidate) => candidate.kind === kind);
	if (!spec) throw new TypeError(`Unknown track kind "${kind}"`);
	return spec;
}

/** The `instrument_type` an existing track reports, or undefined if it has none. */
export function instrumentTypeKey(
	instrument: Instrument | null,
): InstrumentTypeKey | undefined {
	if (!instrument) return undefined;
	return newTrackKindSpecFor(instrument.kind)?.analyticsType;
}

function newTrackKindSpecFor(kind: string): NewTrackKindSpec | undefined {
	return NEW_TRACK_KINDS.find((candidate) => candidate.kind === kind);
}

function createInstrument(
	context: DomainFactoryContext,
	kind: NewTrackKind,
): Instrument {
	switch (kind) {
		case "sampler":
			// No sample yet: one is loaded from the library or the sampler panel.
			return createSamplerInstrument();
		case "drumMachine":
			return createDrumMachineInstrument(
				DEFAULT_PAD_NAMES.map((padName) =>
					createDrumPad(context, { name: padName }),
				),
			);
		case "synth":
			return createSynthInstrument();
	}
}

/**
 * `Sampler`, then `Sampler 2`, `Sampler 3`, ... Numbering by collision rather
 * than by track count keeps a name stable once given: deleting track 2 does not
 * make the next sampler reuse a name that is still on screen.
 */
function uniqueTrackName(base: string, taken: readonly string[]): string {
	if (!taken.includes(base)) return base;
	for (let suffix = 2; ; suffix += 1) {
		const candidate = `${base} ${suffix}`;
		if (!taken.includes(candidate)) return candidate;
	}
}
