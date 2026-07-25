import { nanoid } from "nanoid";
import type { Project } from "../domain/entities";
import { checkProjectIntegrity } from "../domain/parse";
import { type Clock, systemClock } from "../shared/clock";
import { findCommand } from "./registry";
import type {
	CommandActor,
	CommandEnvelope,
	CommandIssue,
	CommandIssueCode,
	RawCommandInput,
} from "./types";

/**
 * Command and transaction execution.
 *
 * A transaction is the atomic unit: its commands are applied in order to a
 * working copy, the result is checked against every domain invariant, and only
 * then does it become the new project. Any failure at any step returns the
 * original project object untouched — "leaves the project valid or makes no
 * change" (invariant 6) is enforced here rather than trusted to each command.
 *
 * Exactly one revision is produced per committed transaction, so a revision
 * number, a history entry, and an autosave write all mean the same thing.
 */

export interface TransactionOptions {
	/** Who asked for the change. Defaults to `user`. */
	readonly actor?: CommandActor;
	/** Groups the commands of one request; generated when omitted. */
	readonly correlationId?: string;
	/**
	 * Refuses the transaction unless the project is still at this revision.
	 * Used for commands built earlier, remotely, or by the assistant.
	 */
	readonly baseRevision?: number;
	/** Overrides the summary derived from the commands. */
	readonly summary?: string;
	readonly clock?: Clock;
	/**
	 * When false the project's revision and `modifiedAt` are left alone. A
	 * gesture uses this for its intermediate steps and commits one revision
	 * when it ends.
	 */
	readonly commitRevision?: boolean;
}

export interface TransactionSuccess {
	readonly ok: true;
	readonly project: Project;
	readonly commands: readonly CommandEnvelope[];
	/** Commands that undo this transaction, already in reverse order. */
	readonly inverse: readonly RawCommandInput[];
	readonly summary: string;
	readonly actor: CommandActor;
	readonly correlationId: string;
	readonly baseRevision: number;
	readonly revision: number;
	readonly timestamp: number;
}

export interface TransactionFailure {
	readonly ok: false;
	/** The original project, unchanged and referentially identical. */
	readonly project: Project;
	readonly issues: readonly CommandIssue[];
}

export type TransactionResult = TransactionSuccess | TransactionFailure;

/**
 * Correlation IDs group the commands of one user action, request, or
 * assistant proposal. They are not entity IDs — nothing persists or resolves
 * them — so they use their own `cor_` prefix outside the domain ID table.
 */
export function createCorrelationId(prefix = "cor"): string {
	return `${prefix}_${nanoid(21)}`;
}

function fail(
	project: Project,
	code: CommandIssueCode,
	commandType: string,
	commandIndex: number,
	message: string,
	domainIssues?: CommandIssue["domainIssues"],
): TransactionFailure {
	return {
		ok: false,
		project,
		issues: [{ code, commandType, commandIndex, message, domainIssues }],
	};
}

/** Applies one command as a single-command transaction. */
export function executeCommand(
	project: Project,
	command: RawCommandInput,
	options: TransactionOptions = {},
): TransactionResult {
	return executeTransaction(project, [command], options);
}

/**
 * Applies a list of commands atomically. Either every command applies and the
 * result is a valid project, or nothing changes.
 */
export function executeTransaction(
	project: Project,
	commands: readonly RawCommandInput[],
	options: TransactionOptions = {},
): TransactionResult {
	const actor = options.actor ?? "user";
	const correlationId = options.correlationId ?? createCorrelationId();
	const baseRevision = project.metadata.revision;

	if (commands.length === 0) {
		return fail(
			project,
			"rejected",
			"(transaction)",
			0,
			"A transaction needs at least one command",
		);
	}
	if (
		options.baseRevision !== undefined &&
		options.baseRevision !== baseRevision
	) {
		return fail(
			project,
			"revision_conflict",
			commands[0].type,
			0,
			`Command was built against revision ${options.baseRevision}, but the project is at revision ${baseRevision}`,
		);
	}

	const envelopes: CommandEnvelope[] = [];
	const inverse: RawCommandInput[] = [];
	const summaries: string[] = [];
	let working = project;

	for (let index = 0; index < commands.length; index += 1) {
		const input = commands[index];
		const definition = findCommand(input.type);
		if (!definition) {
			return fail(
				project,
				"unknown_command",
				input.type,
				index,
				`No command is registered as "${input.type}"`,
			);
		}
		if (input.version !== undefined && input.version !== definition.version) {
			return fail(
				project,
				"unsupported_command_version",
				input.type,
				index,
				`This build implements "${input.type}" version ${definition.version}, received version ${input.version}`,
			);
		}
		const parsed = definition.parsePayload(input.payload);
		if (!parsed.ok) {
			return fail(
				project,
				"invalid_payload",
				input.type,
				index,
				parsed.message,
			);
		}
		const result = definition.apply(working, parsed.payload);
		if (!result.ok) {
			return fail(project, "rejected", input.type, index, result.message);
		}
		summaries.push(definition.summarize(parsed.payload, working));
		// Inverses run newest-first, and each command's inverse is generated
		// against the state it saw, not the final state.
		inverse.unshift(
			...definition.invert(parsed.payload, working, result.project),
		);
		envelopes.push({
			type: definition.type,
			version: definition.version,
			payload: parsed.payload,
			actor,
			correlationId,
			baseRevision,
		});
		working = result.project;
	}

	const clock = options.clock ?? systemClock;
	const timestamp = clock.now();
	const commitRevision = options.commitRevision !== false;
	const committed = commitRevision
		? {
				...working,
				metadata: {
					...working.metadata,
					revision: baseRevision + 1,
					// A clock set behind the project's creation time must not
					// produce metadata that fails its own invariant.
					modifiedAt: Math.max(timestamp, working.metadata.createdAt),
				},
			}
		: working;

	const domainIssues = checkProjectIntegrity(committed);
	if (domainIssues.length > 0) {
		return fail(
			project,
			"invalid_project",
			envelopes[envelopes.length - 1].type,
			envelopes.length - 1,
			`The change would leave the project invalid: ${domainIssues[0].message}`,
			domainIssues,
		);
	}

	return {
		ok: true,
		project: committed,
		commands: envelopes,
		inverse,
		summary: options.summary ?? summarize(summaries),
		actor,
		correlationId,
		baseRevision,
		revision: committed.metadata.revision,
		timestamp,
	};
}

function summarize(summaries: readonly string[]): string {
	if (summaries.length === 1) {
		return summaries[0];
	}
	return `${summaries[0]} (+${summaries.length - 1} more ${
		summaries.length === 2 ? "change" : "changes"
	})`;
}
