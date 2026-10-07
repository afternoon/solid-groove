import { createRoot, createSignal, flush } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import { Analytics } from "../analytics/analytics";
import { ConsentStore } from "../analytics/consent";
import { createRecordingTransport } from "../analytics/transport";
import type { FavouritesRepository } from "../persistence/favouritesRepository";
import { favouriteFailure } from "../persistence/favouritesRepository";
import { KICK, SNARE } from "../persistence/favouritesRepositoryContract";
import { InMemoryFavouritesRepository } from "../persistence/inMemoryFavouritesRepository";
import { createManualClock } from "../shared/clock";
import { memoryStorage } from "../testing/storage";
import { type Favourites, useFavourites } from "./useFavourites";

const UID = "user_a";

let dispose = () => {};
afterEach(() => dispose());

/** Lets the in-memory store's asynchronous notifications land, then settles. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  flush();
}

function setup(
  repository: FavouritesRepository = new InMemoryFavouritesRepository({
    clock: createManualClock(1),
  }),
  uid: string | null = UID,
) {
  const transport = createRecordingTransport();
  const analytics = new Analytics({
    transport,
    consent: new ConsentStore(memoryStorage()),
    storage: memoryStorage(),
  });
  const [account, setAccount] = createSignal<string | null>(uid);
  const favourites = createRoot((d) => {
    dispose = d;
    return useFavourites({
      uid: account,
      repository: async () => repository,
      analytics,
      clock: createManualClock(5),
    });
  });
  const changes = () =>
    transport.events.filter((event) => event.name === "library_favourite_changed");
  return { favourites, repository, transport, changes, setAccount };
}

const listed = (favourites: Favourites) =>
  favourites.list().map((favourite) => favourite.assetId);

describe("useFavourites", () => {
  it("loads the user's favourites, newest first", async () => {
    const repository = new InMemoryFavouritesRepository({ clock: createManualClock(1) });
    await repository.addFavourite(UID, KICK);
    const { favourites } = setup(repository);
    expect(favourites.loaded()).toBe(false);

    await settle();

    expect(favourites.loaded()).toBe(true);
    expect(listed(favourites)).toEqual([KICK.assetId]);
    expect(favourites.isFavourite(KICK)).toBe(true);
    expect(favourites.isFavourite(SNARE)).toBe(false);
  });

  it("toggles a sound in and out through the repository, once per press", async () => {
    const { favourites, repository, changes } = setup();
    await settle();

    const adding = favourites.toggle(KICK);
    flush();
    // The heart shows the press at once, before the write is in.
    expect(favourites.isFavourite(KICK)).toBe(true);
    await adding;
    await settle();
    const stored = await repository.listFavourites(UID);
    expect(stored.ok && stored.favourites.map((f) => f.assetId)).toEqual([KICK.assetId]);
    expect(favourites.isFavourite(KICK)).toBe(true);

    await favourites.toggle(KICK);
    await settle();
    expect(favourites.isFavourite(KICK)).toBe(false);
    expect(listed(favourites)).toEqual([]);
    expect(changes().map((event) => event.params.favourited)).toEqual([true, false]);
  });

  it("puts the heart back and says so when a write fails", async () => {
    const memory = new InMemoryFavouritesRepository();
    const failing: FavouritesRepository = {
      listFavourites: (uid) => memory.listFavourites(uid),
      watchFavourites: (uid, listener) => memory.watchFavourites(uid, listener),
      removeFavourite: (uid, reference) => memory.removeFavourite(uid, reference),
      addFavourite: async () => favouriteFailure("unavailable", "offline"),
    };
    const { favourites, changes } = setup(failing);
    await settle();

    await favourites.toggle(KICK);
    await settle();

    expect(favourites.isFavourite(KICK)).toBe(false);
    expect(favourites.failed()).toBe(true);
    expect(changes()).toEqual([]);
  });

  it("holds nothing and toggles nothing while nobody is signed in", async () => {
    const { favourites, repository } = setup(undefined, null);
    await settle();

    await favourites.toggle(KICK);
    await settle();

    expect(favourites.loaded()).toBe(false);
    expect(listed(favourites)).toEqual([]);
    expect((await repository.listFavourites(UID)).ok).toBe(true);
    const stored = await repository.listFavourites(UID);
    expect(stored.ok && stored.favourites).toEqual([]);
  });

  it("follows the signed-in user", async () => {
    const repository = new InMemoryFavouritesRepository({ clock: createManualClock(1) });
    await repository.addFavourite("user_b", SNARE);
    const { favourites, setAccount } = setup(repository);
    await settle();
    expect(listed(favourites)).toEqual([]);

    setAccount("user_b");
    await settle();

    expect(listed(favourites)).toEqual([SNARE.assetId]);
  });
});
