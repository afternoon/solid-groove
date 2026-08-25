import type { CommandInput, RawCommandInput } from "../commands";
import {
  clearNotes,
  duplicateNotes,
  noteEventsOf,
  quantizeNotes,
  scaleNoteVelocity,
  transposeNotes,
  varyNotes,
} from "../commands";
import type { Clip, Project } from "../domain/entities";
import type { EventId, IdFactory } from "../domain/ids";
import { TICKS_PER_BAR, TICKS_PER_SIXTEENTH } from "../domain/time";

/**
 * Pure, framework-free model behind the CLP-04 transformation panel.
 *
 * `TransformPanel.tsx` owns the buttons, the dispatch, and the analytics; every
 * decision that is a *function of the clip and the current selection* lives
 * here, so scope resolution, seeding, and the enabled/disabled rules are unit
 * testable without a DOM.
 *
 * Nothing here mutates a project. Each builder returns a `CommandInput` for one
 * of the six already-registered `notes.*` transformations, so the panel adds no
 * mutation path of its own — the same commands the assistant will call.
 */

/** The transformations the panel exposes, in the order it renders them. */
export const TRANSFORM_KINDS = [
  "transpose",
  "scaleVelocity",
  "quantize",
  "duplicate",
  "clear",
  "vary",
] as const;
export type TransformKind = (typeof TRANSFORM_KINDS)[number];

/** Quantize and vary both work against the editors' 16th-note grid. */
export const TRANSFORM_GRID_TICKS = TICKS_PER_SIXTEENTH;
/** Duplicating offsets by one bar, matching the piano roll's own duplicate. */
export const TRANSFORM_DUPLICATE_OFFSET_TICKS = TICKS_PER_BAR;

/**
 * The selection a transformation applies to.
 *
 * `null` event IDs mean "every note in the clip" — the command layer's own
 * convention (`eventSelectionSchema`), not a separate notion of scope. So an
 * empty pointer selection widens to the whole clip rather than doing nothing,
 * which is what makes the panel useful before the user has selected anything.
 */
export interface TransformScope {
  /** `null` selects the whole clip. */
  readonly eventIds: readonly EventId[] | null;
  /** How many notes the transformation will actually touch. */
  readonly count: number;
  /** True when the scope widened to the clip because nothing was selected. */
  readonly isWholeClip: boolean;
}

/**
 * Resolves the scope for a clip and the editor's current selection.
 *
 * Selected IDs that are no longer in the clip are dropped rather than passed
 * through: a stale ID makes the command reject the whole transformation, and a
 * selection can outlive the notes it points at (an undo, or a remote edit).
 */
export function resolveTransformScope(
  clip: Clip,
  selectedIds: readonly EventId[],
): TransformScope {
  const events = noteEventsOf(clip) ?? [];
  const present = new Set(events.map((event) => event.id));
  const live = selectedIds.filter((id) => present.has(id));
  if (live.length === 0) {
    return { eventIds: null, count: events.length, isWholeClip: true };
  }
  return { eventIds: live, count: live.length, isWholeClip: false };
}

/**
 * Whether a transformation can run at all.
 *
 * Every one of the six commands rejects a clip with no notes in scope, so the
 * panel disables its buttons rather than dispatching a transaction that is
 * certain to fail and would surface as an error the user did not cause.
 */
export function canTransform(scope: TransformScope): boolean {
  return scope.count > 0;
}

export interface TransformOptions {
  /** Semitones for `transpose`. */
  readonly semitones: number;
  /** Multiplier for `scaleVelocity`. */
  readonly velocityFactor: number;
  /** Seed for `vary`; the caller supplies it so the result is reproducible. */
  readonly seed: string;
  /** Share of notes `vary` may touch, 0..1. */
  readonly amount: number;
}

export const DEFAULT_TRANSFORM_OPTIONS: TransformOptions = {
  semitones: 12,
  velocityFactor: 1.25,
  seed: "vary-1",
  amount: 0.5,
};

/**
 * Builds the command for one transformation.
 *
 * `duplicate` needs an ID factory and the project because its payload carries
 * the new event IDs explicitly — that is what makes redo and an assistant
 * preview reproduce the same notes rather than minting fresh ones each time.
 */
export function buildTransform(
  kind: TransformKind,
  context: {
    readonly project: Project;
    readonly clip: Clip;
    readonly scope: TransformScope;
    readonly ids: IdFactory;
    readonly options: TransformOptions;
  },
): CommandInput<never> | RawCommandInput {
  const { clip, scope, options } = context;
  switch (kind) {
    case "transpose":
      return transposeNotes(clip.id, scope.eventIds, options.semitones);
    case "scaleVelocity":
      return scaleNoteVelocity(clip.id, scope.eventIds, options.velocityFactor);
    case "quantize":
      return quantizeNotes(clip.id, scope.eventIds, TRANSFORM_GRID_TICKS, 1);
    case "duplicate":
      return duplicateNotes(context.ids, context.project, {
        clipId: clip.id,
        eventIds: scope.eventIds,
        offsetTicks: TRANSFORM_DUPLICATE_OFFSET_TICKS,
      });
    case "clear":
      // `notes.clear` empties the whole clip by definition — it takes no
      // selection — so the panel labels it for the clip, never the selection.
      return clearNotes(clip.id);
    case "vary":
      return varyNotes(clip.id, scope.eventIds, {
        seed: options.seed,
        amount: options.amount,
        gridTicks: TRANSFORM_GRID_TICKS,
      });
  }
}

/** How many notes a transformation reports to `clip_edited`'s count bucket. */
export function transformedEventCount(
  kind: TransformKind,
  scope: TransformScope,
  clip: Clip,
): number {
  if (kind === "clear") {
    // Clear always empties the clip, whatever happened to be selected.
    return (noteEventsOf(clip) ?? []).length;
  }
  return scope.count;
}

/** The button label for each transformation. */
export const TRANSFORM_LABELS: Readonly<Record<TransformKind, string>> = {
  transpose: "Transpose",
  scaleVelocity: "Velocity",
  quantize: "Quantize",
  duplicate: "Duplicate",
  clear: "Clear",
  vary: "Vary",
};
