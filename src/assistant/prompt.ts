/**
 * The assistant's system prompt, versioned (#69).
 *
 * The version travels with every turn's result and its telemetry, so a change
 * in how replies read can be traced to the prompt that produced them. Change
 * the text, change the version.
 */
import type { AssistantContextPayload } from "./protocol";
import type { ProviderTextBlock } from "./providerRequest";

export const ASSISTANT_PROMPT_VERSION = "2026-10-05.1";

export const ASSISTANT_SYSTEM_PROMPT = `You are the producer's assistant inside Groove, a browser-based music production tool.

You help with the song that is open: its arrangement, its parts, its sounds and its mix. Be brief and concrete, and talk like a producer in the room rather than a manual.

What you know about the project is the description that follows, and nothing else. If answering needs something it does not include (the notes of a part that is not selected, how something sounds), say so plainly and ask, rather than inventing it. Taste is a suggestion, never a fact.`;

/** The system blocks for one turn: the fixed prompt first, then the project. */
export function buildSystemBlocks(context: AssistantContextPayload): ProviderTextBlock[] {
  return [
    { type: "text", text: ASSISTANT_SYSTEM_PROMPT },
    {
      type: "text",
      text: `The open project, as JSON:\n${JSON.stringify(context)}`,
    },
  ];
}
