/**
 * Groove's Cloud Functions (#282): the first server-side code in the repo.
 *
 * Two Storage-triggered functions keep each user's storage total in
 * `users/{uid}/usage/current`, which `storage.rules` reads to refuse a write
 * that would take an account over its 1 GB allowance, and which the client
 * reads to warn before an import would. The rules for *how* the total moves
 * live in `src/userData/usageLedger.ts`, shared with the browser bundle and
 * unit-tested there; this file only connects Cloud Storage's events to a
 * Firestore transaction.
 *
 * A blocking `beforeSignIn` function (#854) keeps the alpha to its allowlist:
 * it is the enforcement, and `src/access/signInGate.ts` is its decision.
 *
 * Every kind of user data (packs today, recordings and presets later) is a
 * folder under `users/{uid}/`, so a new kind is counted as soon as it is added
 * to `USER_DATA_KINDS` — nothing here changes.
 *
 * Built by `firebase.json`'s `functions.predeploy` with `bun build`, which
 * bundles the shared modules in and leaves `firebase-admin` and
 * `firebase-functions` to the runtime's own install of `functions/package.json`.
 */
import { initializeApp } from "firebase-admin/app";
import { type Firestore, getFirestore, type Transaction } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { logger } from "firebase-functions";
import { setGlobalOptions } from "firebase-functions/v2";
import { beforeUserSignedIn, HttpsError } from "firebase-functions/v2/identity";
import {
  onObjectDeleted,
  onObjectFinalized,
  type StorageEvent,
} from "firebase-functions/v2/storage";
import {
  allowlistDocPath,
  NOT_ON_ALLOWLIST,
  type SignInAttempt,
  signInAttemptDocPath,
} from "../../src/access/allowlist";
import { gateSignIn, type SignInGateStore } from "../../src/access/signInGate";
import type { VersionedPack } from "../../src/userData/packVersions";
import { withdrawRefusedSound } from "../../src/userData/refusedSound";
import {
  type LedgerOutcome,
  recordObjectDeleted,
  recordObjectWritten,
  type UsageTransaction,
} from "../../src/userData/usageLedger";
import {
  type UsageDocument,
  type UsageLedgerEntry,
  usageDocPath,
  usageObjectDocPath,
  userPackDocPath,
} from "../../src/userData/userData";

/**
 * Where the functions run. A Storage trigger has to run in the default
 * bucket's location; this is the location new Firebase projects default to.
 * A bucket elsewhere means changing this one value before deploying.
 */
setGlobalOptions({ region: "us-central1", maxInstances: 10 });

initializeApp();

/** A {@link UsageTransaction} over one Firestore transaction. */
function firestoreUsage(db: Firestore, tx: Transaction): UsageTransaction {
  return {
    async getEntry(uid, objectPath) {
      const snapshot = await tx.get(db.doc(usageObjectDocPath(uid, objectPath)));
      return snapshot.exists ? (snapshot.data() as UsageLedgerEntry) : null;
    },
    async getUsage(uid) {
      const snapshot = await tx.get(db.doc(usageDocPath(uid)));
      return snapshot.exists ? (snapshot.data() as UsageDocument) : null;
    },
    setEntry(uid, objectPath, entry) {
      tx.set(db.doc(usageObjectDocPath(uid, objectPath)), entry);
    },
    setUsage(uid, usage) {
      tx.set(db.doc(usageDocPath(uid)), usage);
    },
  };
}

type Recorder = typeof recordObjectWritten;

async function record(event: StorageEvent, recorder: Recorder): Promise<void> {
  const db = getFirestore();
  const generation = String(event.data.generation);
  const outcome: LedgerOutcome = await db.runTransaction((tx) =>
    recorder(
      firestoreUsage(db, tx),
      { path: event.data.name, generation, size: Number(event.data.size) },
      Date.now(),
    ),
  );
  // The object path names the user and the pack, so it is not logged.
  if (outcome.applied) {
    logger.info("user data usage changed", { delta: outcome.deltaBytes });
  } else if (outcome.reason === "over_allowance") {
    await reclaim(event.data.bucket, event.data.name, generation);
    await withdrawFromPack(db, event.data.name);
  }
}

/**
 * Take a refused sound out of the pack that lists it, so the owner is never
 * shown a sound with no audio behind it. A pack that does not list it yet
 * (the browser writes the pack after the upload) is left alone; the browser
 * holds the allowance for its own imports, so that only happens when two
 * sessions race (`src/userData/refusedSound.ts`).
 */
async function withdrawFromPack(db: Firestore, objectPath: string): Promise<void> {
  const withdrawn = await db.runTransaction((tx) =>
    withdrawRefusedSound(
      {
        async getPack(uid, packId) {
          const snapshot = await tx.get(db.doc(userPackDocPath(uid, packId)));
          return snapshot.exists ? (snapshot.data() as VersionedPack) : null;
        },
        setPack(uid, packId, pack) {
          tx.set(db.doc(userPackDocPath(uid, packId)), pack);
        },
      },
      objectPath,
      Date.now(),
    ),
  );
  if (withdrawn) logger.warn("a refused sound was taken out of its pack");
}

/**
 * Delete an object the ledger refused because the account was already full:
 * uploads that raced past `storage.rules` together. Only the generation that
 * was refused, so a newer object at the same path is never touched; one that
 * is already gone is fine.
 */
async function reclaim(bucket: string, name: string, generation: string): Promise<void> {
  try {
    await getStorage()
      .bucket(bucket)
      .file(name, { generation })
      .delete({ ifGenerationMatch: generation });
    logger.warn("user data over the allowance was deleted");
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === 404 || code === 412) return;
    throw error;
  }
}

/** A user stored something: count it. */
export const userDataUsageWritten = onObjectFinalized((event) =>
  record(event, recordObjectWritten),
);

/** A user deleted something: release it. */
export const userDataUsageDeleted = onObjectDeleted((event) =>
  record(event, recordObjectDeleted),
);

/** The sign-in gate's store over Firestore, with the admin credential. */
function firestoreGate(db: Firestore): SignInGateStore {
  return {
    async isListed(email) {
      return (await db.doc(allowlistDocPath(email)).get()).exists;
    },
    async recordAttempt(email, update) {
      const ref = db.doc(signInAttemptDocPath(email));
      await db.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref);
        tx.set(ref, update(snapshot.exists ? (snapshot.data() as SignInAttempt) : null));
      });
    },
  };
}

/**
 * Only verified, allowlisted addresses sign in during the alpha (#854). Runs
 * before every sign-in, a guest linking Google included (never an anonymous
 * sign-in: Firebase does not run blocking functions for those, which is why
 * the Anonymous provider is disabled); a refused one is recorded
 * in `signInAttempts` for an admin to approve. The refusal's message carries
 * {@link NOT_ON_ALLOWLIST}, which is how the browser knows to show the
 * "not on the alpha list" page rather than a generic failure. Nothing logged
 * here names the address.
 */
export const alphaAllowlistGate = beforeUserSignedIn(async (event) => {
  const decision = await gateSignIn(
    firestoreGate(getFirestore()),
    {
      email: event.data?.email ?? null,
      emailVerified: event.data?.emailVerified,
      providerId: event.credential?.providerId ?? event.additionalUserInfo?.providerId,
    },
    Date.now(),
  );
  if (decision.allowed) return;
  logger.info("a sign-in was refused", { reason: decision.reason });
  throw new HttpsError("permission-denied", NOT_ON_ALLOWLIST);
});
