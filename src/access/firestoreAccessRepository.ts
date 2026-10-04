import {
  collection,
  deleteDoc,
  doc,
  type Firestore,
  getDoc,
  getDocs,
  writeBatch,
} from "firebase/firestore";
import { type AccessRepository, sortAllowlist, sortAttempts } from "./accessRepository";
import {
  ALLOWLIST_COLLECTION,
  type AllowlistEntry,
  allowlistDocPath,
  approvalChunks,
  SIGN_IN_ATTEMPTS_COLLECTION,
  type SignInAttempt,
  signInAttemptDocPath,
} from "./allowlist";

/**
 * The allowlist in Firestore, as an admin-claim account sees it through
 * `firestore.rules` (#854). The `Firestore` instance is injected, so the
 * emulator suite can run this exact code against the real rules.
 *
 * An approval is one `writeBatch` per {@link approvalChunks} chunk: every
 * entry and every cleared attempt in it land together or not at all.
 */
export class FirestoreAccessRepository implements AccessRepository {
  constructor(private readonly db: Firestore) {}

  async listAllowlist(): Promise<AllowlistEntry[]> {
    const snapshot = await getDocs(collection(this.db, ALLOWLIST_COLLECTION));
    return sortAllowlist(snapshot.docs.map((d) => d.data() as AllowlistEntry));
  }

  async listAttempts(): Promise<SignInAttempt[]> {
    const snapshot = await getDocs(collection(this.db, SIGN_IN_ATTEMPTS_COLLECTION));
    return sortAttempts(snapshot.docs.map((d) => d.data() as SignInAttempt));
  }

  async listed(emails: readonly string[]): Promise<Set<string>> {
    const snapshots = await Promise.all(
      emails.map((email) => getDoc(doc(this.db, allowlistDocPath(email)))),
    );
    return new Set(snapshots.filter((s) => s.exists()).map((s) => s.id));
  }

  async commit(
    entries: readonly AllowlistEntry[],
    clearAttempts: readonly string[],
  ): Promise<void> {
    const byEmail = new Map(entries.map((entry) => [entry.email, entry]));
    for (const chunk of approvalChunks(clearAttempts)) {
      const batch = writeBatch(this.db);
      for (const email of chunk) {
        const entry = byEmail.get(email);
        if (entry) batch.set(doc(this.db, allowlistDocPath(email)), entry);
        batch.delete(doc(this.db, signInAttemptDocPath(email)));
      }
      await batch.commit();
    }
  }

  async remove(email: string): Promise<void> {
    await deleteDoc(doc(this.db, allowlistDocPath(email)));
  }
}
