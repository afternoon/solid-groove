import type { FirebaseApp } from "firebase/app";
import {
  collection,
  deleteDoc,
  doc,
  type Firestore,
  getFirestore,
  onSnapshot,
  runTransaction,
  setDoc,
} from "firebase/firestore";
import {
  connectStorageEmulator,
  deleteObject,
  type FirebaseStorage,
  getBytes,
  getStorage,
  ref,
  uploadBytesResumable,
} from "firebase/storage";
import { resolveEmulatorHosts } from "../devBackend";
import { parseUserDataPath, usageDocPath } from "../userData/userData";
import {
  type StorageFailure,
  type UploadOptions,
  UserLibraryError,
  type UserLibraryRepository,
} from "./userLibraryRepository";
import { parseUserPack, type UserPack } from "./userPacks";

/**
 * The personal library in Firestore and Cloud Storage (#282).
 *
 * The only module that touches either SDK for user data, the way
 * `firestoreProjectRepository.ts` is for projects: pack documents at
 * `users/{uid}/packs/{packId}`, audio at the paths `src/userData/userData.ts`
 * builds, and the usage total the Cloud Functions keep. `storage.rules` and
 * `firestore.rules` hold the line on ownership, type, size and the allowance;
 * this module reports their refusals as coded {@link UserLibraryError}s.
 *
 * Audio is stored with headers that keep it private and inert: `private`
 * caching so no shared cache keeps a copy, and `attachment` so any URL to it
 * downloads rather than renders. The app itself never asks for a download URL
 * (which would be a bearer token anyone holding it could use): it reads the
 * bytes with {@link FirebaseUserLibraryRepository.readAudio}, as the signed-in
 * user, so `storage.rules` keep every sound its owner's alone.
 */

const AUDIO_HEADERS = {
  cacheControl: "private, max-age=31536000, immutable",
  contentDisposition: "attachment",
} as const;

export class FirebaseUserLibraryRepository implements UserLibraryRepository {
  constructor(
    private readonly db: Firestore,
    private readonly storage: FirebaseStorage,
  ) {}

  watchPacks(
    uid: string,
    onPacks: (packs: readonly UserPack[]) => void,
    onError: (error: UserLibraryError) => void,
  ): () => void {
    return onSnapshot(
      collection(this.db, "users", uid, "packs"),
      (snapshot) => {
        const packs = snapshot.docs
          .map((entry) => parseUserPack(entry.data()))
          .filter((pack): pack is UserPack => pack !== null)
          .sort((a, b) => a.createdAt - b.createdAt);
        onPacks(packs);
      },
      (error) => onError(toLibraryError(error)),
    );
  }

  watchUsage(uid: string, onUsage: (usedBytes: number) => void): () => void {
    return onSnapshot(
      doc(this.db, usageDocPath(uid)),
      (snapshot) => {
        const total = snapshot.data()?.totalBytes;
        onUsage(typeof total === "number" ? total : 0);
      },
      // Without the total the client cannot warn ahead, but the rules still
      // enforce the allowance, so a failed read is not a reason to block.
      () => undefined,
    );
  }

  async createPack(uid: string, pack: UserPack): Promise<void> {
    try {
      await setDoc(doc(this.db, "users", uid, "packs", pack.id), pack);
    } catch (error) {
      throw toLibraryError(error);
    }
  }

  /**
   * The last change queued for each pack, by document path. Every sound in a
   * pack rewrites the pack's one document, so many imports at once would all
   * contend on it, and Firestore gives a contended transaction a few retries
   * before it fails with `failed-precondition` (GRV-77). Changes to one pack
   * from this tab therefore run one after another.
   */
  private readonly pending = new Map<string, Promise<unknown>>();

  updatePack(
    uid: string,
    packId: string,
    change: (pack: UserPack) => UserPack,
  ): Promise<UserPack> {
    const key = `${uid}/${packId}`;
    const run = (this.pending.get(key) ?? Promise.resolve()).then(
      () => this.updatePackNow(uid, packId, change),
      () => this.updatePackNow(uid, packId, change),
    );
    this.pending.set(key, run);
    const release = () => {
      if (this.pending.get(key) === run) this.pending.delete(key);
    };
    run.then(release, release);
    return run;
  }

  private async updatePackNow(
    uid: string,
    packId: string,
    change: (pack: UserPack) => UserPack,
  ): Promise<UserPack> {
    const target = doc(this.db, "users", uid, "packs", packId);
    // What `change` itself refuses with is the caller's own error, not a
    // storage failure, so it is passed back as thrown.
    const refusals = new Set<unknown>();
    try {
      return await runTransaction(this.db, async (transaction) => {
        const snapshot = await transaction.get(target);
        const current = snapshot.exists() ? parseUserPack(snapshot.data()) : null;
        if (!current) throw new UserLibraryError("not_found", "No such pack");
        let next: UserPack;
        try {
          next = change(current);
        } catch (refusal) {
          refusals.add(refusal);
          throw refusal;
        }
        transaction.set(target, next);
        return next;
      });
    } catch (error) {
      if (refusals.has(error)) throw error;
      throw toLibraryError(error);
    }
  }

  async deletePack(uid: string, packId: string): Promise<void> {
    try {
      await deleteDoc(doc(this.db, "users", uid, "packs", packId));
    } catch (error) {
      throw toLibraryError(error);
    }
  }

  uploadAudio(
    path: string,
    file: Blob,
    contentType: string,
    options: UploadOptions = {},
  ): Promise<void> {
    const object = ref(this.storage, path);
    const task = uploadBytesResumable(object, file, { contentType, ...AUDIO_HEADERS });
    const abort = () => task.cancel();
    if (options.signal?.aborted) abort();
    options.signal?.addEventListener("abort", abort);
    options.onProgress?.(0);
    return new Promise<void>((resolve, reject) => {
      task.on(
        "state_changed",
        (snapshot) => {
          if (snapshot.totalBytes > 0) {
            options.onProgress?.(snapshot.bytesTransferred / snapshot.totalBytes);
          }
        },
        (error) => reject(toLibraryError(error)),
        () => resolve(),
      );
    }).finally(() => options.signal?.removeEventListener("abort", abort));
  }

  async readAudio(path: string): Promise<ArrayBuffer> {
    if (!parseUserDataPath(path)) {
      throw new UserLibraryError("not_found", "Not user data");
    }
    try {
      return await getBytes(ref(this.storage, path));
    } catch (error) {
      throw toLibraryError(error);
    }
  }

  async deleteAudio(path: string): Promise<void> {
    try {
      await deleteObject(ref(this.storage, path));
    } catch (error) {
      const failure = toLibraryError(error);
      if (failure.reason !== "not_found") throw failure;
    }
  }
}

/**
 * The repository for this page load's Firebase app. In emulator mode it talks
 * to the local Storage emulator, beside the Firestore and Auth ones that
 * `firebaseConfig.ts` connects.
 */
export function createFirebaseUserLibraryRepository(
  app: FirebaseApp,
): FirebaseUserLibraryRepository {
  const storage = getStorage(app);
  const hosts = resolveEmulatorHosts();
  if (hosts) {
    const [host, port] = hosts.storage.split(":");
    connectStorageEmulator(storage, host, Number(port));
  }
  return new FirebaseUserLibraryRepository(getFirestore(app), storage);
}

const CODES: Readonly<Record<string, StorageFailure>> = {
  "storage/canceled": "cancelled",
  "storage/unauthorized": "permission_denied",
  "storage/unauthenticated": "permission_denied",
  "storage/quota-exceeded": "over_allowance",
  "storage/retry-limit-exceeded": "network",
  "storage/object-not-found": "not_found",
  "permission-denied": "permission_denied",
  unauthenticated: "permission_denied",
  unavailable: "network",
  "deadline-exceeded": "network",
  "not-found": "not_found",
};

function toLibraryError(error: unknown): UserLibraryError {
  if (error instanceof UserLibraryError) return error;
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code: unknown }).code)
      : "";
  return new UserLibraryError(
    CODES[code] ?? "unknown",
    error instanceof Error ? error.message : "Storage request failed",
  );
}
