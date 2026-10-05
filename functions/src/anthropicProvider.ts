/**
 * The production {@link AssistantProvider}: Anthropic's Messages API through
 * its official SDK (ADR 0006 decision 1). The only module that holds the API
 * key or an SDK object, and it lives in the Cloud Function, so neither can be
 * bundled into the browser.
 *
 * Two SDK defaults are turned off on purpose:
 *
 * - **Its retries.** Every provider call counts against the account's quota,
 *   retries included (ADR 0006 decision 5), so the gateway makes each retry
 *   itself and counts it. An SDK retrying underneath would spend calls
 *   nothing counted.
 * - **Its logging.** On a stream it cannot parse, the SDK logs the raw chunk,
 *   which is the model's reply; the gateway logs only its redacted record.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { MessageCreateParamsStreaming } from "@anthropic-ai/sdk/resources/messages";
import {
  type AssistantProvider,
  failureKindForStatus,
  ProviderFailure,
} from "../../src/assistant/provider";
import type { ProviderMessagesRequest } from "../../src/assistant/providerRequest";

export interface AnthropicProviderOptions {
  readonly apiKey: string;
  /** For tests: a scripted `fetch` standing in for the network. */
  readonly fetch?: typeof fetch;
  readonly baseURL?: string;
}

/** Holds the gateway's request shape to the SDK's own parameter type. */
function toSdkParams(request: ProviderMessagesRequest): MessageCreateParamsStreaming {
  return {
    ...request,
    system: [...request.system],
    messages: [...request.messages],
  };
}

/** The failure an error thrown by the SDK, or while reading its stream, means. */
export function classifySdkError(error: unknown): ProviderFailure {
  if (error instanceof ProviderFailure) return error;
  if (error instanceof Anthropic.APIConnectionError)
    return new ProviderFailure("network");
  if (error instanceof Anthropic.APIError) {
    if (typeof error.status === "number") {
      return new ProviderFailure(failureKindForStatus(error.status), error.status);
    }
    // An `error` event inside an open stream carries a type, not a status.
    const type = (error.error as { error?: { type?: unknown } } | undefined)?.error?.type;
    if (type === "overloaded_error") return new ProviderFailure("overloaded");
    if (type === "rate_limit_error") return new ProviderFailure("rate_limited");
    if (type === "api_error") return new ProviderFailure("server_error");
    return new ProviderFailure("rejected");
  }
  // Bad JSON in the stream surfaces as a `SyntaxError`; anything else that is
  // not the SDK's own error means the stream could not be read either.
  return new ProviderFailure("malformed");
}

export function createAnthropicProvider(
  options: AnthropicProviderOptions,
): AssistantProvider {
  const client = new Anthropic({
    apiKey: options.apiKey,
    maxRetries: 0,
    logLevel: "off",
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.baseURL ? { baseURL: options.baseURL } : {}),
  });
  return {
    async *stream(request, signal) {
      try {
        const stream = await client.messages.create(toSdkParams(request), { signal });
        for await (const event of stream) {
          yield event;
        }
      } catch (error) {
        if (signal.aborted) return;
        throw classifySdkError(error);
      }
    },
  };
}
