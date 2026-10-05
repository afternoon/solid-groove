// The one typed shortcut registry (PRD `KEY-01`).
//
// This file, with its area modules under `./registry/`, is the *only* place a
// Groove key combination is written down. Event handling (`ShortcutController`), tooltips and menu labels
// (`shortcutLabel`), the `?` mapping guide (`ShortcutGuide.tsx`), the analytics
// `action_id` set, and `docs/shortcuts.md` are all generated from these
// entries, so a mapping cannot be changed in one surface and stale in another.
//
// ## What an entry declares
//
// Action ID, per-platform keys, valid contexts, the group it appears under in
// the guide, and whether it follows or intentionally differs from Ableton Live
// 12 — the `KEY-01` baseline. Enabled state is *not* declared here: it belongs
// to the surface that owns the action and is supplied per handler, because
// whether Undo is available is a property of the session, not of the mapping.
//
// ## Actions with no handler yet
//
// Every mapping in the PRD `KEY-01` table is registered, including ones whose
// surface lands in a later Phase 1 or Phase 2 task. An action nobody has
// registered a handler for simply does not fire — it is listed in the guide,
// where it is shown as unavailable, rather than being invented twice later.
//
// ## Where an entry goes
//
// The entries are split by feature area under `./registry/`: each area file
// declares its own action IDs and definitions, and this module combines them,
// in guide order, into the one registry. A new shortcut goes in its own area's
// file, so two features in different areas never edit the same list.
//
// ## Remapping
//
// P0 mappings are read-only (`KEY-02`). Entries are keyed by a stable action ID
// and resolved through lookups rather than by array position, so a P1
// user-remapping layer can override `keys` per action without this file or its
// consumers changing shape. The one piece of derived state here — the parsed
// chord cache — is keyed by definition *identity* rather than by action ID, so
// an overridden entry cannot pick up the base mapping's stale parse.

import {
  type ChordEvent,
  chordLabel,
  type KeyChord,
  matchesChord,
  parseChord,
  type ShortcutPlatform,
} from "./keys";
import {
  ARRANGEMENT_SHORTCUT_IDS,
  ARRANGEMENT_SHORTCUTS,
  CLIP_LIST_SHORTCUT_IDS,
  CLIP_LIST_SHORTCUTS,
  LOOP_BRACE_SHORTCUT_IDS,
  LOOP_BRACE_SHORTCUTS,
} from "./registry/arrangement";
import { ASSISTANT_SHORTCUT_IDS, ASSISTANT_SHORTCUTS } from "./registry/assistant";
import {
  CLIP_SHORTCUT_IDS,
  CLIP_SHORTCUTS,
  NOTE_MOVE_SHORTCUT_IDS,
  NOTE_MOVE_SHORTCUTS,
} from "./registry/clips";
import type { ShortcutDefinition } from "./registry/define";
import {
  EDIT_SHORTCUT_IDS,
  EDIT_SHORTCUTS,
  VALUE_FIELD_SHORTCUT_IDS,
  VALUE_FIELD_SHORTCUTS,
} from "./registry/editing";
import { EXPORT_SHORTCUT_IDS, EXPORT_SHORTCUTS } from "./registry/export";
import { LIBRARY_SHORTCUT_IDS, LIBRARY_SHORTCUTS } from "./registry/library";
import {
  TRACK_SELECT_SHORTCUT_IDS,
  TRACK_SELECT_SHORTCUTS,
  VIEW_SHORTCUT_IDS,
  VIEW_SHORTCUTS,
} from "./registry/navigation";
import { TRACK_ORDER_SHORTCUT_IDS, TRACK_ORDER_SHORTCUTS } from "./registry/tracks";
import { TRANSPORT_SHORTCUT_IDS, TRANSPORT_SHORTCUTS } from "./registry/transport";
import type { ShortcutContext, ShortcutGroup } from "./types";
import {
  AMBIENT_CONTEXT,
  FOCUS_CONTEXTS,
  MODAL_CONTEXT,
  MODAL_OWNED_CONTEXTS,
  OVERLAY_CONTEXTS,
  SHORTCUT_GROUPS,
} from "./types";

export type { ShortcutDefinition, ShortcutKeys } from "./registry/define";

/**
 * Every action a shortcut can invoke.
 *
 * Pinned as a tuple so it is a closed type: `shortcut_used`'s `action_id`
 * parameter in the analytics catalog is checked against this list, and a
 * handler for an unregistered action is a compile error.
 */
export const SHORTCUT_ACTION_IDS = [
  ...TRANSPORT_SHORTCUT_IDS,
  ...EDIT_SHORTCUT_IDS,
  ...ARRANGEMENT_SHORTCUT_IDS,
  ...CLIP_SHORTCUT_IDS,
  ...VIEW_SHORTCUT_IDS,
  ...TRACK_ORDER_SHORTCUT_IDS,
  ...LOOP_BRACE_SHORTCUT_IDS,
  ...CLIP_LIST_SHORTCUT_IDS,
  ...TRACK_SELECT_SHORTCUT_IDS,
  ...NOTE_MOVE_SHORTCUT_IDS,
  ...VALUE_FIELD_SHORTCUT_IDS,
  ...LIBRARY_SHORTCUT_IDS,
  ...EXPORT_SHORTCUT_IDS,
  ...ASSISTANT_SHORTCUT_IDS,
] as const;
export type ShortcutActionId = (typeof SHORTCUT_ACTION_IDS)[number];

/**
 * The PRD `KEY-01` initial mapping, in guide order.
 *
 * The Ableton-derived mappings and documented deviations use the Ableton Live
 * 12 keyboard shortcut reference as their baseline:
 * https://www.ableton.com/en/manual/live-keyboard-shortcuts/
 */
export const SHORTCUTS: readonly ShortcutDefinition[] = [
  ...TRANSPORT_SHORTCUTS,
  ...EDIT_SHORTCUTS,
  ...ARRANGEMENT_SHORTCUTS,
  ...CLIP_SHORTCUTS,
  ...VIEW_SHORTCUTS,
  ...ASSISTANT_SHORTCUTS,
  ...TRACK_ORDER_SHORTCUTS,
  ...LOOP_BRACE_SHORTCUTS,
  ...CLIP_LIST_SHORTCUTS,
  ...TRACK_SELECT_SHORTCUTS,
  ...NOTE_MOVE_SHORTCUTS,
  ...VALUE_FIELD_SHORTCUTS,
  ...LIBRARY_SHORTCUTS,
  ...EXPORT_SHORTCUTS,
];

/**
 * Combinations the browser or operating system keeps for itself. A page cannot
 * reliably cancel these, so `KEY-01`'s "must not intercept browser- or
 * OS-reserved shortcuts merely for parity" is enforced as a registry test
 * rather than discovered by a user losing a tab.
 */
export const RESERVED_CHORDS: readonly string[] = [
  "Mod+T",
  "Mod+N",
  "Mod+W",
  "Mod+Q",
  "Mod+Shift+T",
  "Mod+Shift+N",
  "Mod+Shift+W",
  "Mod+Tab",
  "Alt+Tab",
  "Mod+L",
  "Mod+E",
  "Mod+U",
  "F5",
  "F11",
  "F12",
];

const byId = new Map<ShortcutActionId, ShortcutDefinition>(
  SHORTCUTS.map((shortcut) => [shortcut.id, shortcut]),
);

/** The definition for an action ID. */
export function shortcutById(id: ShortcutActionId): ShortcutDefinition {
  const found = byId.get(id);
  if (!found) throw new Error(`unregistered shortcut action: ${id}`);
  return found;
}

/** The key specs that apply to one platform. */
export function keySpecsFor(
  shortcut: ShortcutDefinition,
  platform: ShortcutPlatform,
): readonly string[] {
  return platform === "mac" ? shortcut.keys.mac : shortcut.keys.other;
}

/**
 * Parsed chords, memoized per *definition object* rather than per action ID.
 *
 * Keying on identity is what keeps the remapping note above honest: an override
 * layer replaces an entry with a new frozen object, which is a cache miss by
 * construction, so a stale parse can never outlive the keys it came from. (An
 * entry's `keys` are readonly, so the only way to change a mapping is to
 * replace the entry.) A `WeakMap` also means a discarded override is collected
 * with its chords rather than pinned by the cache.
 */
const chordCache = new WeakMap<
  ShortcutDefinition,
  Map<ShortcutPlatform, readonly KeyChord[]>
>();

/** The parsed chords for one action on one platform. */
export function chordsFor(
  shortcut: ShortcutDefinition,
  platform: ShortcutPlatform,
): readonly KeyChord[] {
  let byPlatform = chordCache.get(shortcut);
  if (!byPlatform) {
    byPlatform = new Map();
    chordCache.set(shortcut, byPlatform);
  }
  const cached = byPlatform.get(platform);
  if (cached) return cached;
  const chords = keySpecsFor(shortcut, platform).map((spec) =>
    parseChord(spec, platform),
  );
  byPlatform.set(platform, chords);
  return chords;
}

/**
 * The label a tooltip or menu item shows, e.g. `Cmd+Shift+Z`. Where an action
 * has more than one combination the first is canonical.
 */
export function shortcutLabel(id: ShortcutActionId, platform: ShortcutPlatform): string {
  const chords = chordsFor(shortcutById(id), platform);
  return chordLabel(chords[0], platform);
}

/** Every label for an action, for the guide's key column. */
export function shortcutLabels(
  shortcut: ShortcutDefinition,
  platform: ShortcutPlatform,
): readonly string[] {
  return chordsFor(shortcut, platform).map((chord) => chordLabel(chord, platform));
}

/**
 * Resolves an active context set.
 *
 * `global` is always active, and a modal suppresses everything else, so
 * "context resolution is deterministic" holds without every caller
 * remembering the rule.
 */
export function resolveContexts(
  active: readonly ShortcutContext[],
): readonly ShortcutContext[] {
  if (active.includes(MODAL_CONTEXT)) {
    return [MODAL_CONTEXT, ...MODAL_OWNED_CONTEXTS.filter((c) => active.includes(c))];
  }
  return active.includes(AMBIENT_CONTEXT) ? active : [AMBIENT_CONTEXT, ...active];
}

/**
 * Narrows shortcuts that match one event to the most specific surface's own,
 * when it has any: a focus context (`FOCUS_CONTEXTS`) outranks everything else
 * for the keys it claims, so `Left` moves a focused loop brace rather than
 * also meaning `track.move_left`; then an overlay context (`OVERLAY_CONTEXTS`)
 * outranks the editor behind it, so the open piano roll's arrows move notes.
 * With neither among them the list is returned unchanged.
 */
export function preferFocused(
  matches: readonly ShortcutDefinition[],
  resolved: readonly ShortcutContext[],
): readonly ShortcutDefinition[] {
  for (const tier of [FOCUS_CONTEXTS, OVERLAY_CONTEXTS]) {
    const claimed = matches.filter((shortcut) =>
      shortcut.contexts.some(
        (context) => tier.includes(context) && resolved.includes(context),
      ),
    );
    if (claimed.length > 0) return claimed;
  }
  return matches;
}

/** Whether a shortcut is eligible in an already-resolved context set. */
export function isInContext(
  shortcut: ShortcutDefinition,
  resolved: readonly ShortcutContext[],
): boolean {
  return shortcut.contexts.some((context) => resolved.includes(context));
}

/** Every shortcut valid in the given contexts, in registry order. */
export function shortcutsInContext(
  active: readonly ShortcutContext[],
): readonly ShortcutDefinition[] {
  const resolved = resolveContexts(active);
  return SHORTCUTS.filter((shortcut) => isInContext(shortcut, resolved));
}

/**
 * The shortcut a key event invokes, or `undefined`.
 *
 * Registry order breaks a tie; `registry.test.ts` asserts no two shortcuts can
 * match the same event in overlapping contexts, so order never decides an
 * ambiguous case in practice.
 */
export function matchShortcut(
  event: ChordEvent,
  platform: ShortcutPlatform,
  active: readonly ShortcutContext[],
): ShortcutDefinition | undefined {
  const resolved = resolveContexts(active);
  const matches = SHORTCUTS.filter(
    (shortcut) =>
      isInContext(shortcut, resolved) &&
      chordsFor(shortcut, platform).some((chord) => matchesChord(chord, event, platform)),
  );
  return preferFocused(matches, resolved)[0];
}

export interface ShortcutSection {
  readonly group: ShortcutGroup;
  readonly shortcuts: readonly ShortcutDefinition[];
}

/** The registry grouped into the `KEY-02` guide sections, empty ones dropped. */
export function shortcutSections(
  shortcuts: readonly ShortcutDefinition[] = SHORTCUTS,
): readonly ShortcutSection[] {
  return SHORTCUT_GROUPS.map((group) => ({
    group,
    shortcuts: shortcuts.filter((shortcut) => shortcut.group === group),
  })).filter((section) => section.shortcuts.length > 0);
}
