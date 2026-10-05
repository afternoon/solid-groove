// The arrangement: placements on the timeline, sections and automation.

import {
  type AnalyticsEventDefinition,
  bucketParam,
  countParam,
  enumParam,
  UNCLAIMED,
} from "./params";

/** The arrangement's `feature_first_use` keys (see `FEATURE_KEYS`). */
export const ARRANGEMENT_FEATURE_KEYS = [
  "arrangement",
  "arrangement_selection",
  "arrangement_toggle_select",
  "arrangement_extend_select",
  "arrangement_drag_copy",
  "arrangement_create_clip",
  "arrangement_clip_list",
  "arrangement_clip_resize",
  "sections",
  "automation",
] as const;

/** The arrangement's shortcut actions, as `shortcut_used`'s `action_id` (see `SHORTCUT_ACTION_IDS`). */
export const ARRANGEMENT_SHORTCUT_ACTION_IDS = [
  "arrangement.split_clip",
  "arrangement.toggle_loop",
  "arrangement.toggle_automation_view",
  "arrangement.loop_move_earlier",
  "arrangement.loop_move_later",
  "arrangement.loop_shorten",
  "arrangement.loop_lengthen",
  "arrangement.clip_previous",
  "arrangement.clip_next",
  "arrangement.clip_extend_previous",
  "arrangement.clip_extend_next",
  "arrangement.clip_shorten",
  "arrangement.clip_lengthen",
  "arrangement.clip_start_earlier",
  "arrangement.clip_start_later",
] as const;

export const ARRANGEMENT_EVENTS = {
  placement_duplicated: {
    phase: 2,
    owners: ["ARR-002", "ARR-011"],
    // CLP-01 requires duplicating a placement to be able to either reuse the
    // source clip or fork an independent variation, with the UI saying which
    // will happen. `mode` is how we learn whether producers actually reach for
    // reuse — the whole point of clips being reusable — or always fork.
    params: { mode: enumParam(["linked", "independent"]) },
  },

  section_created: {
    phase: 2,
    owners: ["ARR-003"],
    params: { origin: enumParam(["manual", "template", "assistant"]) },
  },

  arrangement_outline_created: {
    phase: 2,
    owners: ["ARR-003"],
    params: {
      template_id: enumParam(UNCLAIMED),
      section_count: countParam(64),
    },
  },

  automation_lane_created: {
    phase: 2,
    owners: ["ARR-004"],
    params: {
      target_kind: enumParam(["track", "device", "return", "master"]),
    },
  },

  arrangement_milestone: {
    phase: 2,
    owners: ["ARR-003"],
    params: {
      section_count: countParam(64),
      duration_bucket: bucketParam("musical_duration"),
    },
  },
} as const satisfies Record<string, AnalyticsEventDefinition>;
