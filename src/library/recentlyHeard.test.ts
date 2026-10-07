import { describe, expect, it } from "vitest";
import { hostileStorage, memoryStorage } from "../testing/storage";
import {
  createRecentlyHeardStore,
  parseRecentlyHeard,
  RECENTLY_HEARD_LIMIT,
  RECENTLY_HEARD_STORAGE_KEY,
  rememberHeard,
} from "./recentlyHeard";

const sound = (n: number) => ({ packId: "pak_drums", assetId: `kick-${n}` });

describe("rememberHeard", () => {
  it("puts the sound just heard at the top", () => {
    expect(rememberHeard([sound(1)], sound(2))).toEqual([sound(2), sound(1)]);
  });

  it("moves a sound heard again to the top instead of listing it twice", () => {
    const heard = [sound(3), sound(2), sound(1)];
    expect(rememberHeard(heard, sound(1))).toEqual([sound(1), sound(3), sound(2)]);
  });

  it("tells sounds apart by pack as well as by ID", () => {
    const other = { packId: "pak_other", assetId: "kick-1" };
    expect(rememberHeard([sound(1)], other)).toEqual([other, sound(1)]);
  });

  it(`keeps at most ${RECENTLY_HEARD_LIMIT} sounds, dropping the oldest`, () => {
    let heard: ReturnType<typeof rememberHeard> = [];
    for (let n = 1; n <= RECENTLY_HEARD_LIMIT + 5; n += 1) {
      heard = rememberHeard(heard, sound(n));
    }
    expect(heard).toHaveLength(RECENTLY_HEARD_LIMIT);
    expect(heard[0]).toEqual(sound(RECENTLY_HEARD_LIMIT + 5));
    expect(heard.at(-1)).toEqual(sound(6));
  });

  it("stores only the reference, whatever else the sound carries", () => {
    const asset = { ...sound(1), name: "Rounded Club Kick", url: "https://x" };
    expect(rememberHeard([], asset)).toEqual([sound(1)]);
  });
});

describe("parseRecentlyHeard", () => {
  it("reads nothing stored, or anything unreadable, as an empty list", () => {
    expect(parseRecentlyHeard(null)).toEqual([]);
    expect(parseRecentlyHeard("not json")).toEqual([]);
    expect(parseRecentlyHeard(JSON.stringify({ version: 2, sounds: [] }))).toEqual([]);
    expect(parseRecentlyHeard(JSON.stringify({ version: 1, sounds: [{}] }))).toEqual([]);
  });
});

describe("createRecentlyHeardStore", () => {
  it("survives a reload: a new store on the same storage reads the list back", () => {
    const storage = memoryStorage();
    const store = createRecentlyHeardStore(storage);
    store.record(sound(1));
    store.record(sound(2));
    store.record(sound(1));

    expect(createRecentlyHeardStore(storage).load()).toEqual([sound(1), sound(2)]);
  });

  it("keeps nothing but pack and asset IDs in storage", () => {
    const storage = memoryStorage();
    createRecentlyHeardStore(storage).record({ ...sound(1), name: "Kick" } as never);

    expect(JSON.parse(storage.getItem(RECENTLY_HEARD_STORAGE_KEY) ?? "")).toEqual({
      version: 1,
      sounds: [sound(1)],
    });
  });

  it("keeps the list for the page when storage is blocked, without throwing", () => {
    const store = createRecentlyHeardStore(hostileStorage());

    expect(store.record(sound(1))).toEqual([sound(1)]);
    expect(store.record(sound(2))).toEqual([sound(2), sound(1)]);
    expect(store.load()).toEqual([sound(2), sound(1)]);
  });
});
