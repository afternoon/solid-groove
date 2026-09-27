/**
 * What a click on a clip does to the arrangement's one selection, by the
 * modifier held (#405):
 *
 * - the platform's primary modifier — Cmd on macOS, Ctrl elsewhere — toggles
 *   that one clip in or out and keeps the rest;
 * - Shift extends the selection to the box between it and the clicked clip;
 * - nothing replaces the selection with the clicked clip (CF-009).
 *
 * Ctrl on macOS is not the primary modifier (a Ctrl-click there is the
 * platform's secondary click), so it is ignored rather than toggling.
 */

import { detectPlatform, type ShortcutPlatform } from "../shortcuts/keys";

export type ClipClickGesture = "replace" | "toggle" | "extend";

export function clipClickGesture(
  event: Pick<MouseEvent, "shiftKey" | "metaKey" | "ctrlKey">,
  platform: ShortcutPlatform = detectPlatform(),
): ClipClickGesture {
  const primary = platform === "mac" ? event.metaKey : event.ctrlKey;
  if (primary) return "toggle";
  return event.shiftKey ? "extend" : "replace";
}
