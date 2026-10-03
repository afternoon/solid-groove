import {
  type UploadOptions,
  UserLibraryError,
  type UserLibraryRepository,
} from "./userLibraryRepository";
import type { UserPack } from "./userPacks";

/**
 * A personal library held in memory: the mock backend's store, and the one
 * unit tests run against. It keeps the Firestore implementation's promises —
 * subscribers hear every change, `updatePack` is atomic, a cancelled upload
 * stores nothing, and the usage total follows what is stored — so a test
 * written against it describes the real thing.
 *
 * Like the in-memory project repository, it forgets everything on reload.
 */

export interface InMemoryUserLibraryOptions {
  /**
   * How long a simulated upload takes, so the mock backend can show progress.
   * Zero (the default) settles on the next microtask.
   */
  readonly uploadMs?: number;
  /** Make the next uploads fail with this reason, for failure-path tests. */
  readonly failUploads?: UserLibraryError["reason"];
}

export interface InMemoryUserLibraryRepository extends UserLibraryRepository {
  /** What is stored, path to bytes, for assertions. */
  readonly objects: ReadonlyMap<string, number>;
  /** Fail uploads from now on with this reason, or stop failing them. */
  failUploads(reason: UserLibraryError["reason"] | null): void;
  /** Set what the account's usage document says. */
  setUsage(uid: string, usedBytes: number): void;
}

export function createInMemoryUserLibraryRepository(
  options: InMemoryUserLibraryOptions = {},
): InMemoryUserLibraryRepository {
  const packs = new Map<string, Map<string, UserPack>>();
  const objects = new Map<string, number>();
  const extraUsage = new Map<string, number>();
  const packListeners = new Map<string, Set<(packs: readonly UserPack[]) => void>>();
  const usageListeners = new Map<string, Set<(bytes: number) => void>>();
  let failure = options.failUploads ?? null;

  const packsOf = (uid: string) => {
    let owned = packs.get(uid);
    if (!owned) {
      owned = new Map();
      packs.set(uid, owned);
    }
    return owned;
  };
  const listOf = (uid: string) =>
    [...packsOf(uid).values()].sort((a, b) => a.createdAt - b.createdAt);
  const usageOf = (uid: string) => {
    let bytes = extraUsage.get(uid) ?? 0;
    for (const [path, size] of objects) {
      if (path.startsWith(`users/${uid}/`)) bytes += size;
    }
    return bytes;
  };
  const listenersOf = <T>(map: Map<string, Set<T>>, uid: string) => {
    let set = map.get(uid);
    if (!set) {
      set = new Set();
      map.set(uid, set);
    }
    return set;
  };
  const notifyPacks = (uid: string) => {
    const list = listOf(uid);
    for (const listener of listenersOf(packListeners, uid)) listener(list);
  };
  const notifyUsage = (uid: string) => {
    const bytes = usageOf(uid);
    for (const listener of listenersOf(usageListeners, uid)) listener(bytes);
  };
  const ownerOf = (path: string) => /^users\/([^/]+)\//.exec(path)?.[1] ?? "";

  return {
    objects,
    failUploads(reason) {
      failure = reason;
    },
    setUsage(uid, usedBytes) {
      extraUsage.set(uid, usedBytes);
      notifyUsage(uid);
    },

    watchPacks(uid, onPacks) {
      const set = listenersOf(packListeners, uid);
      set.add(onPacks);
      queueMicrotask(() => {
        if (set.has(onPacks)) onPacks(listOf(uid));
      });
      return () => set.delete(onPacks);
    },

    watchUsage(uid, onUsage) {
      const set = listenersOf(usageListeners, uid);
      set.add(onUsage);
      queueMicrotask(() => {
        if (set.has(onUsage)) onUsage(usageOf(uid));
      });
      return () => set.delete(onUsage);
    },

    async createPack(uid, pack) {
      packsOf(uid).set(pack.id, pack);
      notifyPacks(uid);
    },

    async updatePack(uid, packId, change) {
      const current = packsOf(uid).get(packId);
      if (!current) throw new UserLibraryError("not_found", "No such pack");
      const next = change(current);
      packsOf(uid).set(packId, next);
      notifyPacks(uid);
      return next;
    },

    async deletePack(uid, packId) {
      packsOf(uid).delete(packId);
      notifyPacks(uid);
    },

    async uploadAudio(path, file, _contentType, upload: UploadOptions = {}) {
      const { signal, onProgress } = upload;
      onProgress?.(0);
      await delay(options.uploadMs ?? 0, signal);
      if (signal?.aborted) throw new UserLibraryError("cancelled", "Upload cancelled");
      if (failure) throw new UserLibraryError(failure, "Upload failed");
      onProgress?.(1);
      objects.set(path, file.size);
      notifyUsage(ownerOf(path));
      return objectUrl(file, path);
    },

    async deleteAudio(path) {
      objects.delete(path);
      notifyUsage(ownerOf(path));
    },
  };
}

/** A URL the page can decode the stored file from, where the platform offers one. */
function objectUrl(file: Blob, path: string): string {
  return typeof URL.createObjectURL === "function"
    ? URL.createObjectURL(file)
    : `memory://${path}`;
}

function delay(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    if (ms <= 0) {
      queueMicrotask(resolve);
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
