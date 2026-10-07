// The shape of a registry entry, and the helper every area's entries are
// written with. See `../registry.ts` for the registry as a whole.

import type { ShortcutActionId } from "../registry";
import type {
  AbletonParity,
  BrowserConflict,
  ShortcutContext,
  ShortcutGroup,
} from "../types";

/** Per-platform key combinations for one action. */
export interface ShortcutKeys {
  readonly mac: readonly string[];
  readonly other: readonly string[];
}

export interface ShortcutDefinition {
  readonly id: ShortcutActionId;
  /** Menu/tooltip/guide wording. Never a user-entered string. */
  readonly label: string;
  /** One line of guide detail: what the action does, in context. */
  readonly description: string;
  readonly group: ShortcutGroup;
  /** Any one of these being active makes the shortcut eligible. */
  readonly contexts: readonly ShortcutContext[];
  readonly keys: ShortcutKeys;
  readonly ableton: AbletonParity;
  /**
   * `allowed` lets the shortcut through a focused input, textarea, or
   * content-editable element. Everything else is blocked there so typing
   * behaves normally (`KEY-01`).
   */
  readonly textEntry?: "allowed";
  /**
   * `allowed` lets a plain Space or Enter through a focused button, toggle,
   * radio or link, which otherwise keeps the key so the browser presses it
   * (GRV-54). Only for a mapping whose handler decides about the focused
   * control itself.
   */
  readonly focusedControl?: "allowed";
  /** Auto-repeat fires the action again. Off unless holding the key is the point. */
  readonly repeatable?: boolean;
  /** Set false where the browser default must survive. */
  readonly preventDefault?: boolean;
  readonly browserConflict?: BrowserConflict;
}

type KeysInput = string | readonly string[] | ShortcutKeys;

function toKeys(input: KeysInput): ShortcutKeys {
  if (typeof input === "string") return { mac: [input], other: [input] };
  if (Array.isArray(input)) {
    const specs = input as readonly string[];
    return { mac: specs, other: specs };
  }
  return input as ShortcutKeys;
}

export function define(
  definition: Omit<ShortcutDefinition, "keys"> & { readonly keys: KeysInput },
): ShortcutDefinition {
  return { ...definition, keys: toKeys(definition.keys) };
}
