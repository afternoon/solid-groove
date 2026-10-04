/**
 * Who may sign in during the alpha (#854): the allowlist contract written down
 * once.
 *
 * Only allowlisted email addresses can sign in. A blocking `beforeSignIn` Auth
 * function (`functions/src/index.ts`) is the enforcement; everything the
 * browser knows about the list is for its own UI. The list lives in Firestore
 * at `allowlist/{normalisedEmail}`, and every refused sign-in is recorded at
 * `signInAttempts/{normalisedEmail}` so an admin can approve it in one click.
 *
 * This module imports nothing, so the Cloud Function bundle, the admin page,
 * the terminal scripts (`scripts/access/`) and the tests all share one
 * normaliser, one batch parser and one set of paths. `firestore.rules` cannot
 * import it, so it repeats the collection names and the document fields, and
 * `allowlist.test.ts` fails if the two drift apart.
 */

/** The allowlist collection: one document per normalised email address. */
export const ALLOWLIST_COLLECTION = "allowlist";

/** Refused sign-ins, one document per normalised email address. */
export const SIGN_IN_ATTEMPTS_COLLECTION = "signInAttempts";

/** One allowlisted address. The document ID is {@link AllowlistEntry.email}. */
export interface AllowlistEntry {
  email: string;
  /** Epoch milliseconds. */
  addedAt: number;
}

/** Every refused sign-in for one address, folded into one document. */
export interface SignInAttempt {
  email: string;
  /** Epoch milliseconds of the first refused sign-in. */
  firstAttemptAt: number;
  /** Epoch milliseconds of the latest refused sign-in. */
  lastAttemptAt: number;
  count: number;
}

/** The fields `firestore.rules` accepts on an allowlist document, in order. */
export const ALLOWLIST_ENTRY_FIELDS = ["email", "addedAt"] as const;

/**
 * The marker the blocking function puts in the error it refuses a sign-in
 * with. Firebase hands the browser a generic `auth/internal-error` for every
 * blocking-function refusal, with the function's message inside it, so this
 * string is how the browser tells "not on the list" apart from a broken
 * provider. It names no person.
 */
export const NOT_ON_ALLOWLIST = "GROOVE_NOT_ON_ALPHA_LIST";

/**
 * Whether a failed sign-in (or a guest's failed link) was the allowlist
 * refusing it, as opposed to a closed popup or a broken provider. Reads the
 * message rather than the code, because the code is the generic
 * `auth/internal-error` every blocking-function refusal shares.
 */
export function isNotOnAllowlistError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && message.includes(NOT_ON_ALLOWLIST);
}

/**
 * Emails compare trimmed and lower-cased, everywhere. Gmail ignores case, and
 * so does every provider anyone signs in with here, so `Ada@Example.com` and
 * `ada@example.com` are one person and one document.
 */
export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * A plausible address: something, an `@`, a domain with a dot, no spaces. Not
 * RFC 5322; the point is to catch a pasted name or a stray header, and Google
 * has already verified any address that actually signs in.
 */
export function isValidEmail(normalised: string): boolean {
  return /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>".]+$/.test(normalised);
}

export function allowlistDocPath(email: string): string {
  return `${ALLOWLIST_COLLECTION}/${normaliseEmail(email)}`;
}

export function signInAttemptDocPath(email: string): string {
  return `${SIGN_IN_ATTEMPTS_COLLECTION}/${normaliseEmail(email)}`;
}

/** What a pasted batch of addresses comes to. */
export interface ParsedEmailBatch {
  /** Normalised, valid, each once, in the order first seen. */
  emails: string[];
  /** Tokens that are not an address, as written, each once. */
  invalid: string[];
}

/**
 * A column heading from a spreadsheet or the Tally export (`Email`, `E-mail`,
 * `Email address`), which is pasted along with the column and is not a typo
 * worth reporting.
 */
const HEADING = /^e-?mail(\s+address)?$/i;

/**
 * Reads any number of addresses out of pasted text: one per line, separated by
 * commas or semicolons, a column pasted from a spreadsheet or the Tally export
 * (cells may be quoted, and a tab-separated row contributes every cell), or
 * `Name <address>`. The admin page and both terminal scripts call this, so a
 * paste approves the same addresses wherever it is pasted.
 */
export function parseEmailBatch(text: string): ParsedEmailBatch {
  const emails: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  const seenInvalid = new Set<string>();

  for (const raw of text.split(/[\n\r,;\t]+/)) {
    const cell = raw
      .trim()
      .replace(/^["']+|["']+$/g, "")
      .trim();
    if (cell === "" || HEADING.test(cell)) continue;
    const bracketed = cell.match(/<([^<>]+)>/);
    const email = normaliseEmail(bracketed ? bracketed[1] : cell);
    if (!isValidEmail(email)) {
      if (!seenInvalid.has(cell)) {
        seenInvalid.add(cell);
        invalid.push(cell);
      }
      continue;
    }
    if (seen.has(email)) continue;
    seen.add(email);
    emails.push(email);
  }

  return { emails, invalid };
}

/**
 * The store an approval writes through: Firestore from the admin page, the
 * Admin SDK from a script, a map in a test. `commit` adds every address and
 * removes its sign-in attempt in one batch, so an approval is never half done.
 */
export interface AllowlistWriter {
  /** Which of these addresses are on the list already. */
  listed(emails: readonly string[]): Promise<Set<string>>;
  /** Adds each entry and deletes each address's attempt, atomically. */
  commit(
    entries: readonly AllowlistEntry[],
    clearAttempts: readonly string[],
  ): Promise<void>;
}

/** What an approval did, for the page and the scripts to report. */
export interface ApprovalReport {
  added: string[];
  alreadyListed: string[];
  invalid: string[];
}

/**
 * Approves a parsed batch: adds every address not yet listed in one write and
 * clears the sign-in attempt of every address in the batch, listed already or
 * not, so an approved person drops off the "blocked" list either way.
 */
export async function approveEmails(
  writer: AllowlistWriter,
  batch: ParsedEmailBatch,
  now: number,
): Promise<ApprovalReport> {
  const listed = await writer.listed(batch.emails);
  const added = batch.emails.filter((email) => !listed.has(email));
  const alreadyListed = batch.emails.filter((email) => listed.has(email));
  if (batch.emails.length > 0) {
    await writer.commit(
      added.map((email) => ({ email, addedAt: now })),
      batch.emails,
    );
  }
  return { added, alreadyListed, invalid: batch.invalid };
}

/** The most writes one Firestore batch accepts. */
export const MAX_BATCH_WRITES = 500;

/**
 * Splits an approval into Firestore-sized batches: each address is up to two
 * writes (the entry and the attempt it clears), so a batch holds half the
 * limit's worth of addresses. A paste longer than that is approved in several
 * writes, each of which is still all-or-nothing.
 */
export function approvalChunks<T>(items: readonly T[]): T[][] {
  const size = MAX_BATCH_WRITES / 2;
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}
