// Clips and the notes in them: the step editor, the piano roll, and the song key
// they follow.

import { ERROR_CODES } from "../errorCodes";
import { type AnalyticsEventDefinition, bucketParam, enumParam } from "./params";

/**
 * The song key's scales, as `key_changed`'s `scale` (ARR-010). Pinned here
 * like `COMMAND_IDS` rather than imported from the domain: `catalog.test.ts`
 * asserts it equals `SCALE_IDS` exactly, so a new scale needs an analytics
 * decision in the same change.
 */
export const SCALE_KEYS = [
  "chromatic",
  "major",
  "minor",
  "dorian",
  "mixolydian",
  "harmonic_minor",
  "major_pentatonic",
  "minor_pentatonic",
  "blues",
] as const;

/**
 * One value per piano roll edit that a command can refuse (ARR-010), so a
 * refusal can be attributed to the edit that caused it without carrying the
 * command id or any clip, note, or project identity.
 */
export const NOTE_EDIT_OPERATIONS = [
  "transpose",
  "scale_velocity",
  "quantize",
  "quantize_to_scale",
  "double",
  "halve",
  "clear",
  "vary",
  "vary_velocity",
  "paste",
  "nudge",
] as const;
export type NoteEditOperation = (typeof NOTE_EDIT_OPERATIONS)[number];

/** The note editors' `feature_first_use` keys (see `FEATURE_KEYS`). */
export const CLIP_FEATURE_KEYS = [
  "step_editor",
  "piano_roll",
  "musical_key",
  "note_clipboard",
  "velocity_lane",
  "note_audition",
  // The step grid's Generate panel (#643): one key per kind of generator.
  "step_pattern",
  "step_euclidean",
  "step_random",
  "step_clear_row",
  // The Bars control the step grid and the piano roll share (#869).
  "clip_length",
] as const;

/** The note editors' shortcut actions, as `shortcut_used`'s `action_id` (see `SHORTCUT_ACTION_IDS`). */
export const CLIP_SHORTCUT_ACTION_IDS = [
  "clip.quantize",
  "clip.toggle_draw_mode",
  "note.move_up",
  "note.move_down",
  "note.octave_up",
  "note.octave_down",
  "note.move_earlier",
  "note.move_later",
  "note.shorten",
  "note.lengthen",
] as const;

export const CLIP_EVENTS = {
  clip_edited: {
    phase: 1,
    owners: ["LOOP-010", "LOOP-011"],
    params: {
      editor: enumParam(["step", "piano_roll"]),
      event_count_bucket: bucketParam("event_count"),
    },
  },

  key_changed: {
    phase: 1,
    owners: ["ARR-010"],
    // One committed change of the song's key from the piano roll. Only the
    // scale travels: which keys producers reach for, and how often they leave
    // chromatic, is the measure. The root is left out as noise.
    params: { scale: enumParam(SCALE_KEYS) },
  },

  note_edit_failed: {
    phase: 1,
    owners: ["ARR-010"],
    // A piano roll edit the command layer refused: the roll's principal
    // failure. The operation and a stable code only, never a note or a clip.
    params: {
      operation: enumParam(NOTE_EDIT_OPERATIONS),
      error_code: enumParam(ERROR_CODES),
    },
  },
} as const satisfies Record<string, AnalyticsEventDefinition>;
