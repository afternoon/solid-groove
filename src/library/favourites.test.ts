import { beforeEach, describe, expect, it, vi } from "vitest";
import { Analytics } from "../analytics/analytics";
import { ConsentStore } from "../analytics/consent";
import {
  createRecordingTransport,
  type RecordingTransport,
} from "../analytics/transport";
import type { Favourite } from "../persistence/favouriteDocuments";
import {
  KICK,
  PACK_DRUMS,
  PACK_KEYS,
  PIANO,
  SNARE,
} from "../persistence/favouritesRepositoryContract";
import { InMemoryFavouritesRepository } from "../persistence/inMemoryFavouritesRepository";
import { createManualClock } from "../shared/clock";
import { memoryStorage } from "../testing/storage";
import { createFavouriteActions, resolveFavourites } from "./favourites";

const UID = "user_a";

function favourite(reference: typeof KICK, favouritedAt = 1): Favourite {
  return { ...reference, favouritedAt };
}

function asset(reference: typeof KICK) {
  return {
    id: reference.assetId,
    packId: reference.packId,
    name: `Name of ${reference.assetId}`,
  };
}

describe("resolveFavourites", () => {
  it("pairs each favourite with its library sound, in the favourites' order", () => {
    const resolved = resolveFavourites([favourite(SNARE, 2), favourite(KICK, 1)], {
      packIds: [PACK_DRUMS],
      assets: [asset(KICK), asset(SNARE)],
    });

    expect(resolved).toEqual([
      { status: "available", favourite: favourite(SNARE, 2), asset: asset(SNARE) },
      { status: "available", favourite: favourite(KICK, 1), asset: asset(KICK) },
    ]);
  });

  it("reports a favourite whose pack the library no longer holds as missing", () => {
    const resolved = resolveFavourites([favourite(KICK), favourite(PIANO)], {
      packIds: [PACK_DRUMS],
      assets: [asset(KICK)],
    });

    expect(resolved[1]).toEqual({
      status: "missing",
      favourite: favourite(PIANO),
      reason: "pack_unavailable",
    });
  });

  it("reports a sound deleted from a pack the library holds as missing", () => {
    const resolved = resolveFavourites([favourite(SNARE)], {
      packIds: [PACK_DRUMS],
      assets: [asset(KICK)],
    });

    expect(resolved).toEqual([
      { status: "missing", favourite: favourite(SNARE), reason: "asset_unavailable" },
    ]);
  });

  it("never matches a sound by its asset ID alone", () => {
    const sameIdOtherPack = { ...KICK, packId: PACK_KEYS };
    const resolved = resolveFavourites([favourite(sameIdOtherPack)], {
      packIds: [PACK_DRUMS],
      assets: [asset(KICK)],
    });

    expect(resolved[0]).toMatchObject({ status: "missing", reason: "pack_unavailable" });
  });

  it("keeps every favourite when the library has nothing loaded", () => {
    const favourites = [favourite(KICK), favourite(PIANO)];
    const resolved = resolveFavourites(favourites, { packIds: [], assets: [] });

    expect(resolved.map((entry) => entry.status)).toEqual(["missing", "missing"]);
  });
});

describe("createFavouriteActions", () => {
  let repository: InMemoryFavouritesRepository;
  let transport: RecordingTransport;
  let analytics: Analytics;

  beforeEach(() => {
    repository = new InMemoryFavouritesRepository({ clock: createManualClock(1) });
    transport = createRecordingTransport();
    analytics = new Analytics({
      transport,
      consent: new ConsentStore(memoryStorage()),
      storage: memoryStorage(),
    });
  });

  const changes = () =>
    transport.events.filter((event) => event.name === "library_favourite_changed");
  const firstUses = () =>
    transport.events.filter(
      (event) =>
        event.name === "feature_first_use" &&
        event.params.feature === "library_favourites",
    );

  it("logs one library_favourite_changed per add and per remove", async () => {
    const actions = createFavouriteActions({ repository, analytics });

    await actions.add(UID, KICK);
    expect(changes().map((event) => event.params.favourited)).toEqual([true]);

    await actions.remove(UID, KICK);
    expect(changes().map((event) => event.params.favourited)).toEqual([true, false]);

    await actions.set(UID, SNARE, true);
    await actions.set(UID, SNARE, false);
    expect(changes()).toHaveLength(4);
  });

  it("names neither the sound nor its pack in the event", async () => {
    await createFavouriteActions({ repository, analytics }).add(UID, KICK);

    const [event] = changes();
    expect(Object.keys(event.params).sort()).toEqual([
      "favourited",
      "release_sha",
      "surface",
    ]);
    expect(JSON.stringify(event.params)).not.toContain(KICK.assetId);
    expect(JSON.stringify(event.params)).not.toContain(KICK.packId);
  });

  it("logs feature_first_use for the first favourite only", async () => {
    const actions = createFavouriteActions({ repository, analytics });

    await actions.add(UID, KICK);
    await actions.add(UID, SNARE);
    await actions.remove(UID, KICK);

    expect(firstUses()).toHaveLength(1);
  });

  it("logs nothing for a write that changed nothing", async () => {
    const actions = createFavouriteActions({ repository, analytics });

    const result = await actions.add(UID, { ...KICK, assetId: "" });

    expect(result.ok).toBe(false);
    expect(transport.events).toEqual([]);
  });

  it("writes through the repository, so the favourite is stored", async () => {
    await createFavouriteActions({ repository, analytics }).add(UID, KICK);

    const listed = await repository.listFavourites(UID);
    expect(listed.ok && listed.favourites).toEqual([{ ...KICK, favouritedAt: 1 }]);
  });
});

describe("an anonymous user's favourites", () => {
  it("are still theirs after the account is upgraded", async () => {
    // The mock auth service upgrades in place, as Firebase's linking does; the
    // emulator suite proves the same uid reaches the same Firestore documents.
    vi.stubEnv("VITE_DEV_BACKEND", "mock");
    vi.resetModules();
    const { createAuthService } = await import("../auth/authService");
    const auth = createAuthService();
    const repository = new InMemoryFavouritesRepository({ clock: createManualClock(1) });
    const uidOf = () =>
      new Promise<string>((resolve) => {
        const stop = auth.onAuthStateChanged((user) => {
          if (user) {
            stop();
            resolve(user.uid);
          }
        });
      });

    await auth.signInAnonymously();
    const guest = await uidOf();
    await repository.addFavourite(guest, KICK);

    await auth.linkWithGoogle();
    const registered = await uidOf();

    expect(registered).toBe(guest);
    const listed = await repository.listFavourites(registered);
    expect(listed.ok && listed.favourites.map((entry) => entry.assetId)).toEqual([
      KICK.assetId,
    ]);
    vi.unstubAllEnvs();
  });
});
