// The assistant: messages, suggestions, and the proposals it makes.

import {
  type AnalyticsEventDefinition,
  bucketParam,
  enumParam,
  UNCLAIMED,
} from "./params";

/** The assistant's `feature_first_use` keys (see `FEATURE_KEYS`). */
export const ASSISTANT_FEATURE_KEYS = ["assistant"] as const;

/** The assistant panel's shortcut actions, as `shortcut_used`'s `action_id` (see `SHORTCUT_ACTION_IDS`). */
export const ASSISTANT_SHORTCUT_ACTION_IDS = [
  "assistant.toggle",
  "assistant.grow",
  "assistant.shrink",
  "assistant.grow_more",
  "assistant.shrink_more",
] as const;

/**
 * What an assistant proposal changes, as `assistant_proposal_*`'s
 * `capability`: one key per Appendix A command family the assistant's tool
 * set carries, or `mixed` for a proposal spanning several. Pinned against
 * `src/assistant/tools.ts` by `catalog.test.ts`.
 */
export const ASSISTANT_PROPOSAL_CAPABILITIES = [
  "tempo",
  "tracks",
  "clips",
  "notes",
  "placements",
  "instrument",
  "devices",
  "returns",
  "mixer",
  "mixed",
] as const;

export const ASSISTANT_EVENTS = {
  assistant_message_sent: {
    phase: 3,
    owners: ["AI-004"],
    params: { scope: enumParam(["clip", "track", "section", "song"]) },
  },

  assistant_suggestion_clicked: {
    phase: 3,
    owners: ["AI-004"],
    params: { suggestion_id: enumParam(UNCLAIMED) },
  },

  assistant_proposal_shown: {
    phase: 3,
    owners: ["AI-003"],
    params: {
      capability: enumParam(ASSISTANT_PROPOSAL_CAPABILITIES),
      command_count_bucket: bucketParam("command_count"),
    },
  },

  assistant_proposal_applied: {
    phase: 3,
    owners: ["AI-003"],
    params: {
      capability: enumParam(ASSISTANT_PROPOSAL_CAPABILITIES),
      command_count_bucket: bucketParam("command_count"),
      seconds_to_decision_bucket: bucketParam("elapsed_seconds"),
    },
  },

  assistant_proposal_cancelled: {
    phase: 3,
    owners: ["AI-003"],
    params: {
      capability: enumParam(ASSISTANT_PROPOSAL_CAPABILITIES),
      command_count_bucket: bucketParam("command_count"),
      seconds_to_decision_bucket: bucketParam("elapsed_seconds"),
    },
  },

  assistant_proposal_undone: {
    phase: 3,
    owners: ["AI-003"],
    params: {
      capability: enumParam(ASSISTANT_PROPOSAL_CAPABILITIES),
      command_count_bucket: bucketParam("command_count"),
      seconds_to_undo_bucket: bucketParam("elapsed_seconds"),
    },
  },

  assistant_result_edited: {
    phase: 3,
    owners: ["AI-004"],
    params: { capability: enumParam(UNCLAIMED) },
  },
} as const satisfies Record<string, AnalyticsEventDefinition>;
