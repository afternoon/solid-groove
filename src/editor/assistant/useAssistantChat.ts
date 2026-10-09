/**
 * Everything the assistant's composer and conversation need (GRV-26), held
 * once per editor beside the panel's layout (`useAssistantPanel.ts`): the
 * scope the chip says, the draft, the suggestion chips and the conversation.
 * The panel renders it, and the shortcut layer sends the draft on Enter.
 */
import { type Accessor, createMemo, createSignal } from "solid-js";
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
}

export function useAssistantChat(options: UseAssistantChatOptions): AssistantChat {
  // The chip's choice, kept against the selection it was made for: a new
  // selection lets it go, so the scope resets without an effect.
  const [chosen, setChosen] = createSignal<{ level: ScopeLevel; key: string } | null>(
    null,
  );
  const scope = createMemo(() => {
    const sources = options.sources();
    const choice = chosen();
    const level = choice && choice.key === selectionKey(sources) ? choice.level : null;
    return resolveScope(sources, level);
  });
  const [draft, setDraft] = createSignal("");

  const conversation = useAssistantConversation({
    client: options.client,
    project: options.project,
    scope,
    canSend: () => options.account().registered,
    analytics: options.analytics,
  });

  const suggestions = createMemo((): readonly Suggestion[] => {
    const project = options.project();
    if (!project || !options.expanded()) return [];
    return assistantSuggestions(project, options.view(), scope().catalogScope);
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
  };
}
