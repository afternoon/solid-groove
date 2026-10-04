import type { UserPack } from "./userPacks";

/**
 * The boundary between a producer's personal library and where it is stored
 * (#282): pack documents in Firestore and audio in Cloud Storage in
 * production, memory in tests and the mock backend. Both implementations
 * satisfy `userLibraryRepositoryContract.ts`.
 *
 * Nothing above this boundary builds a Firestore path or touches a Storage
 * reference; `firebaseUserLibraryRepository.ts` is the only module that does.
 */

/** Stops a subscription. */
export type Unsubscribe = () => void;

export interface UploadOptions {
  /** Called with 0-1 as the bytes go up. */
  onProgress?(fraction: number): void;
  /** Aborting cancels the upload; nothing is left stored. */
  readonly signal?: AbortSignal;
}

/** Why a storage operation failed, for the producer and for analytics. */
export type StorageFailure =
  | "cancelled"
  | "permission_denied"
  | "over_allowance"
  | "network"
  | "not_found"
  | "unknown";

/** A coded failure from the repository. Its message is never shown verbatim. */
export class UserLibraryError extends Error {
  constructor(
    readonly reason: StorageFailure,
    message: string,
  ) {
    super(message);
    this.name = "UserLibraryError";
  }
}

export interface UserLibraryRepository {
  /** Every pack the user owns, now and on every change, oldest first. */
  watchPacks(
    uid: string,
    onPacks: (packs: readonly UserPack[]) => void,
    onError: (error: UserLibraryError) => void,
  ): Unsubscribe;
  /** The bytes the account stores, now and on every change. */
  watchUsage(uid: string, onUsage: (usedBytes: number) => void): Unsubscribe;
  createPack(uid: string, pack: UserPack): Promise<void>;
  /**
   * Change one pack atomically: `change` sees the stored pack and returns the
   * next one, and is re-run if another write landed first, so two imports into
   * the same pack never lose each other's sound. An error `change` throws
   * rejects the update as thrown, and nothing is written.
   */
  updatePack(
    uid: string,
    packId: string,
    change: (pack: UserPack) => UserPack,
  ): Promise<UserPack>;
  /** Delete the pack document. Its audio is deleted by the caller first. */
  deletePack(uid: string, packId: string): Promise<void>;
  /**
   * Store one file's audio at `path`. Nothing comes back to hand around: a
   * stored sound is named by its path alone, and read back through
   * {@link readAudio}, so no bearer URL to it ever reaches a pack, a project
   * or a drag (#282).
   */
  uploadAudio(
    path: string,
    file: Blob,
    contentType: string,
    options?: UploadOptions,
  ): Promise<void>;
  /**
   * The bytes stored at a user-data `path`, read as the signed-in user, so the
   * storage rules decide who may hear it: only its owner. Anything that is not
   * user data, or is gone, fails `not_found`.
   */
  readAudio(path: string): Promise<ArrayBuffer>;
  /** Delete stored audio. Deleting what is already gone succeeds. */
  deleteAudio(path: string): Promise<void>;
}
