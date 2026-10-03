import { type VersionedPack, withoutSound } from "./packVersions";
import { parsePackAudioPath } from "./userData";

/**
 * What happens to a pack when the usage ledger refuses a sound's audio (#282).
 *
 * Two uploads started together can each pass `storage.rules`' allowance check,
 * and the ledger (`usageLedger.ts`) refuses whichever lands over the cap, so
 * the Cloud Function deletes its audio again. The importing browser has, or is
 * about to, list that sound in its pack, and a listed sound with no audio
 * behind it can never play. So the function also takes it out of the pack,
 * at the next major version just as a delete by its owner would.
 */

/** The reads and writes one Firestore transaction offers this. */
export interface PackTransaction {
  getPack(uid: string, packId: string): Promise<VersionedPack | null>;
  setPack(uid: string, packId: string, pack: VersionedPack): void;
}

/**
 * Take the sound stored at `objectPath` out of its pack. `false` when there is
 * nothing to take out: not a pack sound, no such pack, or not listed (yet).
 */
export async function withdrawRefusedSound(
  tx: PackTransaction,
  objectPath: string,
  now: number,
): Promise<boolean> {
  const sound = parsePackAudioPath(objectPath);
  if (!sound) return false;
  const pack = await tx.getPack(sound.uid, sound.packId);
  if (!pack) return false;
  const next = withoutSound(pack, sound.assetId, now);
  if (next === pack) return false;
  tx.setPack(sound.uid, sound.packId, next);
  return true;
}
