// A bare `CommandHistory` as an assistant proposal target (helpers only tests
// use).
//
// The editor hands the executor its session (`src/editor/assistantProposalTarget.ts`)
// so a proposal is autosaved; the executor's own tests only need the history.

import type { ProposalTarget } from "../assistant/proposalExecutor";
import type { CommandHistory } from "../commands";

export function historyProposalTarget(history: CommandHistory): ProposalTarget {
  return {
    get project() {
      return history.project;
    },
    get gestureActive() {
      return history.gestureActive;
    },
    get latestCorrelationId() {
      return history.entries[history.entries.length - 1]?.correlationId ?? null;
    },
    execute: (commands, options) => history.execute(commands, options),
    undo: () => history.undo(),
  };
}
