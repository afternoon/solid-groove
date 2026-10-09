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
 *
 * Every turn offers the model the assistant's tool set (GRV-4, `tools.ts`),
 * so it can answer a request to change the song with a proposal, and
 * `explain_change`, which says what that proposal is for. The tool
 * set's version is not on the wire (the Messages API has nowhere to put it);
 * the gateway stamps it on the proposal it returns instead.
 */
import type { AssistantModelProfile } from "./config";
import type { AssistantToolDefinition } from "./tools";

export interface ProviderTextBlock {
  readonly type: "text";
  readonly text: string;
}

export interface ProviderMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
}

/** A tool's input schema: a JSON Schema object, as the API requires. */
export interface ProviderToolInputSchema {
  readonly type: "object";
  readonly [keyword: string]: unknown;
}

/** One tool, in the Messages API's wire shape. */
export interface ProviderTool {
  readonly name: string;
  readonly description: string;
  readonly input_schema: ProviderToolInputSchema;
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
  /**
   * Mutable only because the SDK's parameter type is: the Cloud Function
   * spreads this body into it as it is.
   */
  readonly tools: ProviderTool[];
  readonly thinking: ProviderThinking;
  readonly output_config?: { readonly effort: "low" | "medium" | "high" };
  /** A pseudonymous ID for the account, for the provider's abuse detection. */
  readonly metadata: { readonly user_id: string };
}

export interface ProviderRequestParts {
  readonly system: readonly ProviderTextBlock[];
  readonly messages: readonly ProviderMessage[];
  readonly tools: readonly ProviderTool[];
  readonly pseudonymousUserId: string;
}

/** What any offered tool has, a proposal tool or `ask_producer` (GRV-42). */
export type OfferedTool = Pick<
  AssistantToolDefinition,
  "name" | "description" | "inputSchema"
>;

/** The assistant's tools in the wire shape, in the order they are offered. */
export function providerTools(tools: readonly OfferedTool[]): ProviderTool[] {
  return tools.map((tool) => {
    if (tool.inputSchema.type !== "object") {
      throw new TypeError(`Tool "${tool.name}" does not take an object`);
    }
    return {
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema as ProviderToolInputSchema,
    };
  });
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
    tools: [...parts.tools],
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
