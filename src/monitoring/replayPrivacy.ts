// Component-level replay masking (ADR 0002 decision 2).
//
// Session Replay masks everything by default (`maskAllText`, `blockAllMedia`,
// canvas capture off — see `sentrySink.ts`). That default is the primary
// safeguard. This module is the second one, and it is deliberately narrow: the
// few elements *known* to render a name the user typed mark themselves, so the
// marking survives the day someone unmasks static chrome to make a replay
// readable.
//
// ## Narrow on purpose
//
// The temptation is to mark every container that could conceivably hold
// something private — the mixer, the arrangement, a project card. Resist it.
// Replay exists to show where people get stuck (ADR 0002 decision 1), and a
// replay in which the editor is a field of grey blocks answers no question at
// all. So the bar is specific: **this element renders a string a user typed.**
// In schema v1 that is three things — a project name, a track name, a clip
// name, the only `name` fields a command can write — plus the contents of a
// text input, notably the search boxes PRD OPS-03 names directly.
//
// What is deliberately *not* marked:
//
//   - **Asset, pad, and pack names**: library facts we ship, identical for
//     every user. Masking them hides which sound someone reached for.
//   - **Note and clip geometry** (piano-roll notes, the arrangement canvas):
//     no text to mask. `sentry-mask` replaces characters, not shapes, so
//     marking them shows a viewer nothing new; blocking them would remove the
//     surface. Canvas capture is off globally, and that is what keeps the
//     arrangement's rendered clip names out of the payload.
//   - **Structural containers** (a mixer strip, a project card, a panel): the
//     name inside is marked instead, so the controls around it stay legible.
//
// ## A limit worth knowing
//
// These classes mask text nodes and input values, not attributes: Sentry masks
// only `title` and `placeholder` by default, so an `aria-label` built from a
// track name is recorded whether or not its element carries `sentry-mask`.
// Marking a whole subtree never fixed that; the fix is `maskAttributes` in the
// SDK configuration, which belongs to the sink slice.
//
// The class names are plain strings rather than a Sentry import, so
// `sentrySink.ts` stays the only module importing `@sentry/*` (ADR 0001
// decision 1, ADR 0002 decision 7). `replayPrivacy.test.ts` pins both the
// surfaces that carry a marking and the ones that must stay without one.

/** Sentry's default mask class: this element's text is masked at capture. */
export const MASK_CONTENT = "sentry-mask";

/**
 * Sentry's default "unmask" class.
 *
 * Exported for the test that asserts nothing in `src/` uses it. ADR 0002
 * decision 2 permits unmasking only stable, non-user-authored chrome, and only
 * by an explicit named selector in `sentrySink.ts` — never by a component
 * deciding for itself that its own content is safe.
 */
export const UNMASK_CONTENT = "sentry-unmask";
