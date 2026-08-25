import type { Clip, Placement, Track } from "../domain/entities";
import {
  createNoteClip,
  createPlacement,
  createTrack,
  type DomainFactoryContext,
} from "../domain/factories";
import { TICKS_PER_BAR } from "../domain/time";
import {
  createInstrumentOfKind,
  INSTRUMENT_KINDS,
  type InstrumentKind,
  type InstrumentKindSpec,
} from "../instrument/instrumentKinds";

/**
 * What creating a track produces, and the kinds it can be created as (#223).
 *
 * Track creation used to mint a synth and nothing else, so a sampler or a drum
 * machine could only ever arrive with the starter project or a fixture. Which
 * kinds exist, what each is called, what instrument each mints, and what each
 * reports to analytics are `src/instrument/instrumentKinds.ts`'s to say — the
 * instrument panel's kind picker chooses from the same set, and the two had
 * begun to disagree. What is track creation's alone stays here: the button's
 * accessible name, and the clip and placement a new track opens with.
 *
 * Nothing here mutates a project: it builds the entities a `track.add` command
 * carries, so the mixer's dispatch stays the one mutation path (PRD 9.6).
 */

/** The instrument kinds a new track can be created with. */
export type NewTrackKind = InstrumentKind;

export interface NewTrackKindSpec extends InstrumentKindSpec {
  /**
   * The button's accessible name. It contains {@link InstrumentKindSpec.label}
   * so the visible text is a prefix of what a speech-input user has to say
   * (WCAG 2.5.3), which is why it is derived from the label rather than
   * written out beside it.
   */
  readonly actionLabel: string;
}

/**
 * The kinds offered, in the order they are offered — the shared order, so the
 * mixer's buttons and the instrument panel's picker read the same way.
 */
export const NEW_TRACK_KINDS: readonly NewTrackKindSpec[] = INSTRUMENT_KINDS.map(
  (spec) => ({
    ...spec,
    actionLabel: `Add ${spec.label.toLowerCase()} track`,
  }),
);

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
    instrument: createInstrumentOfKind(context, options.kind),
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

/**
 * The `instrument_type` an existing track reports. Re-exported so a caller
 * working in track terms need not reach past this module for it; the value set
 * itself belongs to the shared kind table.
 */
export { instrumentTypeKey } from "../instrument/instrumentKinds";

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
