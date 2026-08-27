/**
 * Synthetic events that let the resulting write land before they return.
 *
 * Solid 2 batches reads until the microtask flush, so a handler's signal write
 * is not visible in the DOM at the moment `fireEvent` returns. A browser
 * flushes on its own before the next paint; a synchronous assertion does not.
 * And it is not only assertions that need it — a *later* event in the same test
 * lands on the DOM this one produced, so a button still reading `disabled`
 * would swallow the next click.
 *
 * `fireEvent` will not do this for us. `@solidjs/testing-library` re-exports it
 * verbatim from `@testing-library/dom` (`export * from "@testing-library/dom"`)
 * and calls `flush()` only inside its own `render` and `cleanup`. Confirmed by
 * measurement as well as by reading: click a counter and the DOM still reads
 * the old value until `flush()` runs.
 *
 * `flush()` is the sanctioned test-side "catch up now". It is not, and must not
 * become, product code.
 */

import { fireEvent } from "@solidjs/testing-library";
import { flush } from "solid-js";

/**
 * The general form: fire whatever event you like, then flush.
 *
 * Use it for `input`, `keydown`, a direct dispatch onto a controller — anything
 * that is not a plain click.
 */
export function fireAndFlush(fire: () => void): void {
  fire();
  flush();
}

/** Click and flush, which is the overwhelmingly common case. */
export function clickAndFlush(element: Element): void {
  fireAndFlush(() => {
    fireEvent.click(element);
  });
}
