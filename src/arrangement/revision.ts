/**
 * Object-identity revision counters (PRD section 9.3 "Culling, projection, and
 * caches": "The projection exposes revision counters at song, track, clip,
 * asset, and automation granularity so unrelated edits do not invalidate all
 * cached geometry").
 *
 * Domain state is edited immutably (`createStore`/`produce`): a command that
 * changes one track produces a new track object but leaves every untouched
 * sibling's reference exactly as it was. That means reference identity is
 * already a correct, free "did this change" signal — we do not need to hash
 * or deep-compare entities to know whether a track, clip, placement, or
 * automation lane changed since the last projection build. A `WeakMap` from
 * object identity to a monotonically increasing counter turns that identity
 * check into a stable number the renderer can cache against, without forcing
 * every consumer to carry object references around as cache keys.
 *
 * The registry is process-wide and deliberately never cleared: entries are
 * held weakly, so an entity that becomes unreachable (a project is closed, a
 * clip is deleted) is collected normally: this module never grows unbounded
 * on its own.
 */

const revisions = new WeakMap<object, number>();
let nextRevision = 1;

/**
 * The stable revision number for `entity`. The first time a given object
 * reference is seen it is assigned the next counter value; every later call
 * with the *same* reference returns that same number. A structurally
 * identical but distinct object (e.g. produced by `produce` when this entity
 * itself changed) gets a new number.
 */
export function revisionOf(entity: object): number {
  let revision = revisions.get(entity);
  if (revision === undefined) {
    revision = nextRevision;
    nextRevision += 1;
    revisions.set(entity, revision);
  }
  return revision;
}

/**
 * Folds several revision numbers (e.g. a placement's own revision and its
 * clip's) into one, so a projection field that depends on more than one
 * entity still gets a single comparable cache key. Order-sensitive and
 * deterministic — the same inputs in the same order always fold to the same
 * output.
 */
export function combineRevisions(...values: readonly number[]): number {
  let hash = 0x811c9dc5;
  for (const value of values) {
    hash ^= value;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}
