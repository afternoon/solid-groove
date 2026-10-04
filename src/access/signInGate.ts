/**
 * The decision the blocking `beforeSignIn` function makes (#854), kept apart
 * from Firebase so it is unit-tested here and runs unchanged in the function
 * (`functions/src/index.ts`), which only supplies the store.
 */
import { isValidEmail, normaliseEmail, type SignInAttempt } from "./allowlist";

/** What the gate reads and writes, over Firestore in the function. */
export interface SignInGateStore {
  isListed(email: string): Promise<boolean>;
  /**
   * Folds one refused sign-in into the address's attempt document: creates it
   * on the first, otherwise bumps `count` and `lastAttemptAt` and keeps
   * `firstAttemptAt`. A read-modify-write, so the store runs it in a
   * transaction.
   */
  recordAttempt(
    email: string,
    update: (previous: SignInAttempt | null) => SignInAttempt,
  ): Promise<void>;
}

/** The part of a signing-in user the gate looks at. */
export interface SigningInUser {
  email?: string | null;
}

export type SignInDecision =
  | { allowed: true }
  /** `no_email`: an anonymous sign-in, or a provider that gave no address. */
  | { allowed: false; reason: "not_listed" | "no_email" };

/** The attempt document after one more refusal at `now`. */
export function nextAttempt(
  previous: SignInAttempt | null,
  email: string,
  now: number,
): SignInAttempt {
  if (!previous) return { email, firstAttemptAt: now, lastAttemptAt: now, count: 1 };
  return {
    email,
    firstAttemptAt: previous.firstAttemptAt,
    lastAttemptAt: now,
    count: previous.count + 1,
  };
}

/**
 * Lets an allowlisted address in and refuses everything else.
 *
 * A sign-in with no address is refused too: that is a new guest session, and
 * guest start is retired. A guest who already has a session never reaches
 * here, because restoring a session or refreshing its token is not a sign-in.
 * A guest *linking* Google is, and it carries the Google address, so an upgrade
 * to an unlisted account is refused like any other sign-in.
 *
 * A refused address is recorded so an admin can approve it from the list.
 */
export async function gateSignIn(
  store: SignInGateStore,
  user: SigningInUser,
  now: number,
): Promise<SignInDecision> {
  const email = normaliseEmail(user.email ?? "");
  if (!isValidEmail(email)) return { allowed: false, reason: "no_email" };
  if (await store.isListed(email)) return { allowed: true };
  await store.recordAttempt(email, (previous) => nextAttempt(previous, email, now));
  return { allowed: false, reason: "not_listed" };
}
