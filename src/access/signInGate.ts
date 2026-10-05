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
  /** Whether the provider vouched for the address. */
  emailVerified?: boolean;
  /** The provider this sign-in came through, e.g. `google.com`. */
  providerId?: string | null;
}

export type SignInDecision =
  | { allowed: true }
  /**
   * `no_email`: a provider that gave no address. `unverified`: an address
   * nobody has shown they own, which could be anyone's.
   */
  | { allowed: false; reason: "not_listed" | "no_email" | "unverified" };

/**
 * Whether the address is known to belong to whoever is signing in: the
 * provider says it verified it, or the provider is Google, whose addresses
 * are its own accounts.
 */
function addressIsVerified(user: SigningInUser): boolean {
  return user.emailVerified === true || user.providerId === "google.com";
}

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
 * Lets a verified, allowlisted address in and refuses everything else.
 *
 * A sign-in with no address is refused: a provider that gives none cannot be
 * matched against the list. That is *not* how guest start is closed: Firebase
 * never runs a blocking function for an anonymous sign-in, so a new guest
 * session never reaches here at all. Disabling the Anonymous provider is the
 * control for that (`docs/runbooks/alpha-allowlist.md`). A guest who already
 * has a session never reaches here either, because restoring a session or
 * refreshing its token is not a sign-in. A guest *linking* Google is, and it
 * carries the Google address, so an upgrade to an unlisted account is refused
 * like any other sign-in.
 *
 * An address the provider has not verified is refused even when it is
 * listed, since anyone could have typed it, and is not recorded.
 *
 * A refused, verified address is recorded so an admin can approve it from the
 * list.
 */
export async function gateSignIn(
  store: SignInGateStore,
  user: SigningInUser,
  now: number,
): Promise<SignInDecision> {
  const email = normaliseEmail(user.email ?? "");
  if (!isValidEmail(email)) return { allowed: false, reason: "no_email" };
  if (!addressIsVerified(user)) return { allowed: false, reason: "unverified" };
  if (await store.isListed(email)) return { allowed: true };
  await store.recordAttempt(email, (previous) => nextAttempt(previous, email, now));
  return { allowed: false, reason: "not_listed" };
}
