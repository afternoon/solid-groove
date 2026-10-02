import { beforeEach, describe, expect, it } from "vitest";
import type { PackId } from "../domain/ids";
import type { JsonObject } from "../domain/serialize";
import type { ManualClock } from "../shared/clock";
import {
  FAVOURITE_SCHEMA_VERSION,
  type Favourite,
  favouriteDocumentPath,
  type SoundReference,
} from "./favouriteDocuments";
import type { FavouritesRepository, FavouritesWatchEvent } from "./favouritesRepository";

/**
 * The favourites contract suite (LIB-011, #691).
 *
 * The in-memory and Firestore stores both run it, so a component test that
 * favourites through the fake is evidence about the real backend. Anything
 * specific to one store (its write log, the security rules) lives in that
 * store's own suite.
 */

export const FAVOURITES_OWNER = "user_favourites";
export const FAVOURITES_OTHER_OWNER = "user_other_favourites";

export const PACK_DRUMS = "pak_drumsdrumsdrumsdrumsd" as PackId;
export const PACK_KEYS = "pak_keyskeyskeyskeyskeysk" as PackId;

export const KICK: SoundReference = {
  packId: PACK_DRUMS,
  assetId: "sg-one-shot-drums-kick-0001",
};
export const SNARE: SoundReference = {
  packId: PACK_DRUMS,
  assetId: "sg-one-shot-drums-snare-0001",
};
export const PIANO: SoundReference = {
  packId: PACK_KEYS,
  assetId: "sg-one-shot-keys-piano-0001",
};

export interface FavouritesContractHarness {
  /**
   * A repository acting as `uid`. Each call is a separate session: for
   * Firestore, a separately authenticated client, so a change one makes has to
   * reach the other through the backend.
   */
  repositoryFor(uid: string): FavouritesRepository;
  /** The clock every repository the harness hands out stamps writes with. */
  readonly clock: ManualClock;
  /** Called before each test to reset stored state. */
  reset(): Promise<void>;
  /** Writes a document verbatim, bypassing the repository and the rules. */
  seedStoredDocument(path: string, data: JsonObject): Promise<void>;
}

export function describeFavouritesRepositoryContract(
  label: string,
  createHarness: () => Promise<FavouritesContractHarness> | FavouritesContractHarness,
): void {
  describe(`${label}: FavouritesRepository contract`, () => {
    let harness: FavouritesContractHarness;
    let repository: FavouritesRepository;

    beforeEach(async () => {
      harness = await createHarness();
      await harness.reset();
      harness.clock.set(1_700_000_000_000);
      repository = harness.repositoryFor(FAVOURITES_OWNER);
    });

    async function listed(repo = repository, uid = FAVOURITES_OWNER) {
      const result = await repo.listFavourites(uid);
      if (!result.ok) throw new Error(`listFavourites failed: ${result.reason}`);
      return result.favourites;
    }

    async function add(reference: SoundReference): Promise<Favourite> {
      const result = await repository.addFavourite(FAVOURITES_OWNER, reference);
      if (!result.ok) throw new Error(`addFavourite failed: ${result.reason}`);
      return result.favourite;
    }

    it("lists nothing for a user who has favourited nothing", async () => {
      expect(await listed()).toEqual([]);
    });

    it("stores a pack-qualified reference and when it was favourited", async () => {
      const favourite = await add(KICK);

      expect(favourite).toEqual({ ...KICK, favouritedAt: 1_700_000_000_000 });
      expect(await listed()).toEqual([favourite]);
    });

    it("lists favourites newest first", async () => {
      await add(KICK);
      harness.clock.advance(1_000);
      await add(PIANO);
      harness.clock.advance(1_000);
      await add(SNARE);

      expect((await listed()).map((entry) => entry.assetId)).toEqual([
        SNARE.assetId,
        PIANO.assetId,
        KICK.assetId,
      ]);
    });

    it("keeps one entry when the same sound is favourited twice", async () => {
      await add(KICK);
      harness.clock.advance(5_000);
      await add(KICK);

      expect(await listed()).toEqual([{ ...KICK, favouritedAt: 1_700_000_005_000 }]);
    });

    it("tells the same asset ID in two packs apart", async () => {
      await add(KICK);
      await add({ packId: PACK_KEYS, assetId: KICK.assetId });

      expect(await listed()).toHaveLength(2);
    });

    it("removes a favourite, and removing a non-favourite changes nothing", async () => {
      await add(KICK);
      await add(SNARE);

      expect(await repository.removeFavourite(FAVOURITES_OWNER, KICK)).toEqual({
        ok: true,
      });
      expect(await repository.removeFavourite(FAVOURITES_OWNER, PIANO)).toEqual({
        ok: true,
      });

      expect((await listed()).map((entry) => entry.assetId)).toEqual([SNARE.assetId]);
    });

    it("round trips an asset ID that is not path-safe", async () => {
      const awkward: SoundReference = {
        packId: PACK_KEYS,
        assetId: "user/one shot #1.wav",
      };
      await add(awkward);
      expect(await listed()).toEqual([{ ...awkward, favouritedAt: 1_700_000_000_000 }]);

      await repository.removeFavourite(FAVOURITES_OWNER, awkward);
      expect(await listed()).toEqual([]);
    });

    it("refuses a reference that is not a pack-qualified sound, storing nothing", async () => {
      const notAPack = { packId: "drums" as PackId, assetId: "kick" };
      const noAsset = { packId: PACK_DRUMS, assetId: "" };

      for (const reference of [notAPack, noAsset]) {
        const result = await repository.addFavourite(FAVOURITES_OWNER, reference);
        expect(result).toMatchObject({
          ok: false,
          reason: "invalid_reference",
          retryable: false,
        });
      }
      expect(await listed()).toEqual([]);
    });

    it("keeps one user's favourites out of another user's list", async () => {
      await add(KICK);
      const other = harness.repositoryFor(FAVOURITES_OTHER_OWNER);

      expect(await listed(other, FAVOURITES_OTHER_OWNER)).toEqual([]);
    });

    it("skips a stored document it cannot read instead of failing the list", async () => {
      await add(KICK);
      await harness.seedStoredDocument(favouriteDocumentPath(FAVOURITES_OWNER, SNARE), {
        schemaVersion: FAVOURITE_SCHEMA_VERSION + 1,
        packId: SNARE.packId,
        assetId: SNARE.assetId,
        favouritedAt: 1,
      });

      expect((await listed()).map((entry) => entry.assetId)).toEqual([KICK.assetId]);
    });

    it("delivers another session's adds and removes to a watcher, until unsubscribed", async () => {
      const events: FavouritesWatchEvent[] = [];
      const unsubscribe = repository.watchFavourites(FAVOURITES_OWNER, (event) => {
        events.push(event);
      });
      const latest = () => {
        const last = events.at(-1);
        return last?.kind === "favourites" ? last.favourites.map((f) => f.assetId) : null;
      };
      await waitFor(() => latest() !== null);
      expect(latest()).toEqual([]);

      const elsewhere = harness.repositoryFor(FAVOURITES_OWNER);
      await elsewhere.addFavourite(FAVOURITES_OWNER, KICK);
      await waitFor(() => latest()?.length === 1);
      expect(latest()).toEqual([KICK.assetId]);

      await elsewhere.removeFavourite(FAVOURITES_OWNER, KICK);
      await waitFor(() => latest()?.length === 0);

      unsubscribe();
      const before = events.length;
      await elsewhere.addFavourite(FAVOURITES_OWNER, SNARE);
      await settle();
      expect(events.length).toBe(before);
      expect(events.every((event) => event.kind === "favourites")).toBe(true);
    });
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 5_000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("Timed out waiting for a favourites notification");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** Gives an asynchronous listener a chance to fire before asserting it did not. */
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 50));
}
