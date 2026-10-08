/**
 * The assistant's provider in the Firebase emulator (GRV-26): a scripted
 * stand-in that answers every turn from a fixed script chosen by the user's
 * last message, so the browser suite can drive the real gateway (its
 * validation, guards, streaming and errors) with no key and no network.
 *
 * `functions/src/index.ts` uses it only when the function runs in the
 * emulator with no `ANTHROPIC_API_KEY` set; a key in `functions/.secret.local`
 * still reaches the real provider (docs/runbooks/assistant-gateway.md). It is
 * never chosen in production.
 *
 * What a message asks for, by a marker anywhere in it:
 *
 * - `[hang]`: one chunk, then nothing until the browser stops the turn.
 * - `[flaky]`: the first turn with this exact message breaks after its first
 *   chunk, which the gateway cannot retry and reports as
 *   `provider_unavailable` (retryable); every later turn with it succeeds.
 *   Make the message unique per test.
 * - `[propose]`: a short reply that ends in a tool call, so the turn returns
 *   a proposal.
 * - anything else: a short reply, streamed in pieces with a pause between.
 *
 * Like the rest of `src/assistant`, it imports no Firebase and no SDK.
 */
import type { AssistantProvider } from "./provider";
import { ProviderFailure } from "./provider";
import type { ProviderMessagesRequest } from "./providerRequest";

/** The reply every ordinary turn streams, piece by piece. */
export const EMULATOR_REPLY_CHUNKS = [
  "Here is one idea. ",
  "Try a small change first, ",
  "then listen to it in the loop.",
] as const;

/** How long the scripted reply pauses between pieces, in milliseconds. */
export const EMULATOR_CHUNK_PAUSE_MS = 120;

type Step =
  | { readonly event: unknown }
  | { readonly wait: number }
  | { readonly hang: true }
  | { readonly fail: true };

function textReply(chunks: readonly string[], stopReason = "end_turn"): Step[] {
  return [
    {
      event: {
        type: "message_start",
        message: { id: "msg_emulator", usage: { input_tokens: 100, output_tokens: 1 } },
      },
    },
    { event: { type: "content_block_start", index: 0, content_block: { type: "text" } } },
    ...chunks.flatMap((text, index): Step[] => [
      ...(index === 0 ? [] : [{ wait: EMULATOR_CHUNK_PAUSE_MS }]),
      {
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text },
        },
      },
    ]),
    { event: { type: "content_block_stop", index: 0 } },
    {
      event: {
        type: "message_delta",
        delta: { stop_reason: stopReason },
        usage: { output_tokens: 20 },
      },
    },
    { event: { type: "message_stop" } },
  ];
}

function proposalReply(): Step[] {
  const reply = textReply(["I can set the tempo to 100 BPM."], "tool_use");
  const toolCall: Step[] = [
    {
      event: {
        type: "content_block_start",
        index: 1,
        content_block: {
          type: "tool_use",
          id: "toolu_emulator",
          name: "parameter_set",
          input: {},
        },
      },
    },
    {
      event: {
        type: "content_block_delta",
        index: 1,
        delta: {
          type: "input_json_delta",
          partial_json: JSON.stringify({
            target: { kind: "song", parameter: "tempo" },
            value: 100,
          }),
        },
      },
    },
    { event: { type: "content_block_stop", index: 1 } },
  ];
  // The text block, then the tool call, then the stop.
  return [...reply.slice(0, -2), ...toolCall, ...reply.slice(-2)];
}

function lastUserMessage(request: ProviderMessagesRequest): string {
  for (let index = request.messages.length - 1; index >= 0; index -= 1) {
    const message = request.messages[index];
    if (message?.role === "user") return message.content;
  }
  return "";
}

/** A provider that answers from the scripts above. Holds `[flaky]`'s memory. */
export function createEmulatorAssistantProvider(): AssistantProvider {
  const failedOnce = new Set<string>();

  function scriptFor(message: string): Step[] {
    if (message.includes("[hang]")) {
      return [...textReply([EMULATOR_REPLY_CHUNKS[0]]).slice(0, 3), { hang: true }];
    }
    if (message.includes("[flaky]") && !failedOnce.has(message)) {
      failedOnce.add(message);
      return [...textReply([EMULATOR_REPLY_CHUNKS[0]]).slice(0, 3), { fail: true }];
    }
    if (message.includes("[propose]")) return proposalReply();
    return textReply(EMULATOR_REPLY_CHUNKS);
  }

  return {
    stream(request, signal) {
      const script = scriptFor(lastUserMessage(request));
      return (async function* () {
        for (const step of script) {
          if (signal.aborted) return;
          if ("event" in step) {
            yield step.event;
          } else if ("wait" in step) {
            await new Promise<void>((resolve) => {
              const timer = setTimeout(resolve, step.wait);
              signal.addEventListener(
                "abort",
                () => {
                  clearTimeout(timer);
                  resolve();
                },
                { once: true },
              );
            });
          } else if ("hang" in step) {
            await new Promise<void>((resolve) => {
              if (signal.aborted) resolve();
              else signal.addEventListener("abort", () => resolve(), { once: true });
            });
            return;
          } else {
            throw new ProviderFailure("server_error", 500);
          }
        }
      })();
    },
  };
}

/**
 * Whether the function should answer from the emulator's script: it runs in
 * the Firebase emulator and no real key was supplied.
 */
export function usesEmulatorProvider(
  env: Readonly<Record<string, string | undefined>>,
  apiKey: string,
): boolean {
  return env.FUNCTIONS_EMULATOR === "true" && apiKey.trim().length === 0;
}
