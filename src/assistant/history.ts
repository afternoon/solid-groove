/**
 * The bound on conversation history resent per turn (ADR 0006 decision 3).
 *
 * The provider is stateless, so every turn resends the conversation. Left
 * alone that grows with the session until it overflows the smaller model's
 * window, which would only show the moment the model is swapped. So the
 * oldest messages are dropped until what is sent fits the budget, and the
 * user's newest message is always kept.
 */
import { ESTIMATED_CHARS_PER_TOKEN } from "./config";
import type { AssistantMessage } from "./protocol";

/** A conservative token estimate for `text` (see `ESTIMATED_CHARS_PER_TOKEN`). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / ESTIMATED_CHARS_PER_TOKEN);
}

/** Per-message overhead the wire format adds around the text. */
const MESSAGE_OVERHEAD_TOKENS = 8;

export interface BoundedHistory {
  readonly messages: readonly AssistantMessage[];
  /** How many of the oldest messages were left out. */
  readonly dropped: number;
}

/**
 * The newest suffix of `messages` that fits `budgetTokens`, starting with a
 * user message (the provider requires the conversation to open with one).
 * Returns no messages at all when even the newest one does not fit; the
 * caller decides what that means.
 */
export function boundHistory(
  messages: readonly AssistantMessage[],
  budgetTokens: number,
): BoundedHistory {
  let used = 0;
  let start = messages.length;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const cost = estimateTokens(messages[index].text) + MESSAGE_OVERHEAD_TOKENS;
    if (used + cost > budgetTokens) break;
    used += cost;
    start = index;
  }
  while (start < messages.length && messages[start].role !== "user") start += 1;
  return { messages: messages.slice(start), dropped: start };
}
