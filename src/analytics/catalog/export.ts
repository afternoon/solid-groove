// Export: rendering the song, or its stems, to files.

import { ERROR_CODES } from "../errorCodes";
import {
  type AnalyticsEventDefinition,
  boolParam,
  bucketParam,
  enumParam,
  optionalCountParam,
} from "./params";

/** Export's `feature_first_use` keys (see `FEATURE_KEYS`). */
export const EXPORT_FEATURE_KEYS = [
  "export_stereo",
  "export_stems",
  "export_stems_selection",
  // An export of a project with sounds it reports missing, which renders
  // around them rather than failing (#78).
  "export_with_missing_sounds",
] as const;

/** The Export dialog's shortcut actions, as `shortcut_used`'s `action_id` (see `SHORTCUT_ACTION_IDS`). */
export const EXPORT_SHORTCUT_ACTION_IDS = [
  "export.focus_previous",
  "export.focus_next",
  "export.extend_previous",
  "export.extend_next",
  "export.toggle_focused",
  "export.pick_all",
] as const;

export const EXPORT_EVENTS = {
  export_started: {
    phase: 2,
    owners: ["EXP-002", "EXP-003", "EXP-004", "#78"],
    params: {
      export_type: enumParam(["stereo", "stems"]),
      duration_bucket: bucketParam("musical_duration"),
      track_count_bucket: bucketParam("track_count"),
      // Stems only (EXP-004): how many ZIPs the export is split into.
      zip_count: optionalCountParam(32),
      // How many sounds the project reports missing, which the export renders
      // around if they cannot load (#78). Absent when none are.
      missing_sound_count: optionalCountParam(100),
    },
  },

  export_completed: {
    phase: 2,
    owners: ["EXP-002", "EXP-003"],
    params: {
      export_type: enumParam(["stereo", "stems"]),
      elapsed_ms_bucket: bucketParam("elapsed_ms"),
      zip_count: optionalCountParam(32),
    },
  },

  export_failed: {
    phase: 2,
    owners: ["EXP-002", "EXP-003"],
    params: {
      export_type: enumParam(["stereo", "stems"]),
      error_code: enumParam(ERROR_CODES),
      was_cancelled: boolParam(),
    },
  },
} as const satisfies Record<string, AnalyticsEventDefinition>;
