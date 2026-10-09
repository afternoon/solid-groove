import type { JSX } from "@solidjs/web";
import { createEffect, For, Show, untrack } from "solid-js";
import { ASK_LIMITS } from "../../assistant/ask";
import { CloseIcon } from "../../components/icons";
import type { AskDraft } from "./useAssistantChat";
import type { PendingAsk } from "./useAssistantConversation";

export interface AssistantAskCardProps {
  readonly pending: PendingAsk;
  readonly draft: AskDraft;
  /** Whether a reply is on its way, so nothing can be answered yet. */
  readonly streaming: boolean;
  /** Bound to the "something else" box, where Enter sends (`assistant.send`). */
  bindText(element: HTMLElement | undefined): void;
  /**
   * Whether focus should come to the question when it arrives: the producer
   * is in an empty composer, waiting, rather than writing something else.
   */
  takeFocus(): boolean;
}

/** The card's accessible name. */
export const ASK_CARD_LABEL = "The assistant asks";

/** What the "something else" box is called, and says when empty. */
export const ASK_TEXT_LABEL = "Something else";

/** The keys line under a question: its digits run as far as its options. */
export function askHint(count: number, multiSelect: boolean): string {
  const keys = count > 1 ? `1–${count}` : "1";
  return multiSelect
    ? `Pick any · ${keys} toggle · Enter sends`
    : `Pick one · ${keys} picks`;
}

/**
 * A question the assistant asks the producer (GRV-42), above the composer:
 * a header line when the question says what it is about, the question, its
 * options as square chips in a wrap with the suggested one marked, and a
 * "something else" box with Send.
 *
 * A single choice answers on a click; several toggle and go with Send. The
 * keys are not read here: `1`-`8` and Enter are the registry's
 * (`assistant.ask_option_*`, `assistant.ask_finish`), live while focus is in
 * the panel outside a text box, so the chips only number themselves.
 */
export default function AssistantAskCard(props: AssistantAskCardProps): JSX.Element {
  const ask = () => props.pending.ask;
  const questionId = () => `assistant-ask-${ask().id}`;
  let card: HTMLElement | undefined;

  // A new question takes focus from an empty composer, so its keys work at
  // once. The question's ID is the one reactive read: the draft is read once,
  // as the question arrives, so emptying the composer later never pulls
  // focus. Focus is a DOM write, so it is the apply half's.
  createEffect(
    () => ask().id,
    () => {
      if (untrack(() => props.takeFocus())) card?.focus();
    },
  );

  return (
    <section
      ref={card}
      class="assistant-ask"
      aria-label={ASK_CARD_LABEL}
      aria-describedby={questionId()}
      tabindex={-1}
    >
      <div class="assistant-ask-head">
        <span class="assistant-entry-label">{ask().context ?? "Question"}</span>
        <button
          type="button"
          class="assistant-ask-dismiss"
          aria-label="Dismiss the question"
          title="Dismiss the question"
          onClick={() => props.draft.dismiss()}
        >
          <CloseIcon size={12} />
        </button>
      </div>
      <p id={questionId()} class="assistant-ask-question">
        {ask().question}
      </p>
      <fieldset class="assistant-ask-options" aria-labelledby={questionId()}>
        <For each={ask().options}>
          {(option, index) => {
            const suggested = () => ask().suggested === index();
            const picked = () => props.draft.picked().includes(index());
            const part = (name: string) => `${questionId()}-${index()}-${name}`;
            // The label names the chip; the rest describes it. Referenced by
            // ID, so none of the question's own words sits in an attribute.
            const described = () =>
              [
                option.description ? part("description") : "",
                suggested() ? part("suggested") : "",
              ]
                .filter((id) => id.length > 0)
                .join(" ") || undefined;
            return (
              <button
                type="button"
                class={[
                  "assistant-ask-option",
                  { "assistant-ask-suggested-option": suggested() },
                ]}
                aria-pressed={
                  ask().multiSelect ? (picked() ? "true" : "false") : undefined
                }
                aria-keyshortcuts={String(index() + 1)}
                aria-labelledby={part("label")}
                aria-describedby={described()}
                disabled={props.streaming}
                onClick={() => props.draft.pick(index())}
              >
                <span class="assistant-ask-key" aria-hidden="true">
                  {index() + 1}
                </span>
                <span class="assistant-ask-text">
                  <span id={part("label")} class="assistant-ask-label">
                    {option.label}
                  </span>
                  <Show when={option.description}>
                    {(description) => (
                      <span
                        id={part("description")}
                        class="assistant-ask-description"
                        aria-hidden="true"
                      >
                        {description()}
                      </span>
                    )}
                  </Show>
                </span>
                <Show when={suggested()}>
                  <span
                    id={part("suggested")}
                    class="assistant-ask-suggested"
                    aria-hidden="true"
                  >
                    Suggested
                  </span>
                </Show>
              </button>
            );
          }}
        </For>
      </fieldset>
      <div class="assistant-ask-other">
        <input
          ref={(element) => props.bindText(element)}
          type="text"
          class="assistant-ask-input"
          aria-label={ASK_TEXT_LABEL}
          placeholder={`${ASK_TEXT_LABEL}…`}
          maxlength={ASK_LIMITS.answerChars}
          value={props.draft.text()}
          disabled={props.streaming}
          onInput={(event) => props.draft.setText(event.currentTarget.value)}
        />
        <button
          type="button"
          class="assistant-button-primary"
          aria-label="Send the answer"
          disabled={!props.draft.canFinish()}
          onClick={() => props.draft.finish()}
        >
          Send
        </button>
      </div>
      <span class="assistant-composer-hint assistant-ask-hint">
        {askHint(ask().options.length, ask().multiSelect)}
      </span>
    </section>
  );
}
