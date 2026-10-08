/**
 * The conversation in the assistant's panel (GRV-26): what has been said,
 * the reply streaming now, and the three things a producer can do about it
 * (send, Stop, Try again). It lives in memory for the session: closing the
 * panel keeps it, a reload loses it (keeping it is GRV-8).
 *
 * Every turn goes through an {@link AssistantClient}, the one door to the
 * gateway, and each is stamped with the scope it was sent with. Nothing here
 * touches the project: a proposal in a reply is only a placeholder entry
 * until GRV-5 builds the card that can apply it.
 *
 * Analytics: `assistant_message_sent` with the scope, and
 * `assistant_suggestion_clicked` with the suggestion's ID. Never the text of
 * a message or a reply, and nothing about what is in scope.
 */
import { type Accessor, createSignal } from "solid-js";
import type { Analytics } from "../../analytics/analytics";
import type {
  AssistantClient,
  AssistantStreamEvent,
  AssistantTurnHandle,
} from "../../assistant/assistantClient";
import { ASSISTANT_REQUEST_LIMITS } from "../../assistant/config";
import type {
  AssistantErrorDetails,
  AssistantMessage,
  AssistantTurnRequest,
} from "../../assistant/protocol";
import type { Project } from "../../domain/entities";
import type { SuggestionId } from "../../projection/projectAnalysisProjection";
import { type AssistantScope, scopedContext } from "./assistantScope";

/** One thing in the conversation's log. */
export type ConversationEntry =
  /** The producer's message, stamped with the scope it was sent with. */
  | {
      readonly kind: "message";
      readonly id: string;
      readonly text: string;
      readonly scopeLabel: string;
    }
  /** The assistant's reply: streaming, finished, or stopped part-way. */
  | {
      readonly kind: "reply";
      readonly id: string;
      readonly text: string;
      readonly streaming: boolean;
      readonly stopped: boolean;
    }
  /** A change the reply proposes; a placeholder until GRV-5. */
  | { readonly kind: "proposal"; readonly id: string }
  /** The turn failed. The song is untouched. */
  | {
      readonly kind: "error";
      readonly id: string;
      readonly error: AssistantErrorDetails;
      /** What Try again resends. */
      readonly request: AssistantTurnRequest;
    };

export interface UseAssistantConversationOptions {
  readonly client: () => Promise<AssistantClient>;
  readonly project: Accessor<Project | null>;
  readonly scope: Accessor<AssistantScope>;
  /** Whether a signed-in account is here to talk (ADR 0006 decision 4). */
  readonly canSend: Accessor<boolean>;
  readonly analytics: () => Analytics;
}

export interface AssistantConversation {
  readonly entries: Accessor<readonly ConversationEntry[]>;
  /** Whether a reply is on its way. */
  readonly streaming: Accessor<boolean>;
  /**
   * Sends `text` with the scope on the chip. Returns whether it went: not
   * while a reply streams, with nothing to say, or with no account.
   */
  send(text: string, suggestion?: SuggestionId): boolean;
  /** Stops the reply on its way, at the gateway too. */
  stop(): void;
  /** Resends the turn the last error ended, if it may be retried. */
  retry(): boolean;
}

/** The most one message may say, as the gateway counts it. */
export const MAX_MESSAGE_CHARS = ASSISTANT_REQUEST_LIMITS.maxMessageChars;

/**
 * The conversation so far, as the next turn resends it: every message that
 * got a reply, with that reply. A message whose turn failed with nothing
 * written is left out, so the roles always alternate; its retry resends it.
 */
export function historyOf(entries: readonly ConversationEntry[]): AssistantMessage[] {
  const history: AssistantMessage[] = [];
  let pending: string | null = null;
  for (const entry of entries) {
    if (entry.kind === "message") pending = entry.text;
    if (entry.kind === "reply" && pending !== null && entry.text.trim().length > 0) {
      history.push(
        { role: "user", text: pending.slice(0, MAX_MESSAGE_CHARS) },
        { role: "assistant", text: entry.text.slice(0, MAX_MESSAGE_CHARS) },
      );
      pending = null;
    }
  }
  // Room for the new message; whole pairs only, so it still starts with the user.
  const room = ASSISTANT_REQUEST_LIMITS.maxMessages - 1;
  const keep = room - (room % 2);
  return history.length > keep ? history.slice(history.length - keep) : history;
}

export function useAssistantConversation(
  options: UseAssistantConversationOptions,
): AssistantConversation {
  const [entries, setEntries] = createSignal<readonly ConversationEntry[]>([]);
  const [streaming, setStreaming] = createSignal(false);
  let nextId = 0;
  const id = () => {
    nextId += 1;
    return `entry-${nextId}`;
  };
  /** The turn on its way: Stop goes to it. */
  let inFlight: AssistantTurnHandle | null = null;

  const append = (entry: ConversationEntry) =>
    setEntries((current) => [...current, entry]);
  const update = (
    entryId: string,
    change: (entry: ConversationEntry) => ConversationEntry | null,
  ) =>
    setEntries((current) =>
      current.flatMap((entry) => {
        if (entry.id !== entryId) return [entry];
        const next = change(entry);
        return next ? [next] : [];
      }),
    );

  function startTurn(request: AssistantTurnRequest): void {
    const replyId = id();
    append({ kind: "reply", id: replyId, text: "", streaming: true, stopped: false });
    setStreaming(true);
    let ended = false;
    let handle: AssistantTurnHandle | null = null;

    const finishReply = (stopped: boolean) =>
      update(replyId, (entry) => {
        if (entry.kind !== "reply") return entry;
        // A reply that never wrote a word is not one, unless it was stopped.
        if (entry.text.length === 0 && !stopped) return null;
        return { ...entry, streaming: false, stopped };
      });

    const onEvent = (event: AssistantStreamEvent) => {
      if (ended) return;
      if (event.type === "error" || event.type === "done") {
        ended = true;
        inFlight = null;
      }
      switch (event.type) {
        case "text":
          update(replyId, (entry) =>
            entry.kind === "reply" ? { ...entry, text: entry.text + event.text } : entry,
          );
          return;
        case "proposal":
          append({ kind: "proposal", id: id() });
          return;
        case "error":
          finishReply(false);
          append({ kind: "error", id: id(), error: event.error, request });
          setStreaming(false);
          return;
        case "done":
          finishReply(event.stopped);
          setStreaming(false);
      }
    };

    // Stop works before the client has even loaded: the turn ends at once
    // and is never sent.
    inFlight = {
      stop() {
        if (handle) handle.stop();
        else
          onEvent({
            type: "done",
            stopped: true,
            stopReason: null,
            requestsRemaining: null,
          });
      },
    };
    options.client().then(
      (client) => {
        if (!ended) handle = client.send(request, onEvent);
      },
      () =>
        onEvent({
          type: "error",
          error: { code: "provider_unavailable", retryable: true },
        }),
    );
  }

  function send(text: string, suggestion?: SuggestionId): boolean {
    const message = text.trim();
    const project = options.project();
    if (streaming() || message.length === 0 || !options.canSend() || !project) {
      return false;
    }
    const scope = options.scope();
    const request: AssistantTurnRequest = {
      projectRevision: project.metadata.revision,
      messages: [
        ...historyOf(entries()),
        { role: "user", text: message.slice(0, MAX_MESSAGE_CHARS) },
      ],
      context: scopedContext(project, scope),
    };
    append({ kind: "message", id: id(), text: message, scopeLabel: scope.label });
    const analytics = options.analytics();
    if (suggestion) {
      analytics.log("assistant_suggestion_clicked", { suggestion_id: suggestion });
    }
    analytics.log("assistant_message_sent", { scope: scope.catalogScope });
    analytics.logFeatureFirstUse("assistant_message");
    startTurn(request);
    return true;
  }

  function stop(): void {
    inFlight?.stop();
  }

  function retry(): boolean {
    if (streaming()) return false;
    const last = entries().at(-1);
    if (last?.kind !== "error" || !last.error.retryable) return false;
    update(last.id, () => null);
    startTurn(last.request);
    return true;
  }

  return { entries, streaming, send, stop, retry };
}
