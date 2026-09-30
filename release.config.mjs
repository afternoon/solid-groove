/**
 * Where Groove is in its life, and whether it makes money.
 *
 * One file, deliberately small, read by the build scripts (plain Node ESM).
 * It exists so that leaving the private alpha is a single, deliberate edit
 * with consequences the build enforces, never a side effect of something else.
 *
 * While the stage is `private-alpha` and `FOR_PROFIT` is `false`, the sample
 * library may ship packs under the `private-alpha` rights position: classic
 * drum-machine kits whose rights grant is informal or unconfirmed, admitted by
 * the product owner for a free, invite-only alpha (DEC-010,
 * docs/sample-library.md section 3.2). Changing either value makes
 * `library:build` reject every such pack, so they must be replaced, cleared,
 * or removed first. That work is CNT-003.
 */

/** @type {"private-alpha" | "public-beta" | "general-availability"} */
export const RELEASE_STAGE = "private-alpha";

/** Whether Groove charges for anything, directly or indirectly. */
export const FOR_PROFIT = false;

/**
 * Whether alpha-only content may ship. Takes the values as arguments so tests
 * can prove the gate closes without editing this file.
 */
export function alphaOnlyContentAllowed({
  stage = RELEASE_STAGE,
  forProfit = FOR_PROFIT,
} = {}) {
  return stage === "private-alpha" && forProfit === false;
}
