/**
 * A scripted stand-in for the assistant's model provider (#69). Tests describe
 * each provider call as a list of steps (wire events to yield, a failure to
 * throw, a hang) and the provider plays them back in order, one script per
 * call, recording every request it was given. No key, no network.
 */
import type { AssistantProvider } from "../assistant/provider";
import { ProviderFailure, type ProviderFailureKind } from "../assistant/provider";
import type { ProviderMessagesRequest } from "../assistant/providerRequest";

export type ScriptStep =
  | { readonly event: unknown }
  | { readonly fail: ProviderFailureKind; readonly status?: number }
  /** Never yields again until the call is aborted. */
  | { readonly hang: true }
  /** Pauses this long (real milliseconds) before the next step. */
  | { readonly wait: number }
  /** Ends the stream here, complete or not. */
  | { readonly end: true };

export type CallScript = readonly ScriptStep[];

export interface ScriptedAssistantProvider extends AssistantProvider {
  readonly requests: ProviderMessagesRequest[];
  /** How many calls were aborted while still running. */
  readonly aborted: number;
}

/** The wire events of a whole, successful reply made of `chunks`. */
export function replyEvents(
  chunks: readonly string[],
  options: {
    stopReason?: string;
    inputTokens?: number;
    outputTokens?: number;
    withThinking?: boolean;
  } = {},
): ScriptStep[] {
  const thinking: ScriptStep[] = options.withThinking
    ? [
        {
          event: {
            type: "content_block_start",
            index: 0,
            content_block: { type: "thinking" },
          },
        },
        {
          event: {
            type: "content_block_delta",
            index: 0,
            delta: { type: "thinking_delta", thinking: "private reasoning" },
          },
        },
        { event: { type: "content_block_stop", index: 0 } },
      ]
    : [];
  const textIndex = options.withThinking ? 1 : 0;
  return [
    {
      event: {
        type: "message_start",
        message: {
          id: "msg_scripted",
          usage: { input_tokens: options.inputTokens ?? 100, output_tokens: 1 },
        },
      },
    },
    ...thinking,
    {
      event: {
        type: "content_block_start",
        index: textIndex,
        content_block: { type: "text" },
      },
    },
    ...chunks.map((text) => ({
      event: {
        type: "content_block_delta",
        index: textIndex,
        delta: { type: "text_delta", text },
      },
    })),
    { event: { type: "content_block_stop", index: textIndex } },
    {
      event: {
        type: "message_delta",
        delta: { stop_reason: options.stopReason ?? "end_turn" },
        usage: { output_tokens: options.outputTokens ?? 20 },
      },
    },
    { event: { type: "message_stop" } },
  ];
}

export function createScriptedAssistantProvider(
  scripts: readonly CallScript[],
): ScriptedAssistantProvider {
  const requests: ProviderMessagesRequest[] = [];
  let aborted = 0;
  let call = 0;
  return {
    requests,
    get aborted() {
      return aborted;
    },
    stream(request, signal) {
      requests.push(request);
      const script = scripts[call] ?? scripts[scripts.length - 1] ?? [];
      call += 1;
      return (async function* () {
        for (const step of script) {
          if (signal.aborted) {
            aborted += 1;
            return;
          }
          if ("event" in step) {
            await Promise.resolve();
            yield step.event;
          } else if ("fail" in step) {
            throw new ProviderFailure(step.fail, step.status ?? null);
          } else if ("wait" in step) {
            await new Promise<void>((resolve) => setTimeout(resolve, step.wait));
          } else if ("hang" in step) {
            await new Promise<void>((resolve) =>
              signal.addEventListener("abort", () => resolve(), { once: true }),
            );
            aborted += 1;
            return;
          } else {
            return;
          }
        }
      })();
    },
  };
}
