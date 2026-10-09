import { describe, expect, it } from "vitest";
import { type AssistantAsk, askTranscript } from "../../assistant/ask";
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

  it("never resends a reply that failed part-way as the answer (GRV-26)", () => {
    expect(
      historyOf([
        message("1", "Q"),
        {
          kind: "reply",
          id: "2",
          text: "Here is one idea. ",
          streaming: false,
          stopped: false,
          failed: true,
        },
        reply("3", "Here is one idea. Full reply."),
      ]),
    ).toEqual([
      { role: "user", text: "Q" },
      { role: "assistant", text: "Here is one idea. Full reply." },
    ]);
  });

  it("resends a question the reply asked with it, and an answer as what it says (GRV-42)", () => {
    const ask: AssistantAsk = {
      id: "toolu_1",
      question: "Which?",
      options: [{ label: "A" }, { label: "B" }],
      multiSelect: false,
    };
    expect(
      historyOf([
        message("1", "Help"),
        { kind: "reply", id: "2", text: "", streaming: false, stopped: false, ask },
        {
          kind: "message",
          id: "3",
          text: "A",
          scopeLabel: "BD",
          answers: "Which?",
          wire: '[Answer to "Which?"] Picked: A.',
        },
        reply("4", "Going with A."),
      ]),
    ).toEqual([
      { role: "user", text: "Help" },
      { role: "assistant", text: askTranscript(ask) },
      { role: "user", text: '[Answer to "Which?"] Picked: A.' },
      { role: "assistant", text: "Going with A." },
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
