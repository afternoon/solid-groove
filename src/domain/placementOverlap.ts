/**
 * A track's placements are disjoint in time (#290, option B — the Ableton
 * model). Two placements on one track may touch end to start, but never share a
 * tick: a stacked pair renders as one block while both sound, so it is silently
 * doubled audio the user cannot see to undo.
 *
 * These are pure span helpers over the four timing fields, so the invariant,
 * the edit-time overwrite, and the stored-document migration all agree on what
 * "overlap" and "trim" mean without importing each other.
 */

/** The timing fields every overlap rule reads. */
export interface PlacementSpan {
  readonly trackId: string;
  readonly startTicks: number;
  readonly durationTicks: number;
  readonly clipOffsetTicks: number;
}

export function spanEnd(span: PlacementSpan): number {
  return span.startTicks + span.durationTicks;
}

/** True when two placements share at least one tick on the same track. */
export function placementsOverlap(a: PlacementSpan, b: PlacementSpan): boolean {
  return (
    a.trackId === b.trackId && a.startTicks < spanEnd(b) && b.startTicks < spanEnd(a)
  );
}

/**
 * Trims `span`'s head so it starts at `startTicks`, keeping its far edge put and
 * advancing `clipOffsetTicks` in step so the audible content does not slide —
 * the same arithmetic as dragging the start edge.
 */
export function trimHead<T extends PlacementSpan>(span: T, startTicks: number): T {
  const delta = startTicks - span.startTicks;
  return {
    ...span,
    startTicks,
    durationTicks: span.durationTicks - delta,
    clipOffsetTicks: span.clipOffsetTicks + delta,
  };
}

/**
 * Resolves every overlap by keeping the earlier-starting placement intact and
 * trimming the overlapping part of the later one away, removing it when it is
 * fully covered. On a tie, the placement earlier in the array is kept. Survivors
 * keep their original array order. Used by the v2 -> v3 migration.
 */
export function trimLaterOverlaps<T extends PlacementSpan>(
  placements: readonly T[],
): T[] {
  const byStart = placements
    .map((placement, index) => ({ placement, index }))
    .sort((a, b) => a.placement.startTicks - b.placement.startTicks || a.index - b.index);
  const frontier = new Map<string, number>();
  const kept = new Map<number, T>();
  for (const { placement, index } of byStart) {
    const reached = frontier.get(placement.trackId) ?? Number.NEGATIVE_INFINITY;
    if (spanEnd(placement) <= reached) continue;
    kept.set(
      index,
      placement.startTicks < reached ? trimHead(placement, reached) : placement,
    );
    frontier.set(placement.trackId, spanEnd(placement));
  }
  return placements.flatMap((_, index) => {
    const placement = kept.get(index);
    return placement ? [placement] : [];
  });
}
