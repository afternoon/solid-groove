/**
 * Text entry is the one place a key has to keep its normal meaning, so typing
 * targets are left alone (`KEY-01`: "Focused inputs, textareas, content-
 * editable elements, dialogs, and menus receive normal typing behavior").
 *
 * Sliders, checkboxes, and buttons are not typing targets — a shortcut fired
 * while a fader has focus is exactly the case the registry exists for. A
 * focused button does keep the one or two keys that press it: see
 * `focusPressesKey` below.
 */
export function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) {
    return ![
      "range",
      "checkbox",
      "radio",
      "button",
      "submit",
      "reset",
      "color",
      "file",
    ].includes(target.type);
  }
  return false;
}

/**
 * Controls the browser presses on Space: buttons, toggles, radios, and the
 * ARIA roles that stand in for them. A slider is not one — Space does nothing
 * on a fader, so it stays the transport's there.
 */
const PRESSED_BY_SPACE = [
  "button",
  "summary",
  'input:is([type="checkbox"], [type="radio"], [type="button"], [type="submit"], [type="reset"], [type="image"], [type="file"], [type="color"])',
  '[role="button"]',
  '[role="checkbox"]',
  '[role="switch"]',
  '[role="radio"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="tab"]',
].join(", ");

/** Controls the browser presses on Enter: buttons and links. */
const PRESSED_BY_ENTER = [
  "button",
  "summary",
  "a[href]",
  'input:is([type="button"], [type="submit"], [type="reset"], [type="image"], [type="file"], [type="color"])',
  '[role="button"]',
  '[role="link"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="tab"]',
].join(", ");

/**
 * Whether a plain Space or Enter belongs to the focused control (GRV-54).
 * Keyboard users press a focused button with Space or Enter, as in every
 * other app, so those two keys are the control's; every other shortcut still
 * fires from a focused button, which is why the editor listens on the window.
 */
export function focusPressesKey(
  target: EventTarget | null,
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
): boolean {
  if (!(target instanceof Element)) return false;
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false;
  if (event.key === " ") return target.matches(PRESSED_BY_SPACE);
  if (event.key === "Enter") return target.matches(PRESSED_BY_ENTER);
  return false;
}
