import { describe, expect, it } from "vitest";
import { ASSISTANT_MODEL_ID, ASSISTANT_MODELS, type AssistantModelId } from "./config";
import { buildProviderRequest, type ProviderRequestParts } from "./providerRequest";

const parts: ProviderRequestParts = {
  system: [{ type: "text", text: "system" }],
  messages: [{ role: "user", content: "hello" }],
  pseudonymousUserId: "abc123",
};

/**
 * One test per configured model (ADR 0006 decision 3). Adding a model to
 * `ASSISTANT_MODELS` without pinning its request here fails the last test.
 */
const PINNED: Record<AssistantModelId, () => void> = {
  "claude-sonnet-5": () => {
    expect(buildProviderRequest(ASSISTANT_MODELS["claude-sonnet-5"], parts)).toEqual({
      model: "claude-sonnet-5",
      max_tokens: 16_000,
      stream: true,
      system: parts.system,
      messages: parts.messages,
      metadata: { user_id: "abc123" },
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
    });
  },
  "claude-haiku-4-5": () => {
    const body = buildProviderRequest(ASSISTANT_MODELS["claude-haiku-4-5"], parts);
    expect(body).toEqual({
      model: "claude-haiku-4-5",
      max_tokens: 16_000,
      stream: true,
      system: parts.system,
      messages: parts.messages,
      metadata: { user_id: "abc123" },
      thinking: { type: "enabled", budget_tokens: 4_096 },
    });
    // Haiku 4.5 rejects `effort`; the budget must sit under `max_tokens`.
    expect(body).not.toHaveProperty("output_config");
    expect(body.thinking.type === "enabled" && body.thinking.budget_tokens).toBeLessThan(
      body.max_tokens,
    );
  },
};

describe("buildProviderRequest", () => {
  it("shapes Claude Sonnet 5's request: adaptive thinking and an effort", () => {
    PINNED["claude-sonnet-5"]();
  });

  it("shapes Claude Haiku 4.5's request: a thinking budget and no effort", () => {
    PINNED["claude-haiku-4-5"]();
  });

  it("pins a request shape for every configured model", () => {
    expect(Object.keys(PINNED).sort()).toEqual(Object.keys(ASSISTANT_MODELS).sort());
  });

  it("answers with a configured model", () => {
    expect(ASSISTANT_MODELS[ASSISTANT_MODEL_ID]).toBeDefined();
  });
});
