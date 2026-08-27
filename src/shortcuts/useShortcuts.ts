import { onSettled } from "solid-js";
import { ShortcutController, type ShortcutControllerOptions } from "./ShortcutController";

/**
 * Installs one `ShortcutController` on the window for the lifetime of the
 * calling component (PRD `KEY-01`).
 *
 * Listening on the window rather than on an editor element is what makes a
 * shortcut work while focus sits on a transport button or a fader; the
 * controller's own context and text-entry rules decide whether it acts, so
 * "listens everywhere" never means "fires everywhere".
 *
 * `attach` returns its own detach function, and in Solid 2 the value an
 * `onSettled` callback returns *is* its cleanup — so handing the detach back is
 * the whole teardown, in place of 1.x's nested `onCleanup`.
 */
export function useShortcuts(options: ShortcutControllerOptions): ShortcutController {
  const controller = new ShortcutController(options);
  onSettled(() => controller.attach(window));
  return controller;
}
