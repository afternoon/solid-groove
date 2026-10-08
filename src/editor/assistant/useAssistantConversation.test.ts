import { describe, expect, it } from "vitest";
import { ASSISTANT_REQUEST_LIMITS } from "../../assistant/config";
import { type ConversationEntry, historyOf } from "./useAssistantConversation";

const message = (id: string, text: string): ConversationEntry => ({
  kind: "message",
  id,
  text,
  scopeLabel: "BD",
});
const reply = (id: string, text: string): ConversationEntry => ({
  kind: "reply",
  id,
  text,
  streaming: false,
  stopped: false,
});

describe("the conversation a turn resends", () => {
  it("keeps each message that got a reply, with the reply", () => {
    expect(
      historyOf([
        message("1", "One"),
        reply("2", "Reply"),
        message("3", "Failed"),
        {
          kind: "error",
          id: "4",
          error: { code: "timeout", retryable: true },
          request: null as never,
        },
        message("5", "Stopped early"),
        { kind: "reply", id: "6", text: "", streaming: false, stopped: true },
      ]),
    ).toEqual([
      { role: "user", text: "One" },
      { role: "assistant", text: "Reply" },
    ]);
  });

  it("leaves room for the new message, in whole exchanges", () => {
    const entries = Array.from({ length: 150 }, (_, index) => [
      message(`m${index}`, `Q${index}`),
      reply(`r${index}`, `A${index}`),
    ]).flat();
    const history = historyOf(entries);
    expect(history.length).toBeLessThan(ASSISTANT_REQUEST_LIMITS.maxMessages);
    expect(history.length % 2).toBe(0);
    expect(history[0]?.role).toBe("user");
    expect(history.at(-1)).toEqual({ role: "assistant", text: "A149" });
  });
});
