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
import { type Accessor, createSignal, onCleanup } from "solid-js";
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
  /** The assistant's reply: streaming, finished, stopped or failed part-way. */
  | {
      readonly kind: "reply";
      readonly id: string;
      readonly text: string;
      readonly streaming: boolean;
      readonly stopped: boolean;
      /**
       * The turn failed after writing this much. It stays on screen above the
       * error, but it is not an answer: the next turn does not resend it, and
       * Try again replaces it.
       */
      readonly failed?: boolean;
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
      /** The failed turn's partial reply, which Try again replaces. */
      readonly replyId?: string;
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
  /**
   * Resends the turn the last error ended, if it may be retried and nothing
   * is streaming. An earlier error, with the conversation moved on past it,
   * cannot be retried.
   */
  retry(): boolean;
  /** Whether {@link retry} would resend this entry's turn now. */
  canRetry(entry: ConversationEntry): boolean;
}

/** The most one message may say, as the gateway counts it. */
export const MAX_MESSAGE_CHARS = ASSISTANT_REQUEST_LIMITS.maxMessageChars;

/**
 * The conversation so far, as the next turn resends it: every message that
 * got a reply, with that reply. A message whose turn failed is left out,
 * along with whatever its reply wrote before failing, so the roles always
 * alternate and a broken answer is never passed off as the assistant's; the
 * retry resends the message, and its reply is the one that counts.
 */
export function historyOf(entries: readonly ConversationEntry[]): AssistantMessage[] {
  const history: AssistantMessage[] = [];
  let pending: string | null = null;
  for (const entry of entries) {
    if (entry.kind === "message") pending = entry.text;
    if (
      entry.kind === "reply" &&
      pending !== null &&
      !entry.failed &&
      entry.text.trim().length > 0
    ) {
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
  // Leaving the editor stops the reply on its way, at the gateway too, rather
  // than leaving it to write into a conversation nobody can see.
  onCleanup(() => inFlight?.stop());

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

    /** Whether the reply is still in the log when the turn ends. */
    let replyKept = false;
    const finishReply = (ending: "done" | "stopped" | "failed") =>
      update(replyId, (entry) => {
        if (entry.kind !== "reply") return entry;
        // A reply that never wrote a word is not one, unless it was stopped.
        if (entry.text.length === 0 && ending !== "stopped") return null;
        replyKept = true;
        return {
          ...entry,
          streaming: false,
          stopped: ending === "stopped",
          ...(ending === "failed" ? { failed: true } : {}),
        };
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
          finishReply("failed");
          append({
            kind: "error",
            id: id(),
            error: event.error,
            request,
            ...(replyKept ? { replyId } : {}),
          });
          setStreaming(false);
          return;
        case "done":
          finishReply(event.stopped ? "stopped" : "done");
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

  function canRetry(entry: ConversationEntry): boolean {
    return (
      entry.kind === "error" &&
      entry.error.retryable &&
      !streaming() &&
      entries().at(-1)?.id === entry.id
    );
  }

  function retry(): boolean {
    const last = entries().at(-1);
    if (last?.kind !== "error" || !canRetry(last)) return false;
    // The retried turn's reply takes the place of the error and of whatever
    // the failed reply had written, so the message is answered once.
    const stale = new Set([last.id, last.replyId]);
    setEntries((current) => current.filter((entry) => !stale.has(entry.id)));
    startTurn(last.request);
    return true;
  }

  return { entries, streaming, send, stop, retry, canRetry };
}
