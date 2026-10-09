/**
 * Everything the assistant's composer and conversation need (GRV-26), held
 * once per editor beside the panel's layout (`useAssistantPanel.ts`): the
 * scope the chip says, the draft, the suggestion chips and the conversation.
 * The panel renders it, and the shortcut layer sends the draft on Enter.
 */
import { type Accessor, createEffect, createMemo, createSignal } from "solid-js";
import type { Analytics } from "../../analytics/analytics";
import type { AssistantClient } from "../../assistant/assistantClient";
import type { AssistantRetentionClient } from "../../assistant/retentionClient";
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
import { type AssistantRetention, useAssistantRetention } from "./useAssistantRetention";

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
   * The account's answer about keeping conversations (GRV-8). With it, the
   * assistant cannot be messaged until a signed-in account has answered the
   * disclosure, and each turn carries the session its transcript is filed
   * under. The editor always passes one; a test that leaves it out is testing
   * something else, and its turns are never kept.
   */
  readonly retention?: {
    readonly client: () => Promise<AssistantRetentionClient>;
    /** Whether this browser is internal traffic (`isInternalTraffic`). */
    readonly internal: () => boolean;
  };
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
  /** The account's answer about keeping conversations, when it is asked for. */
  readonly retention: AssistantRetention | null;
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

  const retentionOptions = options.retention;
  const retention = retentionOptions
    ? useAssistantRetention({
        client: retentionOptions.client,
        registered: () => options.account().registered,
        analytics: options.analytics,
      })
    : null;
  /** The turn each proposal card came from, so its outcome reaches the right record. */
  const turnOfEntry = new Map<string, string>();

  const editor = options.editor;
  const proposals = editor
    ? useAssistantProposals({
        session: editor.session,
        controls: editor.controls,
        project: options.project,
        analytics: options.analytics,
        // The conversation is made just below; Refresh is only ever pressed later.
        refresh: (entryId) => conversation.refresh(entryId),
        onOutcome: (entryId, outcome) => {
          const turnId = turnOfEntry.get(entryId);
          if (turnId) retention?.reportOutcome(turnId, outcome);
        },
      })
    : null;

  const conversation = useAssistantConversation({
    client: options.client,
    project: options.project,
    scope,
    // Nobody messages the assistant before answering the disclosure (GRV-8).
    canSend: () =>
      options.account().registered && (retention ? retention.answered() : true),
    analytics: options.analytics,
    onProposal: proposals
      ? (entryId, proposal, origin) => {
          if (origin.turnId) turnOfEntry.set(entryId, origin.turnId);
          proposals.receive(entryId, proposal, origin);
        }
      : undefined,
    session: retentionOptions
      ? () => {
          const project = options.project();
          return {
            projectId: project?.metadata.id ?? "",
            internal: retentionOptions.internal(),
          };
        }
      : undefined,
    remoteChanges: proposals ? () => proposals.remoteChanges() : undefined,
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
    retention,
  };
}
