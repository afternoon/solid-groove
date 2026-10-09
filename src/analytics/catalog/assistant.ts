// The assistant: messages, suggestions, the questions it asks, and the
// proposals it makes.

import {
  type AnalyticsEventDefinition,
  boolParam,
  bucketParam,
  countParam,
  enumParam,
  UNCLAIMED,
} from "./params";

/** The assistant's `feature_first_use` keys (see `FEATURE_KEYS`). */
export const ASSISTANT_FEATURE_KEYS = [
  "assistant",
  "assistant_message",
  "assistant_ask",
] as const;

/**
 * How the producer answered a question the assistant asked (GRV-42), as
 * `assistant_ask_answered`'s `how`: picked an option (with or without typing
 * too), typed an answer of their own, made the change in the editor instead,
 * or dismissed it.
 */
export const ASSISTANT_ASK_ANSWERS = ["pick", "text", "did_it", "dismissed"] as const;

/** The most options a question can offer (`ASK_LIMITS.maxOptions`). */
const MAX_ASK_OPTIONS = 8;

/** The assistant panel's shortcut actions, as `shortcut_used`'s `action_id` (see `SHORTCUT_ACTION_IDS`). */
export const ASSISTANT_SHORTCUT_ACTION_IDS = [
  "assistant.toggle",
  "assistant.grow",
  "assistant.shrink",
  "assistant.grow_more",
  "assistant.shrink_more",
  "assistant.send",
  "assistant.ask_option_1",
  "assistant.ask_option_2",
  "assistant.ask_option_3",
  "assistant.ask_option_4",
  "assistant.ask_option_5",
  "assistant.ask_option_6",
  "assistant.ask_option_7",
  "assistant.ask_option_8",
  "assistant.ask_finish",
  "assistant.ask_hear",
] as const;

/**
 * The suggestion chips' IDs, as `assistant_suggestion_clicked`'s
 * `suggestion_id` (GRV-26): #70's published next steps. Pinned against
 * `SUGGESTION_IDS` in `src/projection/projectAnalysisProjection.ts` by
 * `catalog.test.ts`, so a suggestion added there needs a decision here.
 */
export const ASSISTANT_SUGGESTION_IDS = [
  "create_arrangement",
  "add_variation",
  "build_transition",
  "balance_section",
  "add_track",
  "fill_empty_track",
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
    params: { suggestion_id: enumParam(ASSISTANT_SUGGESTION_IDS) },
  },

  // A question the assistant asked (GRV-42). Never its wording, an option's,
  // or what the producer typed: only how many options it had and how it was
  // answered.
  assistant_ask_shown: {
    phase: 3,
    owners: ["AI-004"],
    params: {
      option_count: countParam(MAX_ASK_OPTIONS),
      multi_select: boolParam(),
      has_suggestion: boolParam(),
    },
  },

  assistant_ask_answered: {
    phase: 3,
    owners: ["AI-004"],
    params: {
      how: enumParam(ASSISTANT_ASK_ANSWERS),
      option_count: countParam(MAX_ASK_OPTIONS),
      suggested_taken: boolParam(),
    },
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
