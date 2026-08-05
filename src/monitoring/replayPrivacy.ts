// Component-level replay masking (ADR 0002 decision 2).
//
// Session Replay masks everything by default (`maskAllText`, `blockAllMedia`,
// canvas capture off — see `sentrySink.ts`). That default is the primary
// safeguard, and it is not the only one. This module is the second: a surface
// rendering user-authored or project-derived content marks *itself*, so it is
// masked by the default **and** by its own markup.
//
// ## Why two safeguards for the same bytes
//
// The default is a configuration value in one file, and a configuration value
// is exactly the kind of thing a future upgrade, an "unmask this one label to
// make the replay readable" change, or a well-meaning selector allowance can
// weaken from a distance. The whole privacy position of ADR 0002 rests on
// masking, and a single unmasked surface rendering a clip name puts project
// content into a third-party system. So the marking travels with the component
// that renders the content, where a reviewer reading that component can see it.
//
// It is deliberately *not* a Sentry import. These are the class names Sentry's
// replay integration looks for by default (`sentry-mask`, `sentry-block`), used
// as plain strings, so `src/monitoring/sentrySink.ts` stays the only module in
// the codebase that imports `@sentry/*` (ADR 0001 decision 1, ADR 0002
// decision 7) and a component can mark itself without reaching for the SDK.
//
// ## Which one to use
//
// - `MASK_CONTENT` (`sentry-mask`) — text that is or contains user-authored or
//   project-derived content: a track name, a clip name, a project name, an
//   asset name, an assistant message, the contents of a text input. The element
//   still appears in the replay with its shape and position; its *characters*
//   are replaced at capture and are never serialized into the payload. This is
//   the right choice almost everywhere, because it keeps the replay legible as
//   an interaction — you can see the user click the third track — without
//   carrying what the track is called.
// - `BLOCK_CONTENT` (`sentry-block`) — a whole subtree that should not be
//   recorded at all, replaced by a placeholder box. For media and for renderers
//   whose pixels are the content (a waveform, an arrangement canvas). Canvas is
//   already off globally; blocking the container is the marking that survives
//   someone turning canvas capture on.
//
// A surface is listed in `replayPrivacy.test.ts`, which fails when a known
// content surface stops carrying its marking. That list is what makes this
// checkable rather than a convention.

/** Sentry's default mask class: this element's text is masked at capture. */
export const MASK_CONTENT = "sentry-mask";

/** Sentry's default block class: this subtree is not recorded at all. */
export const BLOCK_CONTENT = "sentry-block";

/**
 * Sentry's default "unmask" class.
 *
 * Exported for completeness and for the test that asserts nothing in `src/`
 * uses it. ADR 0002 decision 2 permits unmasking only stable, non-user-authored
 * chrome, and only by an explicit named selector in `sentrySink.ts` — never by
 * a component deciding for itself that its own content is safe.
 */
export const UNMASK_CONTENT = "sentry-unmask";
