// The assistant: messages, suggestions, and the proposals it makes.

import { type AnalyticsEventDefinition, bucketParam, enumParam } from "./params";

/** The assistant's `feature_first_use` keys (see `FEATURE_KEYS`). */
export const ASSISTANT_FEATURE_KEYS = [
  "assistant",
  "assistant_message",
  "assistant_proposal",
] as const;

/** The assistant panel's shortcut actions, as `shortcut_used`'s `action_id` (see `SHORTCUT_ACTION_IDS`). */
export const ASSISTANT_SHORTCUT_ACTION_IDS = [
  "assistant.toggle",
  "assistant.grow",
  "assistant.shrink",
  "assistant.grow_more",
  "assistant.shrink_more",
  "assistant.send",
] as const;

/**
 * The suggestion chips' IDs, as `assistant_suggestion_clicked`'s
 * `suggestion_id` (GRV-26): #70's published next steps, and the panel's
 * focused ones for the view and the scope. Pinned against
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
  "vary_notes",
  "vary_clips",
  "develop_part",
  "write_fill",
  "shape_sound",
  "balance_mix",
  "find_sound",
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

  /**
   * A producer edited, by hand, a control an applied proposal changed: once
   * per proposal, which then stops being watched (GRV-5). `capability` is the
   * proposal's, as its `assistant_proposal_applied` carried it.
   */
  assistant_result_edited: {
    phase: 3,
    owners: ["AI-004"],
    params: { capability: enumParam(ASSISTANT_PROPOSAL_CAPABILITIES) },
  },
} as const satisfies Record<string, AnalyticsEventDefinition>;
