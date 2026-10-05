/**
 * Whether the user has asked their system for less motion (#76). Anything that
 * animates from script, rather than through a stylesheet the base layer's
 * `prefers-reduced-motion` rule already reaches, asks this first and jumps
 * instead. False where there is no `matchMedia` (jsdom, a worker).
 */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** The scroll behaviour to ask for: smooth, unless motion is reduced. */
export function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? "auto" : "smooth";
}
