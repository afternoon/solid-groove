import type { JSX } from "@solidjs/web";
import { createEffect, For, Match, Show, Switch } from "solid-js";
import { SendIcon, SparkIcon, StopIcon } from "../../components/icons";
import { ERROR_HEADING, ERROR_REASSURANCE, errorMessage } from "./assistantErrorCopy";
import type { AssistantChat } from "./useAssistantChat";
import { type ConversationEntry, MAX_MESSAGE_CHARS } from "./useAssistantConversation";

export interface AssistantChatViewProps {
  readonly chat: AssistantChat;
  /** Bound to the composer, so the panel opens ready to type into. */
  bindComposer(element: HTMLElement | undefined): void;
  /** Puts focus back in the composer, after Stop or Try again. */
  focusComposer(): void;
}

/** The status a streaming reply puts in the panel's header and bar. */
export const WRITING_STATUS = "Writing…";

/** What the panel offers someone who must sign in first (ADR 0006 decision 4). */
export const SIGN_IN_NOTE = "Sign in to talk to the assistant.";

/**
 * The assistant's conversation (GRV-26), after docs/assistant-panel.html: the
 * log, the suggestion chips and the composer with its scope chip.
 *
 * Enter is not read here: it is the registry's `assistant.send`, live while
 * the composer has focus, so this only binds the composer and renders.
 *
 * The log is a polite live region, and it is `aria-busy` while a reply
 * streams, so a screen reader announces the reply once, when it is finished,
 * rather than word by word.
 */
export default function AssistantChatView(props: AssistantChatViewProps): JSX.Element {
  const conversation = () => props.chat.conversation;
  const streaming = () => conversation().streaming();
  const scope = () => props.chat.scope();

  // The log follows the newest entry, as a reply streams in too, unless the
  // producer has scrolled up to read something earlier. The entries are the
  // effect's one reactive read; the scroll is a DOM write, so it is the apply
  // half's.
  let log: HTMLDivElement | undefined;
  let pinned = true;
  const PIN_SLACK = 40;
  createEffect(
    () => conversation().entries(),
    () => {
      if (log && pinned) log.scrollTop = log.scrollHeight;
    },
  );

  function stop(): void {
    conversation().stop();
    props.focusComposer();
  }

  function retry(): void {
    conversation().retry();
    props.focusComposer();
  }

  return (
    <>
      <div
        ref={log}
        onScroll={(event) => {
          const element = event.currentTarget;
          pinned =
            element.scrollHeight - element.scrollTop - element.clientHeight < PIN_SLACK;
        }}
        class="assistant-panel-log"
        role="log"
        aria-live="polite"
        aria-label="Conversation"
        aria-busy={streaming() ? "true" : "false"}
      >
        <Show when={conversation().entries().length === 0}>
          <div class="assistant-hello">
            <b>Ask for a change, a sound, or how something works.</b>
            <p>It only changes your song when you apply a proposal.</p>
          </div>
        </Show>
        <For
          each={conversation().entries()}
          keyed={(entry: ConversationEntry) => entry.id}
        >
          {(entry) => (
            <Entry
              entry={entry()}
              canRetry={conversation().canRetry(entry())}
              onRetry={retry}
            />
          )}
        </For>
      </div>
      <Show
        when={props.chat.account().registered}
        fallback={<SignInPrompt signIn={props.chat.account().signIn} />}
      >
        <Show when={!streaming() && props.chat.suggestions().length > 0}>
          <fieldset class="assistant-suggestions" aria-label="Suggestions">
            <For each={props.chat.suggestions()}>
              {(suggestion) => (
                <button
                  type="button"
                  class="assistant-chip"
                  title={suggestion.rationale}
                  onClick={() => props.chat.sendSuggestion(suggestion)}
                >
                  {suggestion.label}
                </button>
              )}
            </For>
          </fieldset>
        </Show>
        <div class="assistant-panel-composer">
          <textarea
            ref={(element) => props.bindComposer(element)}
            class="assistant-panel-input"
            aria-label="Message the assistant"
            placeholder="Ask for a change, a sound, or how something works"
            maxlength={MAX_MESSAGE_CHARS}
            value={props.chat.draft()}
            onInput={(event) => props.chat.setDraft(event.currentTarget.value)}
          />
          <div class="assistant-composer-row">
            <button
              type="button"
              class="assistant-scope"
              aria-label={`Scope: ${scope().label}`}
              title="What the assistant reads and may change: your selection, the selected track, or the whole song. Click to widen it."
              onClick={() => props.chat.widenScope()}
            >
              <span class="assistant-scope-label">Scope</span>
              {scope().label}
            </button>
            <span class="assistant-composer-hint">
              {streaming()
                ? "Editing still works while it writes"
                : "Enter sends · Shift+Enter adds a line"}
            </span>
            {/* One button that turns from Send to Stop and back, so focus on
                it is never lost to the swap. */}
            <button
              type="button"
              class="assistant-send"
              aria-label={streaming() ? "Stop" : "Send"}
              title={streaming() ? "Stop the reply" : "Send"}
              disabled={!streaming() && props.chat.draft().trim().length === 0}
              onClick={() => (streaming() ? stop() : props.chat.sendDraft())}
            >
              <Show when={streaming()} fallback={<SendIcon size={14} />}>
                <StopIcon size={12} />
              </Show>
            </button>
          </div>
        </div>
      </Show>
    </>
  );
}

function Entry(props: {
  readonly entry: ConversationEntry;
  /** Only the error that ended the conversation offers Try again. */
  readonly canRetry: boolean;
  onRetry(): void;
}): JSX.Element {
  return (
    <Switch>
      <Match when={props.entry.kind === "message" && props.entry}>
        {(message) => (
          <div class="assistant-message">
            <span class="assistant-entry-label">Scope · {message().scopeLabel}</span>
            {/* A space between the stamp and the message, so their text reads
                as two words to a screen reader and a search, not one. The flex
                column does not draw it. */}{" "}
            <p>{message().text}</p>
          </div>
        )}
      </Match>
      <Match when={props.entry.kind === "reply" && props.entry}>
        {(reply) => (
          <div class="assistant-reply">
            <span class="assistant-entry-label assistant-reply-who">
              <SparkIcon size={10} />
              Assistant
            </span>{" "}
            <p>
              {reply().text}
              <Show when={reply().streaming}>
                <span class="assistant-caret" aria-hidden="true" />
              </Show>
              <Show when={reply().stopped}>
                {reply().text.length > 0 ? " " : ""}
                <span class="assistant-stopped">Stopped.</span>
              </Show>
            </p>
          </div>
        )}
      </Match>
      <Match when={props.entry.kind === "proposal"}>
        {/* The proposal card is GRV-5's. Until then the reply says a change is
            ready and nothing more: nothing in the song changes. */}
        <section class="assistant-card" aria-label="Proposal">
          <b>A change is ready</b>
          <span>Previewing and applying it is coming soon. Your song is unchanged.</span>
        </section>
      </Match>
      <Match when={props.entry.kind === "error" && props.entry}>
        {(failure) => (
          <div class="assistant-error" role="alert">
            <b>{ERROR_HEADING}</b>
            <span>
              {errorMessage(failure().error)} {ERROR_REASSURANCE}
            </span>
            <Show when={props.canRetry}>
              <div>
                <button
                  type="button"
                  class="assistant-button-primary"
                  onClick={() => props.onRetry()}
                >
                  Try again
                </button>
              </div>
            </Show>
          </div>
        )}
      </Match>
    </Switch>
  );
}

function SignInPrompt(props: { readonly signIn?: () => void }): JSX.Element {
  return (
    <div class="assistant-panel-composer assistant-sign-in">
      <p class="assistant-panel-note">{SIGN_IN_NOTE}</p>
      <Show when={props.signIn}>
        {(signIn) => (
          <div>
            <button
              type="button"
              class="assistant-button-primary"
              onClick={() => signIn()()}
            >
              Sign in
            </button>
          </div>
        )}
      </Show>
    </div>
  );
}
