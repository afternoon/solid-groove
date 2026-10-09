/**
 * Everything the assistant's composer and conversation need (GRV-26), held
 * once per editor beside the panel's layout (`useAssistantPanel.ts`): the
 * scope the chip says, the draft, the suggestion chips and the conversation,
 * and the answer being put together to a question the assistant asked
 * (GRV-42). The panel renders it, and the shortcut layer sends the draft on
 * Enter and picks an answer on `1`-`8`.
 */
import { type Accessor, createEffect, createMemo, createSignal } from "solid-js";
import type { Analytics } from "../../analytics/analytics";
import type { AssistantClient } from "../../assistant/assistantClient";
import type { Project } from "../../domain/entities";
import type { Suggestion } from "../../projection/projectAnalysisProjection";
import type { EditorViewName } from "../editorViews";
import {
  type AssistantScope,
  resolveScope,
  type ScopeLevel,
  type ScopeSources,
  selectionKey,
  widen,
} from "./assistantScope";
import { assistantSuggestions } from "./assistantSuggestions";
import {
  type AssistantConversation,
  useAssistantConversation,
} from "./useAssistantConversation";
import {
  type AssistantProposals,
  type ProposalSessionPort,
  type UseAssistantProposalsOptions,
  useAssistantProposals,
} from "./useAssistantProposals";

/** Who is here to talk: a signed-in account, or someone who must sign in. */
export interface AssistantAccount {
  /** False for a guest or for no one (ADR 0006 decision 4). */
  readonly registered: boolean;
  /** Starts a sign-in; absent where there is no way to offer one. */
  readonly signIn?: () => void;
}

export interface UseAssistantChatOptions {
  readonly project: Accessor<Project | null>;
  readonly view: Accessor<EditorViewName>;
  /** What the editor is pointed at: the selection on screen and the track. */
  readonly sources: Accessor<ScopeSources>;
  readonly account: Accessor<AssistantAccount>;
  /** Whether the conversation is on screen, so suggestions are only worked out then. */
  readonly expanded: Accessor<boolean>;
  readonly client: () => Promise<AssistantClient>;
  readonly analytics: () => Analytics;
  /**
   * The editor session and controls a proposal previews, applies and shows
   * itself through (GRV-5). Without them a proposal is listed, but there is
   * nothing to apply it to.
   */
  readonly editor?: {
    readonly session: ProposalSessionPort;
    readonly controls: UseAssistantProposalsOptions["controls"];
  };
}

export interface AssistantChat {
  readonly conversation: AssistantConversation;
  readonly scope: Accessor<AssistantScope>;
  /** The chip's click: one step wider, or back to the narrowest. */
  widenScope(): void;
  readonly suggestions: Accessor<readonly Suggestion[]>;
  readonly draft: Accessor<string>;
  setDraft(text: string): void;
  /** Enter, or the Send button: sends the draft and clears it if it went. */
  sendDraft(): boolean;
  /** A suggestion chip: sends its label as the message. */
  sendSuggestion(suggestion: Suggestion): boolean;
  readonly account: Accessor<AssistantAccount>;
  /** The proposal cards, when there is an editor to apply them to. */
  readonly proposals: AssistantProposals | null;
  /** The pending question's answer so far (GRV-42). */
  readonly ask: AskDraft;
}

/**
 * The answer to the pending question as it is put together: the options
 * picked in a multi-select and the "something else" text. It belongs to one
 * question, so a new one starts empty.
 */
export interface AskDraft {
  /** The options picked so far, by index; only a multi-select keeps any. */
  readonly picked: Accessor<readonly number[]>;
  readonly text: Accessor<string>;
  setText(text: string): void;
  /**
   * Picks option `index`: a single choice answers at once, and one of
   * several toggles. Returns whether anything happened.
   */
  pick(index: number): boolean;
  /** Whether {@link finish} would send now. */
  canFinish(): boolean;
  /** Sends what is picked and typed. */
  finish(): boolean;
  dismiss(): void;
}

export function useAssistantChat(options: UseAssistantChatOptions): AssistantChat {
  // The chip's choice, kept against the selection it was made for: a new
  // selection lets it go at once.
  const [chosen, setChosen] = createSignal<{ level: ScopeLevel; key: string } | null>(
    null,
  );
  // And for good: going back to the selection it was made for (nothing
  // selected, say) must not bring a widened choice back. The key is the one
  // reactive read; forgetting the choice is a write, so it is the apply half's.
  createEffect(
    () => selectionKey(options.sources()),
    () => {
      setChosen(null);
    },
  );
  const scope = createMemo(() => {
    const sources = options.sources();
    const choice = chosen();
    const level = choice && choice.key === selectionKey(sources) ? choice.level : null;
    return resolveScope(sources, level);
  });
  const [draft, setDraft] = createSignal("");

  const editor = options.editor;
  const proposals = editor
    ? useAssistantProposals({
        session: editor.session,
        controls: editor.controls,
        project: options.project,
        analytics: options.analytics,
        // The conversation is made just below; Refresh is only ever pressed later.
        refresh: (entryId) => conversation.refresh(entryId),
      })
    : null;

  const conversation = useAssistantConversation({
    client: options.client,
    project: options.project,
    scope,
    canSend: () => options.account().registered,
    analytics: options.analytics,
    onProposal: proposals
      ? (entryId, proposal, origin) => proposals.receive(entryId, proposal, origin)
      : undefined,
    remoteChanges: proposals ? () => proposals.remoteChanges() : undefined,
  });

  const ask = useAskDraft(conversation);

  const suggestions = createMemo((): readonly Suggestion[] => {
    const project = options.project();
    if (!project || !options.expanded()) return [];
    return assistantSuggestions(project, options.view(), scope());
  });

  return {
    conversation,
    scope,
    widenScope() {
      const sources = options.sources();
      setChosen({ level: widen(scope().level, sources), key: selectionKey(sources) });
    },
    suggestions,
    draft,
    setDraft: (text) => setDraft(text),
    sendDraft() {
      const sent = conversation.send(draft());
      if (sent) setDraft("");
      return sent;
    },
    sendSuggestion: (suggestion) => conversation.send(suggestion.label, suggestion.id),
    account: options.account,
    proposals,
    ask,
  };
}

function useAskDraft(conversation: AssistantConversation): AskDraft {
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

  function finish(): boolean {
    const value = current();
    if (!value || !answerable()) return false;
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
      if (!pending || !value || !answerable()) return false;
      if (index < 0 || index >= pending.ask.options.length) return false;
      if (!pending.ask.multiSelect) {
        const sent = conversation.answerAsk({ picked: [index], text: value.text });
        if (sent) setDraft(null);
        return sent;
      }
      const picked = value.picked.includes(index)
        ? value.picked.filter((other) => other !== index)
        : [...value.picked, index].sort((a, b) => a - b);
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
  };
}
