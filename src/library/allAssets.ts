import type { LibraryClient } from "./libraryClient";
import type { LibraryAsset } from "./manifest";

/**
 * Every asset of every pack, for a view that compares across the whole library
 * (similar sounds). A pack whose manifest fails is left out rather than failing
 * the rest: the client isolates that error per pack. An index failure rejects.
 */
export async function loadEveryAsset(
  client: LibraryClient,
): Promise<readonly LibraryAsset[]> {
  const packs = await client.loadIndex();
  const results = await Promise.all(packs.map((pack) => client.loadPack(pack)));
  return results.flatMap((result) => (result.ok ? result.assets : []));
}
