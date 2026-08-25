// Shared runtime schema validation.
//
// PRD section 9.1 commits to Zod for runtime schemas ("Prefer Zod for
// runtime schemas ... unless a concrete incompatibility is documented before
// implementation"), and 9.5's invariant 4 requires "all user-controlled
// numeric values have shared validation and clamping rules." `FND-002` owns
// the actual schema-v1 domain schemas; this file is the small, reusable
// entry point they (and any other validated boundary — commands, the
// persistence layer, assistant tool payloads) parse through, so every
// caller reports and fails the same way instead of each reinventing
// `ZodError` handling.

import { type ZodType, z } from "zod";

export class SchemaValidationError extends Error {
  readonly issues: readonly z.core.$ZodIssue[];

  constructor(message: string, issues: readonly z.core.$ZodIssue[]) {
    super(message);
    this.name = "SchemaValidationError";
    this.issues = issues;
  }
}

function formatIssues(issues: readonly z.core.$ZodIssue[]): string {
  return issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

/**
 * Parses `value` against `schema`, per PRD invariant 6 ("structural commands
 * leave the project valid or make no change"): on failure this throws before
 * any caller can read a partially-valid result, rather than returning
 * `undefined` or a best-effort partial object.
 */
export function parseOrThrow<T>(schema: ZodType<T>, value: unknown, context?: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const detail = formatIssues(result.error.issues);
    throw new SchemaValidationError(
      context ? `${context}: ${detail}` : detail,
      result.error.issues,
    );
  }
  return result.data;
}

/** Non-throwing counterpart, for callers that want to present errors themselves. */
export function safeParseWithIssues<T>(
  schema: ZodType<T>,
  value: unknown,
): { success: true; data: T } | { success: false; issues: string } {
  const result = schema.safeParse(value);
  if (!result.success) {
    return { success: false, issues: formatIssues(result.error.issues) };
  }
  return { success: true, data: result.data };
}

/**
 * A finite, clamped numeric schema — the "shared validation and clamping
 * rules" PRD invariant 4 asks for. `FND-002`'s parameter-definition
 * mechanism builds on this for per-parameter ranges; this is the
 * general-purpose primitive it and any other bounded value can share.
 */
export function finiteNumberInRange(min: number, max: number): ZodType<number> {
  return z.number().finite().min(min).max(max);
}
