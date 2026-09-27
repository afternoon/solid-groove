// Pointer modifiers: a key held during a pointer gesture that changes what the
// gesture does (PRD `KEY-01`, ARR-011).
//
// A key combination and a pointer modifier are different things — one fires an
// action on a key press, the other is *read* off a pointer event while a drag
// runs — so these do not go in `SHORTCUTS`, whose entries the controller
// dispatches and whose IDs `shortcut_used` logs. They live beside it for the
// same reason `SHORTCUTS` exists: a modifier is written down once, here, with
// its Ableton parity, and `docs/shortcuts.md` is its human copy
// (`docs.test.ts` fails if the two drift). A component asks
// `pointerModifierHeld` rather than reading `altKey` itself.

import type { ShortcutPlatform } from "./keys";
import type { AbletonParity } from "./types";

/** Every pointer modifier. Closed, like `SHORTCUT_ACTION_IDS`. */
export const POINTER_MODIFIER_IDS = ["arrangement.drag_copy"] as const;
export type PointerModifierId = (typeof POINTER_MODIFIER_IDS)[number];

/** The modifier keys a pointer event reports. */
export type PointerModifierKey = "alt" | "shift" | "mod";

export interface PointerModifierDefinition {
  readonly id: PointerModifierId;
  /** Guide/docs wording. Never a user-entered string. */
  readonly label: string;
  readonly description: string;
  readonly modifier: PointerModifierKey;
  /** The gesture it modifies, as the docs name it, e.g. `drag`. */
  readonly gesture: string;
  readonly ableton: AbletonParity;
}

export const POINTER_MODIFIERS: readonly PointerModifierDefinition[] = [
  {
    id: "arrangement.drag_copy",
    label: "Copy clips by dragging",
    description:
      "Held at the drop of a clip-body drag, copies every selected clip by the drag's offset instead of moving it.",
    modifier: "alt",
    gesture: "drag",
    ableton: {
      kind: "differs",
      abletonKeys: "Option-drag (macOS) / Ctrl-drag (Windows)",
      reason:
        "Follows Live's Option-drag on macOS. Windows/Linux use Alt as well rather than Live's Ctrl-drag, so one modifier copies on every platform and Ctrl/Cmd-click stays the selection click (CF-015).",
    },
  },
];

const byId = new Map(POINTER_MODIFIERS.map((entry) => [entry.id, entry]));

export function pointerModifierById(id: PointerModifierId): PointerModifierDefinition {
  const found = byId.get(id);
  if (!found) throw new Error(`unregistered pointer modifier: ${id}`);
  return found;
}

/** The subset of a `PointerEvent`/`MouseEvent` a modifier is read from. */
export interface ModifierEvent {
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
}

/** Whether `id`'s modifier is held in `event`, on `platform`. */
export function pointerModifierHeld(
  id: PointerModifierId,
  event: ModifierEvent,
  platform: ShortcutPlatform,
): boolean {
  const { modifier } = pointerModifierById(id);
  if (modifier === "alt") return event.altKey;
  if (modifier === "shift") return event.shiftKey;
  return platform === "mac" ? event.metaKey : event.ctrlKey;
}

/** The modifier's platform name, as `chordLabel` spells it. */
function modifierLabel(key: PointerModifierKey, platform: ShortcutPlatform): string {
  if (key === "alt") return platform === "mac" ? "Option" : "Alt";
  if (key === "shift") return "Shift";
  return platform === "mac" ? "Cmd" : "Ctrl";
}

/** The label the docs and guide show, e.g. `Option+drag`. */
export function pointerModifierLabel(
  definition: PointerModifierDefinition,
  platform: ShortcutPlatform,
): string {
  return `${modifierLabel(definition.modifier, platform)}+${definition.gesture}`;
}

/** `KeyboardEvent.key` for each modifier the platform reports. */
const MODIFIER_EVENT_KEYS: Record<PointerModifierKey, readonly string[]> = {
  alt: ["Alt", "AltGraph"],
  shift: ["Shift"],
  mod: ["Meta", "Control"],
};

/**
 * Keeps the browser from acting on `id`'s modifier key while a gesture holds
 * it. Pressing and letting go of Alt on its own opens the menu bar on Windows
 * (and focuses Chrome's menu), which in the middle of a drag steals the
 * keyboard from the page.
 *
 * The returned `stop` ends it. Called with `held` true — the modifier is still
 * down when the gesture ends, as it is at an Alt-drag's drop — it waits for the
 * modifier's own `keyup` and cancels that too, since that release is the one
 * the browser would act on.
 *
 * Only the bare modifier key is cancelled: a chord such as Alt+ArrowUp still
 * reaches `ShortcutController`, which listens for the same `keydown`.
 */
export function suppressModifierDefault(
  id: PointerModifierId,
  target: EventTarget,
): (held?: boolean) => void {
  const keys = MODIFIER_EVENT_KEYS[pointerModifierById(id).modifier];
  let stopAtRelease = false;
  const detach = () => {
    target.removeEventListener("keydown", listener);
    target.removeEventListener("keyup", listener);
  };
  function listener(event: Event): void {
    if (!keys.includes((event as KeyboardEvent).key)) return;
    event.preventDefault();
    if (stopAtRelease && event.type === "keyup") detach();
  }
  target.addEventListener("keydown", listener);
  target.addEventListener("keyup", listener);
  return (held = false) => {
    if (held) stopAtRelease = true;
    else detach();
  };
}
