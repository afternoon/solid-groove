import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import { Analytics } from "../../analytics/analytics";
import { ConsentStore } from "../../analytics/consent";
import { createRecordingTransport } from "../../analytics/transport";
import type { AssistantAsk } from "../../assistant/ask";
import type { AssistantStopReason } from "../../assistant/protocol";
import { createSliceFixtureProject } from "../../domain/fixtures";
import { clickAndFlush, fireAndFlush } from "../../testing/events";
import {
  createFakeAssistantClient,
  type FakeAssistantClient,
  type FakeTurn,
} from "../../testing/fakeAssistantClient";
import { memoryStorage } from "../../testing/storage";
import type { EditorViewName } from "../editorViews";
import { ASK_CARD_LABEL, ASK_TEXT_LABEL, askHint } from "./AssistantAskCard";
import AssistantPanel from "./AssistantPanel";
import { useAssistantChat } from "./useAssistantChat";
import { useAssistantPanel } from "./useAssistantPanel";

afterEach(cleanup);

const ASK: AssistantAsk = {
  id: "toolu_1",
  question: "Where should the drop land?",
  context: "The build, bars 13-16",
  options: [
    { label: "Bar 17", description: "Straight after the build" },
    { label: "Bar 25" },
    { label: "Hold it back" },
  ],
  suggested: 1,
  multiSelect: false,
};

function renderChat() {
  const client: FakeAssistantClient = createFakeAssistantClient();
  const transport = createRecordingTransport();
  const analytics = new Analytics({
    transport,
    consent: new ConsentStore(memoryStorage()),
    storage: memoryStorage(),
  });
  analytics.setAccountType("registered");
  const project = createSliceFixtureProject();
  const [view] = createSignal<EditorViewName>("arrangement");
  const Harness = () => {
    const panel = useAssistantPanel({
      storage: memoryStorage(),
      analytics: () => analytics,
    });
    const chat = useAssistantChat({
      project: () => project,
      view,
      sources: () => ({ selection: null, track: project.song.tracks[0] ?? null }),
      account: () => ({ registered: true }),
      expanded: () => panel.layout().mode === "floating",
      client: async () => client,
      analytics: () => analytics,
    });
    return (
      <>
        <button type="button" onClick={(event) => panel.toggle(event.currentTarget)}>
          Open it
        </button>
        <AssistantPanel panel={panel} chat={chat} />
      </>
    );
  };
  render(() => <Harness />);
  clickAndFlush(screen.getByRole("button", { name: "Open it" }));
  return { client, transport };
}

const panel = () => screen.getByRole("region", { name: "Assistant" });
const composer = () =>
  within(panel()).getByRole("textbox", { name: "Message the assistant" });
const log = () => within(panel()).getByRole("log", { name: "Conversation" });
const card = () => within(panel()).queryByRole("region", { name: ASK_CARD_LABEL });
const inCard = () => {
  const found = card();
  if (!found) throw new Error("no question is waiting");
  return within(found);
};
const option = (name: string | RegExp) => inCard().getByRole("button", { name });
const otherText = () => inCard().getByRole("textbox", { name: ASK_TEXT_LABEL });

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function send(text: string): Promise<void> {
  fireAndFlush(() => fireEvent.input(composer(), { target: { value: text } }));
  clickAndFlush(within(panel()).getByRole("button", { name: "Send" }));
  await settle();
}

/** Finishes `turn` with a reply that ends in `ask`, as the gateway sends it. */
function ask(
  turn: FakeTurn,
  question: AssistantAsk = ASK,
  text = "One question first.",
): void {
  fireAndFlush(() => {
    if (text) turn.text(text);
    turn.emit({ type: "ask", ask: question });
    turn.emit({
      type: "done",
      stopped: false,
      stopReason: "tool_use" satisfies AssistantStopReason,
      requestsRemaining: 98,
    });
  });
}

describe("a question the assistant asks (GRV-42)", () => {
  it("waits above the composer: its header, question, numbered options and the suggested one", async () => {
    const { client, transport } = renderChat();
    await send("Build me a drop");
    ask(client.last());

    expect(card()).toBeInTheDocument();
    expect(card()).toHaveAccessibleDescription(ASK.question);
    expect(card()).toHaveTextContent("The build, bars 13-16");
    const chips = [...(card()?.querySelectorAll(".assistant-ask-option") ?? [])];
    expect(chips.map((chip) => chip.textContent)).toEqual([
      "1Bar 17Straight after the build",
      "2Bar 25Suggested",
      "3Hold it back",
    ]);
    expect(chips.map((chip) => chip.getAttribute("aria-keyshortcuts"))).toEqual([
      "1",
      "2",
      "3",
    ]);
    expect(option("Bar 17")).toHaveAccessibleDescription("Straight after the build");
    expect(option("Bar 25")).toHaveAccessibleDescription("Suggested");
    expect(option(/Bar 25/)).toHaveClass("assistant-ask-suggested-option");
    expect(option(/Bar 25/)).toHaveTextContent("Suggested");
    expect(option(/Bar 17/)).not.toHaveClass("assistant-ask-suggested-option");
    // A single choice is a set of buttons, not toggles.
    expect(option(/Bar 17/)).not.toHaveAttribute("aria-pressed");
    expect(otherText()).toBeInTheDocument();
    // The card comes before the composer, and the reply's text stays in the log.
    const position = card()?.compareDocumentPosition(composer()) ?? 0;
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(log()).toHaveTextContent("One question first.");
    expect(transport.named("assistant_ask_shown")).toHaveLength(1);
    expect(transport.named("assistant_ask_shown")[0]?.params).toMatchObject({
      option_count: 3,
      multi_select: false,
      has_suggestion: true,
    });
  });

  it("answers a single choice with a click, as the next turn", async () => {
    const { client, transport } = renderChat();
    await send("Build me a drop");
    ask(client.last());

    clickAndFlush(option(/Bar 25/));
    await settle();
    expect(card()).toBeNull();
    expect(client.turns).toHaveLength(2);
    const messages = client.last().request.messages;
    expect(messages.at(-1)).toEqual({
      role: "user",
      text: '[Answer to "Where should the drop land?"] Picked: Bar 25.',
    });
    // The question goes back with the reply, so the model reads what it asked.
    expect(messages.at(-2)?.role).toBe("assistant");
    expect(messages.at(-2)?.text).toContain("One question first.");
    expect(messages.at(-2)?.text).toContain(
      "[I asked the producer (ask_producer, pick one): Where should the drop land?",
    );
    // The log shows the answer under its question.
    expect(log()).toHaveTextContent("Answer · Where should the drop land?");
    expect(log()).toHaveTextContent("Bar 25");
    expect(log()).toHaveTextContent("Asked: Where should the drop land?");
    expect(transport.named("assistant_ask_answered")).toHaveLength(1);
    expect(transport.named("assistant_ask_answered")[0]?.params).toMatchObject({
      how: "pick",
      option_count: 3,
      suggested_taken: true,
    });
    // An answer is a message, as far as the catalog is concerned.
    expect(transport.named("assistant_message_sent")).toHaveLength(2);
    // No option text and no question in any event.
    expect(JSON.stringify(transport.events)).not.toContain("Bar 25");
    expect(JSON.stringify(transport.events)).not.toContain("drop land");
  });

  it("toggles several in a multi-select and sends them together", async () => {
    const { client, transport } = renderChat();
    await send("Which parts?");
    ask(client.last(), { ...ASK, multiSelect: true, suggested: undefined });

    const sendAnswer = inCard().getByRole("button", { name: "Send the answer" });
    expect(sendAnswer).toBeDisabled();
    clickAndFlush(option(/Hold it back/));
    clickAndFlush(option(/Bar 17/));
    clickAndFlush(option(/Hold it back/));
    clickAndFlush(option(/Bar 25/));
    expect(option(/Bar 17/)).toHaveAttribute("aria-pressed", "true");
    expect(option(/Bar 25/)).toHaveAttribute("aria-pressed", "true");
    expect(option(/Hold it back/)).toHaveAttribute("aria-pressed", "false");
    // Nothing is sent until Send.
    expect(client.turns).toHaveLength(1);

    clickAndFlush(sendAnswer);
    await settle();
    expect(client.last().request.messages.at(-1)?.text).toBe(
      '[Answer to "Where should the drop land?"] Picked: Bar 17, Bar 25.',
    );
    expect(transport.named("assistant_ask_answered")[0]?.params).toMatchObject({
      how: "pick",
      suggested_taken: false,
    });
  });

  it("takes an answer in the producer's own words", async () => {
    const { client, transport } = renderChat();
    await send("Build me a drop");
    ask(client.last());

    fireAndFlush(() =>
      fireEvent.input(otherText(), { target: { value: "Bar 21, short" } }),
    );
    clickAndFlush(inCard().getByRole("button", { name: "Send the answer" }));
    await settle();
    expect(card()).toBeNull();
    expect(client.last().request.messages.at(-1)?.text).toBe(
      '[Answer to "Where should the drop land?"] Bar 21, short',
    );
    expect(log()).toHaveTextContent("Bar 21, short");
    expect(transport.named("assistant_ask_answered")[0]?.params).toMatchObject({
      how: "text",
      suggested_taken: false,
    });
    expect(JSON.stringify(transport.events)).not.toContain("Bar 21");
  });

  it("stays pending while the producer says something else, and the assistant gets both", async () => {
    const { client } = renderChat();
    await send("Build me a drop");
    ask(client.last());

    await send("Actually, is the kick too loud?");
    // The question is still waiting, and the message went with it in the history.
    expect(card()).toBeInTheDocument();
    const second = client.last().request.messages;
    expect(second.at(-1)?.text).toBe("Actually, is the kick too loud?");
    expect(second.at(-2)?.text).toContain("[I asked the producer");

    // While that reply streams, the question cannot be answered yet.
    fireAndFlush(() => client.last().text("A little."));
    expect(option(/Bar 17/)).toBeDisabled();
    expect(otherText()).toBeDisabled();
    fireAndFlush(() => client.last().done());
    expect(option(/Bar 17/)).toBeEnabled();

    clickAndFlush(option(/Bar 17/));
    await settle();
    const third = client.last().request.messages;
    expect(third.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
      "user",
    ]);
    expect(third.at(-1)?.text).toBe(
      '[Answer to "Where should the drop land?"] Picked: Bar 17.',
    );
  });

  it("is dismissed without sending anything", async () => {
    const { client, transport } = renderChat();
    await send("Build me a drop");
    ask(client.last());

    clickAndFlush(inCard().getByRole("button", { name: "Dismiss the question" }));
    expect(card()).toBeNull();
    expect(client.turns).toHaveLength(1);
    expect(transport.named("assistant_ask_answered")[0]?.params).toMatchObject({
      how: "dismissed",
      option_count: 3,
      suggested_taken: false,
    });
    // The reply keeps the question it asked.
    expect(log()).toHaveTextContent("Asked: Where should the drop land?");
  });

  it("shows only the card for a reply that only asked", async () => {
    const { client } = renderChat();
    await send("Build me a drop");
    ask(client.last(), ASK, "");
    expect(card()).toBeInTheDocument();
    expect(log().querySelectorAll(".assistant-reply")).toHaveLength(0);
    // The question still goes back as the assistant's turn.
    clickAndFlush(option(/Bar 17/));
    await settle();
    expect(client.last().request.messages.at(-2)?.text).toMatch(
      /^\[I asked the producer/,
    );
  });

  it("starts a newer question empty, in place of the one still waiting", async () => {
    const { client, transport } = renderChat();
    await send("Which parts?");
    ask(client.last(), { ...ASK, multiSelect: true });
    clickAndFlush(option(/Bar 17/));
    await send("Never mind that");
    ask(client.last(), {
      ...ASK,
      id: "toolu_2",
      question: "How long a build?",
      multiSelect: true,
    });

    expect(card()).toHaveAccessibleDescription("How long a build?");
    expect(option(/Bar 17/)).toHaveAttribute("aria-pressed", "false");
    expect(transport.named("assistant_ask_shown")).toHaveLength(2);
    expect(transport.named("assistant_ask_answered")).toHaveLength(0);
  });

  it("takes focus from an empty composer, so its keys work at once", async () => {
    const { client } = renderChat();
    await send("Build me a drop");
    expect(composer()).toHaveFocus();
    ask(client.last());
    expect(card()).toHaveFocus();
  });

  it("leaves focus in a composer that is being written in", async () => {
    const { client } = renderChat();
    await send("Build me a drop");
    fireAndFlush(() => fireEvent.input(composer(), { target: { value: "And also" } }));
    ask(client.last());
    expect(composer()).toHaveFocus();
  });
});

describe("askHint (GRV-42)", () => {
  it("numbers the keys as far as the question's options go", () => {
    expect(askHint(3, false)).toBe("Pick one · 1–3 picks");
    expect(askHint(8, true)).toBe("Pick any · 1–8 toggle · Enter sends");
    expect(askHint(1, false)).toBe("Pick one · 1 picks");
  });
});
