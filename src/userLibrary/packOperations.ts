import type { Clock } from "../shared/clock";
import type { UserLibraryRepository } from "./userLibraryRepository";
import { removeSound, type UserPack } from "./userPacks";

/**
 * Deleting from a personal library (#282), in the order that never lists a
 * sound whose audio is gone.
 *
 * A sound comes out of its pack first and its audio is deleted after, so a
 * failure in between leaves stored audio nobody lists (which the next delete
 * of the pack still cleans up) rather than a listed sound that cannot play. A
 * whole pack goes the other way round — its audio first, then the document —
 * so a failure part-way leaves the pack listed, with whatever it still holds,
 * and deleting it again finishes the job.
 */

/** Delete one sound from a pack, then its audio. */
export async function deleteUserSound(
  repository: UserLibraryRepository,
  uid: string,
  packId: string,
  assetId: string,
  clock: Clock,
): Promise<void> {
  let storagePath: string | null = null;
  await repository.updatePack(uid, packId, (pack) => {
    storagePath = pack.assets.find((asset) => asset.id === assetId)?.storagePath ?? null;
    return removeSound(pack, assetId, clock.now());
  });
  if (storagePath) await repository.deleteAudio(storagePath);
}

/** Delete a pack's audio, then the pack. */
export async function deleteUserPack(
  repository: UserLibraryRepository,
  uid: string,
  pack: UserPack,
): Promise<void> {
  await Promise.all(
    pack.assets.map((asset) => repository.deleteAudio(asset.storagePath)),
  );
  await repository.deletePack(uid, pack.id);
}
