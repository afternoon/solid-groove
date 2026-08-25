/**
 * Text entry is the one place a key has to keep its normal meaning, so typing
 * targets are left alone (`KEY-01`: "Focused inputs, textareas, content-
 * editable elements, dialogs, and menus receive normal typing behavior").
 *
 * Sliders, checkboxes, and buttons are not typing targets — a shortcut fired
 * while a fader has focus is exactly the case the registry exists for.
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
