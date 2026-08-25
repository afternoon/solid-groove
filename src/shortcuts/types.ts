// The vocabulary of the PRD `KEY-01` shortcut registry: where a shortcut is
// allowed to act, and how the mapping guide groups it.
//
// These are deliberately small closed sets. A context is a *surface that is
// currently active*, not a component instance, so context resolution stays
// deterministic: a shortcut acts on the focused editor or the current
// selection and can never silently target hidden content.

/**
 * Surfaces a shortcut can be valid in.
 *
 * `global` is active whenever the application is: `ShortcutController` adds it
 * to every resolution. `dialog` is special — while it is active it is the
 * *only* context considered, so an open modal or menu receives normal typing
 * behavior and cannot have an editor shortcut fire underneath it.
 */
export const SHORTCUT_CONTEXTS = [
  "global",
  "editor",
  "arrangement",
  "step_editor",
  "piano_roll",
  "automation_lane",
  "timeline",
  "selection",
  "dialog",
  "gesture",
] as const;
export type ShortcutContext = (typeof SHORTCUT_CONTEXTS)[number];

/** The context that suppresses every other one while it is active. */
export const MODAL_CONTEXT: ShortcutContext = "dialog";

/** The context that is always active. */
export const AMBIENT_CONTEXT: ShortcutContext = "global";

/**
 * The PRD `KEY-02` guide sections, in the order the guide renders them.
 *
 * Groups with no shortcuts yet (`mixer_devices`, `browser`) are declared here
 * rather than added later: the section list is the published shape of the
 * guide, and the Phase 1 tasks that own those surfaces add entries to an
 * existing group instead of inventing one.
 */
export const SHORTCUT_GROUPS = [
  "transport",
  "global_editing",
  "arrangement",
  "clips_notes",
  "automation",
  "mixer_devices",
  "browser",
  "navigation",
] as const;
export type ShortcutGroup = (typeof SHORTCUT_GROUPS)[number];

/** Human-readable section titles for the guide. */
export const SHORTCUT_GROUP_LABELS: Record<ShortcutGroup, string> = {
  transport: "Transport",
  global_editing: "Global Editing",
  arrangement: "Arrangement",
  clips_notes: "Clips and Notes",
  automation: "Automation",
  mixer_devices: "Mixer and Devices",
  browser: "Browser",
  navigation: "Navigation",
};

/**
 * How a mapping relates to Ableton Live 12, which `KEY-01` takes as its
 * baseline.
 *
 * `differs` always carries the Live combination it deviates from *and* why, so
 * "browser conflicts and Solid Groove deviations are documented rather than
 * handled inconsistently" is a property of the data, not of a wiki page that
 * can drift. `solid_groove` claims no Live baseline at all rather than
 * inventing one.
 */
export type AbletonParity =
  | { readonly kind: "follows"; readonly abletonKeys: string }
  | {
      readonly kind: "differs";
      readonly abletonKeys: string;
      readonly reason: string;
    }
  | { readonly kind: "solid_groove"; readonly reason: string };

/**
 * A browser combination Solid Groove deliberately takes over.
 *
 * Distinct from `RESERVED_CHORDS` in `registry.ts`: those the browser or OS
 * keeps for itself and the registry may never claim. These are ones a page can
 * cancel, where the PRD mapping wins — recorded so the override is a decision
 * with a reason attached rather than an accident.
 */
export interface BrowserConflict {
  readonly keys: string;
  readonly note: string;
}
