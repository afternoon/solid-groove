import { describe, expect, it } from "vitest";
import {
  ASSISTANT_HISTORY_TOKEN_BUDGET,
  ASSISTANT_MODELS,
  SMALLEST_CONTEXT_WINDOW_TOKENS,
} from "./config";
import { historyBudgetFor } from "./gateway";
import { boundHistory, estimateTokens } from "./history";
import type { AssistantMessage } from "./protocol";

const user = (text: string): AssistantMessage => ({ role: "user", text });
const assistant = (text: string): AssistantMessage => ({ role: "assistant", text });

describe("boundHistory", () => {
  it("keeps a conversation that fits, whole", () => {
    const messages = [user("a"), assistant("b"), user("c")];
    expect(boundHistory(messages, 1_000)).toEqual({ messages, dropped: 0 });
  });

  it("drops the oldest messages first and keeps the newest", () => {
    const messages = [user("x".repeat(300)), assistant("y".repeat(300)), user("newest")];
    const bounded = boundHistory(messages, 120);
    expect(bounded.messages).toEqual([user("newest")]);
    expect(bounded.dropped).toBe(2);
  });

  it("never starts the resent history with the assistant", () => {
    const messages = [user("x".repeat(300)), assistant("short"), user("newest")];
    const bounded = boundHistory(messages, 40);
    expect(bounded.messages[0].role).toBe("user");
  });

  it("returns nothing when even the newest message does not fit", () => {
    expect(boundHistory([user("x".repeat(900))], 10).messages).toEqual([]);
  });
});

describe("the history budget", () => {
  it("is sized for the smallest configured window, not the active model's", () => {
    expect(SMALLEST_CONTEXT_WINDOW_TOKENS).toBe(
      ASSISTANT_MODELS["claude-haiku-4-5"].contextWindowTokens,
    );
  });

  it("leaves room in the smallest window for the system prompt, history and reply", () => {
    const systemTokens = 20_000;
    const budget = historyBudgetFor(systemTokens);
    const reply = Math.max(
      ...Object.values(ASSISTANT_MODELS).map((m) => m.maxOutputTokens),
    );
    expect(budget).toBeLessThanOrEqual(ASSISTANT_HISTORY_TOKEN_BUDGET);
    expect(systemTokens + budget + reply).toBeLessThan(SMALLEST_CONTEXT_WINDOW_TOKENS);
  });

  it("shrinks as the project context grows, rather than overflowing", () => {
    expect(historyBudgetFor(190_000)).toBeLessThanOrEqual(0);
  });

  it("estimates conservatively: never fewer tokens than characters over four", () => {
    const text = "Push the kick up by two decibels in the chorus.";
    expect(estimateTokens(text)).toBeGreaterThanOrEqual(text.length / 4);
  });
});
