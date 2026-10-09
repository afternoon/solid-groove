/**
 * What an assistant proposal's card shows (GRV-5): a row per control it would
 * change, old to new; where Preview takes the editor; and "Why this works".
 * Pure functions of the project and the validated proposal, so the card's
 * words are testable without rendering it.
 */

import type { ValidProposal } from "../../assistant/proposal";
import {
  CONTROL_PARTS,
  type ControlAddress,
  controlKey,
} from "../../commands/controlAddress";
import { executeTransaction } from "../../commands/execute";
import { readControl } from "../../controls/readControl";
import type { Project } from "../../domain/entities";
import { controlHome } from "../controlReveal";
import type { EditorViewName } from "../editorViews";

/** One control the proposal changes, as the card lists it. */
export interface ProposalRow {
  readonly address: ControlAddress;
  readonly label: string;
  /** What it reads now; `null` when it has no single value, or does not exist yet. */
  readonly from: string | null;
  /** What it would read; `null` when it has no single value, or would be gone. */
  readonly to: string | null;
  /** Whether the proposal creates it, or removes it. */
  readonly change: "changed" | "added" | "removed";
}

/** Library bookkeeping a command records, with no control a producer would look at. */
const BOOKKEEPING: ReadonlySet<string> = new Set([
  CONTROL_PARTS.packs,
  CONTROL_PARTS.assets,
]);

/** The project the proposal would leave, or `before` itself if it no longer applies. */
export function projectAfter(before: Project, proposal: ValidProposal): Project {
  const result = executeTransaction(before, proposal.commands, {
    actor: "assistant",
    commitRevision: false,
  });
  return result.ok ? result.project : before;
}

/**
 * A row per control the proposal changes, in the order its commands touch
 * them, each read in the project before and after it. A control with nothing
 * to read on either side keeps its place under a plain label, so the list
 * never hides a change.
 */
export function proposalRows(
  before: Project,
  after: Project,
  controls: readonly ControlAddress[],
): ProposalRow[] {
  return controls
    .filter((address) => !BOOKKEEPING.has(address.param))
    .map((address) => {
      const was = readControl(before, address);
      const now = readControl(after, address);
      return {
        address,
        label: now?.label ?? was?.label ?? "A change",
        from: was?.value ?? null,
        to: now?.value ?? null,
        change: !was && now ? "added" : was && !now ? "removed" : "changed",
      };
    });
}

/**
 * The control Preview reveals: the first one that lives in a particular
 * view, so the editor goes where the change can be seen. A proposal whose
 * every control is in the header (the tempo) stays on the view it is on.
 */
export function previewTarget(
  project: Project,
  rows: readonly ProposalRow[],
): { readonly address: ControlAddress; readonly view: EditorViewName | null } | null {
  let first: { address: ControlAddress; view: EditorViewName | null } | null = null;
  for (const row of rows) {
    const home = controlHome(project, row.address);
    if (home.view) return { address: row.address, view: home.view };
    first ??= { address: row.address, view: null };
  }
  return first;
}

/** One step of the technique: what a command does, and the control it does it to. */
export interface TechniqueStep {
  readonly text: string;
  readonly address: ControlAddress | null;
}

/** "Why this works": the goal, the technique and the controls it changes. */
export interface ProposalExplanation {
  /** The audible goal, in the producer's words or the assistant's intent. */
  readonly goal: string;
  readonly technique: readonly TechniqueStep[];
  readonly changed: readonly ProposalRow[];
}

/**
 * Explains a proposal from what it actually does. The goal is what the
 * proposal says it is for, or else what the producer asked; the technique is
 * each command's own one-line summary, which the kernel derives from the
 * command, so it can never describe a change the proposal does not make.
 */
export function explainProposal(
  proposal: ValidProposal,
  asked: string,
  rows: readonly ProposalRow[],
): ProposalExplanation {
  const shown = new Set(rows.map((row) => controlKey(row.address)));
  return {
    goal: proposal.intent?.trim() || asked,
    technique: proposal.impact.lines.map((line) => ({
      text: line.summary,
      address: line.controls.find((address) => shown.has(controlKey(address))) ?? null,
    })),
    changed: rows,
  };
}
