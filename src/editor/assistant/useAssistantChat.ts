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
import type { AskEditorLink } from "./askReferences";
import { type AssistantLibrary, libraryContext } from "./assistantLibrary";
import {
  type AssistantScope,
  resolveScope,
  type ScopeLevel,
  type ScopeSources,
  selectionKey,
  widen,
} from "./assistantScope";
import { assistantSuggestions } from "./assistantSuggestions";
import { type AskDraft, useAskDraft } from "./useAskDraft";
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
import {
  type AssistantRecommendations,
  type RecommendationEditorPort,
  useAssistantRecommendations,
} from "./useAssistantRecommendations";

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
   * nothing to apply it to. A question's options hear the producer's own
   * edits through the same session (GRV-42).
   */
  readonly editor?: {
    readonly session: ProposalSessionPort;
    readonly controls: UseAssistantProposalsOptions["controls"];
    /**
     * The library a turn may recommend from, and the slots, audio and insert
     * a recommendation is tried and kept through (GRV-23). Without them the
     * assistant is sent no library, so it recommends nothing.
     */
    readonly recommendations?: {
      readonly library: AssistantLibrary;
      readonly port: RecommendationEditorPort;
    };
  };
  /**
   * The committed project, never a preview of it (GRV-42): what a question
   * is asked against and answered by doing in. Defaults to {@link project}.
   */
  readonly committedProject?: () => Project | null;
  /** What a question's options can do in the editor (GRV-42). */
  readonly link?: AskEditorLink;
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
  /** The recommended packs, when there is an editor and a library to try them in. */
  readonly recommendations: AssistantRecommendations | null;
  /** The pending question's answer so far (GRV-42). */
  readonly ask: AskDraft;
}

export type { AskDraft } from "./useAskDraft";

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

  const recommending = editor?.recommendations;
  const recommendations =
    editor && recommending
      ? useAssistantRecommendations({
          session: editor.session,
          controls: editor.controls,
          project: options.project,
          view: options.view,
          library: recommending.library,
          editor: recommending.port,
          analytics: options.analytics,
          refresh: (entryId) => conversation.refresh(entryId),
        })
      : null;

  const conversation = useAssistantConversation({
    client: options.client,
    project: options.project,
    scope,
    canSend: () => options.account().registered,
    analytics: options.analytics,
    committedProject: options.committedProject,
    onProposal: proposals
      ? (entryId, proposal, origin) => proposals.receive(entryId, proposal, origin)
      : undefined,
    remoteChanges: proposals ? () => proposals.remoteChanges() : undefined,
    library: recommending
      ? async (project) => {
          const catalog = await recommending.library.load();
          return catalog ? libraryContext(catalog, project) : null;
        }
      : undefined,
    onRecommendation: recommendations
      ? (entryId, call, library, origin) =>
          recommendations.receive(entryId, call, library, origin)
      : undefined,
  });

  const ask = useAskDraft({
    conversation,
    project: options.project,
    committedProject: options.committedProject,
    onEdit: options.editor?.session.onEdit,
    link: options.link,
  });

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
    recommendations,
    ask,
  };
}
