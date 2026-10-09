/**
 * The answer to a question the assistant asks (GRV-42) as the producer puts
 * it together: the options picked in a multi-select and the "something else"
 * text, and what the options do in the editor along the way. Hovering an
 * option shows what it is about and plays what it sounds like; picking one
 * selects what it is about; making the change an option describes, in the
 * editor, answers the question as that option.
 */
import { type Accessor, createEffect, createSignal, onCleanup, untrack } from "solid-js";
import type { AskOption } from "../../assistant/ask";
import { optionDoneBy } from "../../assistant/askPredicates";
import type { Project } from "../../domain/entities";
import { type AskEditorLink, barsLabel } from "./askReferences";
import type { AssistantConversation } from "./useAssistantConversation";

/**
 * The answer to the pending question as it is put together. It belongs to
 * one question, so a new one starts empty.
 */
export interface AskDraft {
  /** The options picked so far, by index; only a multi-select keeps any. */
  readonly picked: Accessor<readonly number[]>;
  readonly text: Accessor<string>;
  setText(text: string): void;
  /**
   * Picks option `index`: a single choice answers at once, and one of
   * several toggles. Either way, picking selects what the option is about.
   * Returns whether anything happened.
   */
  pick(index: number): boolean;
  /** Whether {@link finish} would send now. */
  canFinish(): boolean;
  /** Sends what is picked and typed. */
  finish(): boolean;
  dismiss(): void;
  /**
   * The pointer is over option `index`, or over none: its part of the song is
   * shown and its sound plays, until the pointer leaves.
   */
  hover(index: number | null): void;
  /** Option `index` has focus, or none does: its part of the song is shown. */
  focus(index: number | null): void;
  /** The option with focus, if one has it. */
  focused(): number | null;
  /** Whether option `index` has a sound that can be heard now. */
  canHear(index: number): boolean;
  /** Plays option `index`'s sound: the keyboard's way to hear it (Space). */
  hear(index: number): boolean;
  /** What option `index` is about, as its chip says it, or null. */
  about(index: number): string | null;
}

export interface UseAskDraftOptions {
  readonly conversation: AssistantConversation;
  readonly project: Accessor<Project | null>;
  readonly committedProject?: () => Project | null;
  readonly previewing?: Accessor<boolean>;
  readonly link?: AskEditorLink;
}

export function useAskDraft(options: UseAskDraftOptions): AskDraft {
  const { conversation, link } = options;
  // Kept against the question it was made for, so a new question starts
  // empty without an effect, as the scope chip's choice does.
  const [draft, setDraft] = createSignal<{
    askId: string;
    picked: readonly number[];
    text: string;
  } | null>(null);
  const current = () => {
    const pending = conversation.pendingAsk();
    const value = draft();
    if (!pending) return null;
    return value?.askId === pending.ask.id
      ? value
      : { askId: pending.ask.id, picked: [] as readonly number[], text: "" };
  };
  const answerable = () =>
    conversation.pendingAsk() !== null && !conversation.streaming();
  const option = (index: number): AskOption | undefined =>
    conversation.pendingAsk()?.ask.options[index];
  /** Plain, not a signal: only the keys ask which option has focus. */
  let focusedIndex: number | null = null;

  /** Puts away whatever an option is showing or playing. */
  function release(): void {
    link?.highlight(null);
    link?.stopHearing();
  }

  // A question answered, dismissed or replaced takes its highlight and sound
  // with it. The question's ID is the one reactive read; the editor calls are
  // the apply half's.
  createEffect(
    () => conversation.pendingAsk()?.ask.id ?? null,
    () => untrack(release),
  );
  onCleanup(release);

  // Answering by doing: once the committed project has moved into the state
  // an option describes, the question is answered as that option. Never from
  // a preview, which is not a change yet, and not while a reply streams: it
  // is answered once the reply is done, as the change still stands.
  createEffect(
    () => ({
      pending: conversation.pendingAsk(),
      shown: options.project(),
      streaming: conversation.streaming(),
      previewing: options.previewing?.() ?? false,
    }),
    ({ pending, shown, streaming, previewing }) => {
      if (!pending?.asked || streaming || previewing) return;
      const now = options.committedProject?.() ?? shown;
      if (!now) return;
      const index = optionDoneBy(pending.ask, pending.asked, now);
      if (index === null) return;
      // Answering reads the conversation it adds to: read once, knowingly,
      // since the compute half above already follows everything that should
      // bring this back.
      untrack(() => {
        if (conversation.answerAsk({ picked: [index], text: "", byDoing: true })) {
          setDraft(null);
        }
      });
    },
  );

  function finish(): boolean {
    const value = current();
    if (!value || !answerable()) return false;
    link?.stopHearing();
    const sent = conversation.answerAsk({ picked: value.picked, text: value.text });
    if (sent) setDraft(null);
    return sent;
  }

  return {
    picked: () => current()?.picked ?? [],
    text: () => current()?.text ?? "",
    setText(text) {
      const value = current();
      if (value) setDraft({ ...value, text });
    },
    pick(index) {
      const pending = conversation.pendingAsk();
      const value = current();
      const chosen = option(index);
      if (!pending || !value || !chosen || !answerable()) return false;
      if (!pending.ask.multiSelect) {
        link?.stopHearing();
        if (chosen.ref) link?.select(chosen.ref);
        const sent = conversation.answerAsk({ picked: [index], text: value.text });
        if (sent) setDraft(null);
        return sent;
      }
      const adding = !value.picked.includes(index);
      if (adding && chosen.ref) link?.select(chosen.ref);
      const picked = adding
        ? [...value.picked, index].sort((a, b) => a - b)
        : value.picked.filter((other) => other !== index);
      setDraft({ ...value, picked });
      return true;
    },
    canFinish() {
      const value = current();
      return (
        value !== null &&
        answerable() &&
        (value.picked.length > 0 || value.text.trim().length > 0)
      );
    },
    finish,
    dismiss() {
      conversation.dismissAsk();
      setDraft(null);
    },
    hover(index) {
      const hovered = index === null ? undefined : option(index);
      link?.highlight(hovered?.ref ?? null);
      if (hovered?.sound && link?.canHear(hovered.sound)) link.hear(hovered.sound);
      else link?.stopHearing();
    },
    focused: () => (conversation.pendingAsk() ? focusedIndex : null),
    focus(index) {
      focusedIndex = index;
      const focused = index === null ? undefined : option(index);
      link?.highlight(focused?.ref ?? null);
      if (index === null) link?.stopHearing();
    },
    canHear(index) {
      const sound = option(index)?.sound;
      return sound !== undefined && (link?.canHear(sound) ?? false);
    },
    about(index) {
      const ref = option(index)?.ref;
      if (!ref) return null;
      if (link) return link.describe(ref);
      return ref.kind === "bars" ? barsLabel(ref) : null;
    },
    hear(index) {
      const sound = option(index)?.sound;
      if (!sound || !link?.canHear(sound)) return false;
      link.hear(sound, true);
      return true;
    },
  };
}
