/**
 * Who `bun run allowlist:seed` may grandfather onto the alpha allowlist
 * (#854), decided once and tested.
 *
 * A sign-in the blocking gate refuses still creates its Firebase Auth account,
 * Google provider and address included. So "every account with a provider"
 * is only the set of people who already signed in up to the moment the gate
 * deploys; after that it also holds everyone the gate turned away, and
 * seeding from it would quietly approve them all.
 *
 * Three rules keep that from happening:
 *
 * 1. An address with a refused sign-in on record (`signInAttempts`) is never
 *    seeded, whatever else is true of it.
 * 2. Once the gate has refused anyone, seeding refuses to run at all unless it
 *    is given a cutoff: the moment the gate was deployed. A refusal can fail
 *    to record, and an attempt is cleared when someone is approved and then
 *    removed again, so rule 1 alone cannot be trusted after enforcement.
 * 3. With a cutoff, only accounts created strictly before it are seeded.
 *    Everyone who signed up after the gate deployed came through the gate,
 *    and the gate, not this script, decides about them.
 */
import { isValidEmail, normaliseEmail } from "./allowlist";

/** One Firebase Auth account, as much of it as the decision reads. */
export interface SeedCandidate {
  email: string | undefined;
  /** Whether the account signs in with a provider (a guest has none). */
  hasProvider: boolean;
  /** Epoch milliseconds the account was created. */
  createdAt: number;
}

export interface GrandfatherInput {
  accounts: readonly SeedCandidate[];
  /** Every address in `signInAttempts`, normalised or not. */
  refusedEmails: readonly string[];
  /** Epoch milliseconds the gate was deployed, when seeding after that. */
  createdBefore?: number;
}

export type GrandfatherPlan =
  | {
      ok: true;
      /** Normalised, each once, in account order. */
      emails: string[];
      /** Addresses left out because the gate refused them. */
      skippedRefused: string[];
      /** Addresses left out because their account postdates the cutoff. */
      skippedAfterCutoff: string[];
    }
  | { ok: false; reason: "gate-has-refused"; refusedCount: number };

export function planGrandfathering(input: GrandfatherInput): GrandfatherPlan {
  const refused = new Set(input.refusedEmails.map(normaliseEmail));
  if (refused.size > 0 && input.createdBefore === undefined) {
    return { ok: false, reason: "gate-has-refused", refusedCount: refused.size };
  }

  const emails: string[] = [];
  const skippedRefused: string[] = [];
  const skippedAfterCutoff: string[] = [];
  const seen = new Set<string>();
  for (const account of input.accounts) {
    if (!account.hasProvider || !account.email) continue;
    const email = normaliseEmail(account.email);
    if (!isValidEmail(email) || seen.has(email)) continue;
    seen.add(email);
    if (refused.has(email)) skippedRefused.push(email);
    else if (
      input.createdBefore !== undefined &&
      !(account.createdAt < input.createdBefore)
    ) {
      skippedAfterCutoff.push(email);
    } else emails.push(email);
  }
  return { ok: true, emails, skippedRefused, skippedAfterCutoff };
}

/**
 * Reads `--before <ISO timestamp>` for the seed script. A value that is not a
 * date is an error rather than "no cutoff", which would be the unsafe reading.
 */
export function parseCreatedBefore(
  args: readonly string[],
): { ok: true; createdBefore?: number } | { ok: false; error: string } {
  const index = args.indexOf("--before");
  if (index === -1) return { ok: true };
  const value = args[index + 1];
  const time = value === undefined ? Number.NaN : Date.parse(value);
  if (Number.isNaN(time)) {
    return {
      ok: false,
      error: "--before needs an ISO timestamp, e.g. --before 2026-10-01T12:00:00Z",
    };
  }
  return { ok: true, createdBefore: time };
}
