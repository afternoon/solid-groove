/**
 * ARIA state attributes, encoded the way ARIA defines them.
 *
 * `aria-pressed`, `aria-expanded`, `aria-checked` and friends are *enumerated
 * string* attributes, not HTML boolean attributes. `"false"` is a meaningful
 * value — an unpressed toggle button must say so — and it is not the same as
 * the attribute being absent, which means "this is not a toggle button at all".
 *
 * Solid 2 does not encode them for us; it treats a boolean the way it treats
 * `disabled`. Measured against `solid-js@2.0.0-rc.3`:
 *
 * | written                 | rendered            |
 * | ----------------------- | ------------------- |
 * | `aria-pressed={true}`   | `aria-pressed=""`   |
 * | `aria-pressed={false}`  | attribute removed   |
 *
 * Both are wrong, and the `false` case is the one that costs a real user:
 * a screen reader stops announcing the control as a toggle. Solid's own types
 * catch it (`EnumeratedPseudoBoolean = "false" | "true"` rejects a `boolean`),
 * which is why this is a compile error rather than a silent accessibility
 * regression -- but the types stop at "not a boolean", and are equally happy
 * with a hand-written ternary that spells one of the two literals wrong.
 *
 * So spell them once, here. `String(value)` cannot do this job: it returns
 * `string`, which the same types reject.
 */

/** `true`/`false` as ARIA spells them. */
export function ariaBool(value: boolean): "true" | "false" {
  return value ? "true" : "false";
}
