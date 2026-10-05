/**
 * The provider request, built per model (ADR 0006 decision 3).
 *
 * The models under evaluation do not take the same body: Claude Sonnet 5
 * thinks adaptively and takes `output_config.effort`; Claude Haiku 4.5
 * rejects `effort` and wants a thinking budget instead. The shape comes from
 * the model's {@link AssistantModelProfile}, never from the model ID alone,
 * so changing {@link ASSISTANT_MODEL_ID} can never send one model the
 * other's request.
 *
 * The body is plain data in the Messages API's wire shape. The Cloud Function
 * hands it to the provider's SDK as it is, and the typecheck there holds this
 * shape to the SDK's own parameter type.
 */
import type { AssistantModelProfile } from "./config";

export interface ProviderTextBlock {
  readonly type: "text";
  readonly text: string;
}

export interface ProviderMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
}

export type ProviderThinking =
  | { readonly type: "adaptive" }
  | { readonly type: "enabled"; readonly budget_tokens: number };

export interface ProviderMessagesRequest {
  readonly model: string;
  readonly max_tokens: number;
  readonly stream: true;
  readonly system: readonly ProviderTextBlock[];
  readonly messages: readonly ProviderMessage[];
  readonly thinking: ProviderThinking;
  readonly output_config?: { readonly effort: "low" | "medium" | "high" };
  /** A pseudonymous ID for the account, for the provider's abuse detection. */
  readonly metadata: { readonly user_id: string };
}

export interface ProviderRequestParts {
  readonly system: readonly ProviderTextBlock[];
  readonly messages: readonly ProviderMessage[];
  readonly pseudonymousUserId: string;
}

/** The request body for one provider call to `model`. */
export function buildProviderRequest(
  model: AssistantModelProfile,
  parts: ProviderRequestParts,
): ProviderMessagesRequest {
  const base = {
    model: model.id,
    max_tokens: model.maxOutputTokens,
    stream: true as const,
    system: parts.system,
    messages: parts.messages,
    metadata: { user_id: parts.pseudonymousUserId },
  };
  switch (model.thinking.kind) {
    case "adaptive":
      return {
        ...base,
        thinking: { type: "adaptive" },
        output_config: { effort: model.thinking.effort },
      };
    case "budget":
      return {
        ...base,
        thinking: { type: "enabled", budget_tokens: model.thinking.budgetTokens },
      };
  }
}
