import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Analytics } from "../../analytics/analytics";
import { ConsentStore } from "../../analytics/consent";
import { createRecordingTransport } from "../../analytics/transport";
import type { AssistantErrorDetails } from "../../assistant/protocol";
import type { Clip, Project } from "../../domain/entities";
import { createSliceFixtureProject } from "../../domain/fixtures";
import { clickAndFlush, fireAndFlush } from "../../testing/events";
import {
  createFakeAssistantClient,
  type FakeAssistantClient,
} from "../../testing/fakeAssistantClient";
import { memoryStorage } from "../../testing/storage";
import type { EditorViewName } from "../editorViews";
import { SIGN_IN_NOTE, WRITING_STATUS } from "./AssistantChatView";
import AssistantPanel from "./AssistantPanel";
import { ERROR_REASSURANCE } from "./assistantErrorCopy";
import type { ScopeSelection } from "./assistantScope";
import { type AssistantAccount, useAssistantChat } from "./useAssistantChat";
import { useAssistantPanel } from "./useAssistantPanel";

afterEach(cleanup);

function recordingAnalytics() {
  const transport = createRecordingTransport();
  const analytics = new Analytics({
    transport,
    consent: new ConsentStore(memoryStorage()),
    storage: memoryStorage(),
  });
  analytics.setAccountType("registered");
  return { analytics, transport };
}

interface Options {
  readonly account?: AssistantAccount;
  readonly project?: Project;
}

/** The panel, open, over a conversation with a fake client. */
function renderChat(options: Options = {}) {
  const client: FakeAssistantClient = createFakeAssistantClient();
  const { analytics, transport } = recordingAnalytics();
  const project = options.project ?? createSliceFixtureProject();
  const [selection, setSelection] = createSignal<ScopeSelection | null>(null);
  const [view] = createSignal<EditorViewName>("arrangement");
  const [account, setAccount] = createSignal<AssistantAccount>(
    options.account ?? { registered: true },
  );
  const Harness = () => {
    const panel = useAssistantPanel({
      storage: memoryStorage(),
      analytics: () => analytics,
    });
    const chat = useAssistantChat({
      project: () => project,
      view,
      sources: () => ({ selection: selection(), track: project.song.tracks[0] ?? null }),
      account,
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
  return { client, transport, project, setSelection, setAccount };
}

const panel = () => screen.getByRole("region", { name: "Assistant" });
const composer = () =>
  within(panel()).getByRole("textbox", { name: "Message the assistant" });
const log = () => within(panel()).getByRole("log", { name: "Conversation" });
const button = (name: string | RegExp) => within(panel()).getByRole("button", { name });
const scopeChip = () => button(/^Scope:/);
const status = () => panel().querySelector(".assistant-panel-status")?.textContent ?? "";

/** The client resolves on a microtask, so a turn is sent a tick after Send. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function type(text: string): Promise<void> {
  fireAndFlush(() => fireEvent.input(composer(), { target: { value: text } }));
}

async function send(text: string): Promise<void> {
  await type(text);
  clickAndFlush(button("Send"));
  await settle();
}

function clipOf(project: Project): Clip {
  const clip = project.clips[0];
  if (!clip) throw new Error("the fixture has no clip");
  return clip;
}

function noteIds(project: Project): string[] {
  const content = clipOf(project).content;
  return content.kind === "notes" ? content.events.map((event) => event.id) : [];
}

describe("the assistant's conversation", () => {
  it("opens ready to type into, scoped to the selected track", () => {
    renderChat();
    expect(composer()).toHaveFocus();
    expect(scopeChip()).toHaveAccessibleName("Scope: BD");
    expect(button("Send")).toBeDisabled();
  });

  it("sends a message stamped with its scope, and streams the reply", async () => {
    const { client, transport } = renderChat();
    await send("Make it groove");

    expect(composer()).toHaveValue("");
    expect(log()).toHaveTextContent("Scope · BD");
    expect(log()).toHaveTextContent("Make it groove");
    const turn = client.last();
    expect(turn.request.messages).toEqual([{ role: "user", text: "Make it groove" }]);
    expect(turn.request.context.selectedNotes).toBeNull();

    // Streaming: Stop replaces Send, the log holds its announcement, and the
    // header (and so the minimised bar) says it is writing.
    fireAndFlush(() => turn.text("Try a "));
    fireAndFlush(() => turn.text("shuffle."));
    expect(log()).toHaveTextContent("Try a shuffle.");
    expect(log()).toHaveAttribute("aria-busy", "true");
    expect(button("Stop")).toBeEnabled();
    expect(status()).toBe(WRITING_STATUS);

    fireAndFlush(() => turn.done());
    expect(log()).toHaveAttribute("aria-busy", "false");
    expect(button("Send")).toBeDisabled();
    expect(status()).toBe("");

    const sent = transport.named("assistant_message_sent");
    expect(sent.map((event) => event.params)).toEqual([
      expect.objectContaining({ scope: "track" }),
    ]);
    expect(transport.named("feature_first_use").map((e) => e.params?.feature)).toContain(
      "assistant_message",
    );
    // No message or reply text reaches analytics.
    expect(JSON.stringify(transport.events)).not.toMatch(/groove|shuffle/i);
  });

  it("resends the conversation so far with the next message", async () => {
    const { client } = renderChat();
    await send("First");
    fireAndFlush(() => client.last().text("Reply one"));
    fireAndFlush(() => client.last().done());
    await send("Second");
    expect(client.last().request.messages).toEqual([
      { role: "user", text: "First" },
      { role: "assistant", text: "Reply one" },
      { role: "user", text: "Second" },
    ]);
  });

  it("stops a streaming reply, keeps what it wrote, and gives focus back to the composer", async () => {
    const { client } = renderChat();
    await send("Write a lot");
    fireAndFlush(() => client.last().text("Here is"));
    button("Stop").focus();
    clickAndFlush(button("Stop"));
    expect(client.last().stopped).toBe(true);
    expect(log()).toHaveTextContent("Here is Stopped.");
    expect(log()).toHaveAttribute("aria-busy", "false");
    expect(composer()).toHaveFocus();
    expect(button("Send")).toBeInTheDocument();
  });

  it("will not send while a reply streams, or with nothing to say", async () => {
    const { client } = renderChat();
    await send("   ");
    expect(client.turns).toHaveLength(0);
    await send("One");
    await type("Two");
    expect(within(panel()).queryByRole("button", { name: "Send" })).toBeNull();
    expect(client.turns).toHaveLength(1);
  });

  it("renders a proposal as a placeholder card, and changes nothing", async () => {
    const { client, project } = renderChat();
    const before = JSON.stringify(project);
    await send("Change the tempo");
    fireAndFlush(() => client.last().text("Here is a change."));
    fireAndFlush(() =>
      client.last().emit({
        type: "proposal",
        proposal: {
          baseRevision: project.metadata.revision,
          toolsetVersion: 1,
          calls: [{ id: "toolu_1", name: "parameter_set", input: {} }],
        },
      }),
    );
    fireAndFlush(() => client.last().done());
    const card = within(log()).getByRole("region", { name: "Proposal" });
    expect(card).toHaveTextContent("A change is ready");
    expect(JSON.stringify(project)).toBe(before);
  });
});

describe("the assistant's inline errors", () => {
  const cases: readonly {
    name: string;
    error: AssistantErrorDetails;
    says: RegExp;
    retry: boolean;
  }[] = [
    {
      name: "a provider failure",
      error: { code: "provider_unavailable", retryable: true },
      says: /busy or can't be reached/,
      retry: true,
    },
    {
      name: "a timeout",
      error: { code: "timeout", retryable: true },
      says: /took too long/,
      retry: true,
    },
    {
      name: "a quota limit",
      error: {
        code: "quota_exceeded",
        retryable: false,
        resetsAt: Date.now() + 60_000,
      },
      says: /used all your assistant requests.*frees up (at|tomorrow at) \d/,
      retry: false,
    },
    {
      name: "the kill switch",
      error: { code: "assistant_disabled", retryable: false },
      says: /switched off/,
      retry: false,
    },
  ];

  for (const { name, error, says, retry } of cases) {
    it(`says what ${name} was, leaves the song alone, and ${retry ? "offers" : "does not offer"} Try again`, async () => {
      const { client, project } = renderChat();
      const before = JSON.stringify(project);
      await send("Help");
      fireAndFlush(() => client.last().fail(error));
      const alert = within(log()).getByRole("alert");
      expect(alert).toHaveTextContent("The assistant couldn't reply.");
      expect(alert).toHaveTextContent(says);
      expect(alert).toHaveTextContent(ERROR_REASSURANCE);
      expect(within(alert).queryByRole("button", { name: "Try again" }) !== null).toBe(
        retry,
      );
      expect(JSON.stringify(project)).toBe(before);
      // The composer is usable again at once.
      expect(composer()).toBeEnabled();
    });
  }

  it("tries the same turn again, and the reply takes the error's place", async () => {
    const { client, transport } = renderChat();
    await send("Help");
    fireAndFlush(() => client.last().fail({ code: "timeout", retryable: true }));
    const first = client.last().request;
    clickAndFlush(within(log()).getByRole("button", { name: "Try again" }));
    await settle();
    expect(client.turns).toHaveLength(2);
    expect(client.last().request).toEqual(first);
    expect(within(log()).queryByRole("alert")).toBeNull();
    expect(composer()).toHaveFocus();
    fireAndFlush(() => client.last().text("Better now"));
    fireAndFlush(() => client.last().done());
    expect(log()).toHaveTextContent("Better now");
    // A retry is not a new message.
    expect(transport.named("assistant_message_sent")).toHaveLength(1);
  });
});

describe("the scope chip", () => {
  it("follows the selection, widens to the track and the song, and resets when the selection changes", async () => {
    const { client, project, setSelection, transport } = renderChat();
    const ids = noteIds(project).slice(0, 3);
    fireAndFlush(() => setSelection({ kind: "notes", eventIds: ids as never }));
    expect(scopeChip()).toHaveAccessibleName("Scope: 3 notes");

    await send("Shift these");
    expect(log()).toHaveTextContent("Scope · 3 notes");
    expect(client.last().request.context.selectedNotes?.noteCount).toBe(3);
    fireAndFlush(() => client.last().done());

    clickAndFlush(scopeChip());
    expect(scopeChip()).toHaveAccessibleName("Scope: BD");
    await send("Now the track");
    // The track scope names its track but sends no notes (ADR 0007).
    expect(client.last().request.context.selectedNotes).toBeNull();
    expect(client.last().request.context.selection?.description).toContain("BD");
    fireAndFlush(() => client.last().done());

    clickAndFlush(scopeChip());
    expect(scopeChip()).toHaveAccessibleName("Scope: Whole song");
    await send("Now the song");
    expect(client.last().request.context.selection).toBeNull();
    fireAndFlush(() => client.last().done());

    // Round again, then a new selection lets the choice go.
    clickAndFlush(scopeChip());
    expect(scopeChip()).toHaveAccessibleName("Scope: 3 notes");
    clickAndFlush(scopeChip());
    expect(scopeChip()).toHaveAccessibleName("Scope: BD");
    fireAndFlush(() =>
      setSelection({
        kind: "clips",
        placementIds: [project.song.placements[0]?.id] as never,
      }),
    );
    expect(scopeChip()).toHaveAccessibleName("Scope: 1 clip");
    await send("These clips");

    expect(
      transport.named("assistant_message_sent").map((event) => event.params?.scope),
    ).toEqual(["clip", "track", "song", "section"]);
  });
});

describe("the suggestion chips", () => {
  it("sends a chip's words, logs which one it was, and hides while a reply streams", async () => {
    const { client, transport } = renderChat();
    const chips = within(panel()).getByRole("group", { name: "Suggestions" });
    const chip = within(chips).getByRole("button", { name: "Create an arrangement" });
    clickAndFlush(chip);
    await settle();
    expect(client.last().request.messages.at(-1)?.text).toBe("Create an arrangement");
    expect(
      transport.named("assistant_suggestion_clicked").map((e) => e.params?.suggestion_id),
    ).toEqual(["create_arrangement"]);
    expect(transport.named("assistant_message_sent")).toHaveLength(1);
    expect(within(panel()).queryByRole("group", { name: "Suggestions" })).toBeNull();
  });
});

describe("without an account", () => {
  it("offers a sign-in in place of the composer, and sends nothing", () => {
    const signIn = vi.fn();
    const { client } = renderChat({ account: { registered: false, signIn } });
    expect(within(panel()).queryByRole("textbox")).toBeNull();
    expect(panel()).toHaveTextContent(SIGN_IN_NOTE);
    expect(panel()).toHaveFocus();
    clickAndFlush(button("Sign in"));
    expect(signIn).toHaveBeenCalledOnce();
    expect(client.turns).toHaveLength(0);
  });
});
