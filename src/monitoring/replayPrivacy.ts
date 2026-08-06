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
// ## Attributes are a separate lever
//
// A class marks text nodes and input values. It does not touch attributes, and
// in this codebase the attributes are where the names actually leak: accessible
// names are built by interpolation — `aria-label={`Mute ${track.name}`}` on a
// mixer button, `Piano roll: ${clip.name}` on the roll — so a track or clip
// name reaches the recording through an element whose *text* holds nothing
// private at all. Marking the surrounding subtree never fixed that, and could
// not: the element would have to be blocked, which is the grey-box outcome
// decision 1 rules out. `MASK_ATTRIBUTES` below is the fix, and it is the
// better one — it applies to every element rather than the ones someone
// remembered to mark.
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

/**
 * Attribute names whose values are masked at capture, on every element.
 *
 * `sentrySink.ts` hands this to `replayIntegration({ maskAttributes })` when it
 * configures replay — the sink is the only module that may import `@sentry/*`,
 * so the list lives here with the rest of the vocabulary and is consumed there.
 * The SDK replaces each value's non-whitespace characters before serialization, so
 * a masked attribute never enters the payload — and it does so regardless of
 * `maskAllText` or of any class the element carries, which is what makes this
 * survive an unmask selector added later to make a replay readable.
 *
 * `aria-label` is here because it is where a track, clip, or project name
 * reaches the DOM in this codebase (`replayPrivacy.test.ts` scans for that and
 * fails on a name interpolated into any attribute this list does not cover).
 *
 * `title` and `placeholder` are here because this list *replaces* the SDK's
 * default rather than extending it. Passing only `aria-label` would quietly
 * unmask two attributes in the course of masking one.
 */
export const MASK_ATTRIBUTES: readonly string[] = [
	"title",
	"placeholder",
	"aria-label",
];
