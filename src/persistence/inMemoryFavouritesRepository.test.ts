import { beforeEach, describe, expect, it } from "vitest";
import { createManualClock } from "../shared/clock";
import { favouriteDocumentPath } from "./favouriteDocuments";
import {
  describeFavouritesRepositoryContract,
  FAVOURITES_OWNER,
  KICK,
} from "./favouritesRepositoryContract";
import { InMemoryFavouritesRepository } from "./inMemoryFavouritesRepository";

// One store shared by every "session": the in-memory store has no identity and
// no transport, so two sessions of a user are two handles on the same state.
describeFavouritesRepositoryContract("in-memory", () => {
  const clock = createManualClock();
  const repository = new InMemoryFavouritesRepository({ clock });
  return {
    clock,
    repositoryFor: () => repository,
    reset: async () => {},
    seedStoredDocument: async (path, data) => repository.writeDocument(path, data),
  };
});

describe("InMemoryFavouritesRepository", () => {
  let repository: InMemoryFavouritesRepository;

  beforeEach(() => {
    repository = new InMemoryFavouritesRepository({ clock: createManualClock(1) });
  });

  it("writes one document to add a favourite and deletes one to remove it", async () => {
    const path = favouriteDocumentPath(FAVOURITES_OWNER, KICK);

    await repository.addFavourite(FAVOURITES_OWNER, KICK);
    expect(repository.writes).toEqual([{ kind: "set", path }]);

    repository.clearWrites();
    await repository.removeFavourite(FAVOURITES_OWNER, KICK);
    expect(repository.writes).toEqual([{ kind: "delete", path }]);
  });

  it("writes nothing for a refused reference", async () => {
    await repository.addFavourite(FAVOURITES_OWNER, { ...KICK, assetId: "" });
    await repository.removeFavourite(FAVOURITES_OWNER, { ...KICK, assetId: "" });
    expect(repository.writes).toEqual([]);
  });
});
