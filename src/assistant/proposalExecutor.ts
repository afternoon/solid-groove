/**
 * Applying, cancelling and undoing an assistant proposal (GRV-4, PRD AI-03).
 *
 * The executor wraps the command history a manual edit goes through; it adds
 * no mutation path of its own. `propose` validates the model's response
 * (`proposal.ts`) and hands back a {@link ProposalHandle}:
 *
 * - `apply()` executes the proposal's commands as one transaction, as the
 *   `assistant` actor and pinned to the revision the proposal was validated
 *   against: one revision, one history entry, or no change at all. A project
 *   that moved in the meantime makes the proposal `stale`; it can be
 *   cancelled, never applied.
 * - `cancel()` changes nothing.
 * - `undo()` replays the entry's inverse through the history, but only while
 *   the proposal is still the newest entry, so it can never undo someone
 *   else's edit by mistake.
 *
 * Each step logs its `assistant_proposal_*` event through the injected
 * analytics, with the proposal's capability, a bucketed command count and,
 * for a decision or an undo, a bucketed time. The intent, the summaries and
 * the payloads never go near it.
 */
import type { Analytics } from "../analytics/analytics";
import { bucketOf } from "../analytics/buckets";
import {
  createCorrelationId,
  type TransactionOptions,
  type TransactionResult,
  type TransactionSuccess,
} from "../commands/execute";
import type { CommandIssue, RawCommandInput } from "../commands/types";
import type { Project } from "../domain/entities";
import { type Clock, systemClock } from "../shared/clock";
import { type ProposalIssue, type ValidProposal, validateProposal } from "./proposal";

/**
 * What the executor applies to: the command history (or the editor session
 * around it). `CommandHistory` satisfies it as it stands.
 */
export interface ProposalTarget {
  /** The committed project. */
  readonly project: Project;
  /** Undo entries, oldest first; only the newest one's correlation ID is read. */
  readonly entries: readonly { readonly correlationId: string }[];
  execute(
    commands: readonly RawCommandInput[],
    options: TransactionOptions,
  ): TransactionResult;
  undo(): TransactionResult | null;
}

/** The analytics the executor logs through. */
export type ProposalAnalytics = Pick<Analytics, "log">;

export interface ProposalExecutorOptions {
  readonly target: ProposalTarget;
  readonly analytics: ProposalAnalytics;
  readonly clock?: Clock;
}

/**
 * - `pending`: shown, not yet decided.
 * - `applied`: committed as one history entry.
 * - `cancelled`: the producer turned it down; nothing changed.
 * - `stale`: the project moved under it; it can only be cancelled.
 * - `undone`: applied, then undone.
 */
export type ProposalStatus = "pending" | "applied" | "cancelled" | "stale" | "undone";

export type ProposalRefusal =
  /** The proposal is not in a state this action applies to. */
  | "not_pending"
  | "not_applied"
  /** The project moved since the proposal was validated. */
  | "stale"
  /** Something was committed after the proposal, so undoing it is not exact. */
  | "not_latest"
  /** The kernel refused (cannot happen for a proposal that dry-ran cleanly). */
  | "failed";

export type ProposalActionResult =
  | { readonly ok: true; readonly result: TransactionSuccess | null }
  | {
      readonly ok: false;
      readonly reason: ProposalRefusal;
      readonly issues: readonly CommandIssue[];
    };

export interface ProposalHandle {
  /** The correlation ID the applied transaction and its history entry carry. */
  readonly id: string;
  readonly proposal: ValidProposal;
  readonly status: ProposalStatus;
  apply(): ProposalActionResult;
  cancel(): ProposalActionResult;
  undo(): ProposalActionResult;
}

export type ProposeResult =
  | { readonly ok: true; readonly handle: ProposalHandle }
  | { readonly ok: false; readonly issues: readonly ProposalIssue[] };

export interface ProposalExecutor {
  /**
   * Validates a model's proposal against the target's committed project.
   * A valid one is shown (`assistant_proposal_shown`) and returned as a
   * pending handle; an invalid one changes nothing and logs nothing.
   */
  propose(input: unknown): ProposeResult;
}

function seconds(fromMs: number, toMs: number): number {
  return (toMs - fromMs) / 1000;
}

function refuse(
  reason: ProposalRefusal,
  issues: readonly CommandIssue[] = [],
): ProposalActionResult {
  return { ok: false, reason, issues };
}

class Handle implements ProposalHandle {
  readonly id = createCorrelationId("asp");
  #status: ProposalStatus = "pending";
  readonly #shownAt: number;
  #appliedAt = 0;

  constructor(
    readonly proposal: ValidProposal,
    private readonly options: Required<ProposalExecutorOptions>,
  ) {
    this.#shownAt = options.clock.now();
    options.analytics.log("assistant_proposal_shown", {
      capability: proposal.capability,
      command_count_bucket: this.#commandCount(),
    });
  }

  get status(): ProposalStatus {
    return this.#status;
  }

  apply(): ProposalActionResult {
    if (this.#status !== "pending") return refuse("not_pending");
    const { target, analytics, clock } = this.options;
    const result = target.execute(this.proposal.commands, {
      actor: "assistant",
      correlationId: this.id,
      baseRevision: this.proposal.baseRevision,
    });
    if (!result.ok) {
      const stale = result.issues.some((issue) => issue.code === "revision_conflict");
      if (stale) this.#status = "stale";
      return refuse(stale ? "stale" : "failed", result.issues);
    }
    this.#status = "applied";
    this.#appliedAt = clock.now();
    analytics.log("assistant_proposal_applied", {
      capability: this.proposal.capability,
      command_count_bucket: this.#commandCount(),
      seconds_to_decision_bucket: bucketOf(
        "elapsed_seconds",
        seconds(this.#shownAt, this.#appliedAt),
      ),
    });
    return { ok: true, result };
  }

  cancel(): ProposalActionResult {
    if (this.#status !== "pending" && this.#status !== "stale") {
      return refuse("not_pending");
    }
    const { analytics, clock } = this.options;
    this.#status = "cancelled";
    analytics.log("assistant_proposal_cancelled", {
      capability: this.proposal.capability,
      command_count_bucket: this.#commandCount(),
      seconds_to_decision_bucket: bucketOf(
        "elapsed_seconds",
        seconds(this.#shownAt, clock.now()),
      ),
    });
    return { ok: true, result: null };
  }

  undo(): ProposalActionResult {
    if (this.#status !== "applied") return refuse("not_applied");
    const { target, analytics, clock } = this.options;
    const newest = target.entries[target.entries.length - 1];
    if (newest?.correlationId !== this.id) return refuse("not_latest");
    const result = target.undo();
    if (!result) return refuse("not_latest");
    if (!result.ok) return refuse("failed", result.issues);
    this.#status = "undone";
    analytics.log("assistant_proposal_undone", {
      capability: this.proposal.capability,
      command_count_bucket: this.#commandCount(),
      seconds_to_undo_bucket: bucketOf(
        "elapsed_seconds",
        seconds(this.#appliedAt, clock.now()),
      ),
    });
    return { ok: true, result };
  }

  #commandCount() {
    return bucketOf("command_count", this.proposal.commands.length);
  }
}

export function createProposalExecutor(
  options: ProposalExecutorOptions,
): ProposalExecutor {
  const resolved: Required<ProposalExecutorOptions> = {
    clock: systemClock,
    ...options,
  };
  return {
    propose(input) {
      const validation = validateProposal(resolved.target.project, input);
      if (!validation.ok) return validation;
      return { ok: true, handle: new Handle(validation.proposal, resolved) };
    },
  };
}
