import type { z } from "zod";

/**
 * Parsing and cross-entity integrity (PRD section 9.5).
 *
 * `parseProject` is the only way to obtain a `Project`. It validates shape,
 * schema version, and every relationship, and either returns a complete valid
 * project or a list of issues — it never mutates its input and never returns
 * partially repaired state.
 *
 * This module holds the primitives every other invariant module shares: the
 * issue shape, zod/schema plumbing, and the two cross-cutting helpers
 * (`claimId`, `checkOrdering`) so the dependency graph between invariant
 * modules stays acyclic and one-directional.
 */

export type DomainIssueCode =
	| "invalid_shape"
	| "unsupported_schema_version"
	| "duplicate_id"
	| "dangling_reference"
	| "cross_owner_reference"
	| "invalid_order"
	| "invalid_parameter"
	| "invalid_automation"
	| "invalid_musical_time"
	| "invalid_metadata"
	/** A track's insert count or the song's return count exceeds its ceiling. */
	| "capacity_exceeded"
	/** An asset names a pack the project does not declare, or a wrong version. */
	| "invalid_pack_reference";

export interface DomainIssue {
	readonly code: DomainIssueCode;
	readonly path: ReadonlyArray<string | number>;
	readonly message: string;
}

export type ParseResult<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly issues: readonly DomainIssue[] };

export class DomainValidationError extends Error {
	readonly issues: readonly DomainIssue[];

	constructor(message: string, issues: readonly DomainIssue[]) {
		super(`${message}: ${issues.map(formatIssue).join("; ")}`);
		this.name = "DomainValidationError";
		this.issues = issues;
	}
}

export function formatIssue(issue: DomainIssue): string {
	const path = issue.path.length > 0 ? issue.path.join(".") : "<root>";
	return `[${issue.code}] ${path}: ${issue.message}`;
}

export function issue(
	code: DomainIssueCode,
	path: ReadonlyArray<string | number>,
	message: string,
): DomainIssue {
	return { code, path, message };
}

export function fromZod(error: z.ZodError): DomainIssue[] {
	return error.issues.map((zodIssue) =>
		issue(
			"invalid_shape",
			zodIssue.path as (string | number)[],
			zodIssue.message,
		),
	);
}

export function parseWith<T>(
	schema: { safeParse: (input: unknown) => z.ZodSafeParseResult<T> },
	input: unknown,
): ParseResult<T> {
	const result = schema.safeParse(input);
	return result.success
		? { ok: true, value: result.data }
		: { ok: false, issues: fromZod(result.error) };
}

export function claimId(
	seenIds: Set<string>,
	id: string,
	path: ReadonlyArray<string | number>,
	issues: DomainIssue[],
): void {
	if (seenIds.has(id)) {
		issues.push(issue("duplicate_id", path, `Duplicate entity id ${id}`));
	}
	seenIds.add(id);
}

/** Insert chains and track lists are serial: orders are 0..n-1 exactly once. */
export function checkOrdering(
	orders: readonly number[],
	path: ReadonlyArray<string | number>,
	label: string,
): DomainIssue[] {
	const sorted = [...orders].sort((a, b) => a - b);
	const contiguous = sorted.every((order, index) => order === index);
	return contiguous
		? []
		: [
				issue(
					"invalid_order",
					path,
					`Order values for ${label} must be 0..${orders.length - 1} without gaps or duplicates, received [${orders.join(", ")}]`,
				),
			];
}
