import { describe, expect, it } from "vitest";
import { bumpVersion, type VersionedPack, withoutSound } from "./packVersions";
import { type PackTransaction, withdrawRefusedSound } from "./refusedSound";
import { packAudioPath, parsePackAudioPath, userPackDocPath } from "./userData";

function fakePacks(initial: Record<string, VersionedPack>) {
  const packs = new Map(Object.entries(initial));
  const tx: PackTransaction = {
    async getPack(uid, packId) {
      return packs.get(userPackDocPath(uid, packId)) ?? null;
    },
    setPack(uid, packId, pack) {
      packs.set(userPackDocPath(uid, packId), pack);
    },
  };
  return { tx, packs };
}

const pack = (version: string, ids: string[]): VersionedPack => ({
  version,
  assets: ids.map((id) => ({ id })),
  modifiedAt: 1,
});

describe("pack versions", () => {
  it("bumps minor for an added sound and major for a removed one", () => {
    expect(bumpVersion("2.3.1", "minor")).toBe("2.4.0");
    expect(bumpVersion("2.3.1", "major")).toBe("3.0.0");
  });

  it("removes a sound at the next major version, and leaves an absent one alone", () => {
    const before = pack("1.2.0", ["ast_a", "ast_b"]);
    expect(withoutSound(before, "ast_a", 9)).toEqual({
      ...pack("2.0.0", ["ast_b"]),
      modifiedAt: 9,
    });
    expect(withoutSound(before, "ast_z", 9)).toBe(before);
  });
});

describe("a sound whose audio the ledger refused", () => {
  const path = packAudioPath("u1", "pak_a", "ast_b");

  it("reads the owner, pack and sound back out of its path", () => {
    expect(parsePackAudioPath(path)).toEqual({
      uid: "u1",
      packId: "pak_a",
      assetId: "ast_b",
    });
    expect(parsePackAudioPath("users/u1/packs/pak_a")).toBeNull();
    expect(parsePackAudioPath("library/packs/pak_a/ast_b")).toBeNull();
  });

  it("is taken out of its pack at the next major version", async () => {
    const { tx, packs } = fakePacks({
      [userPackDocPath("u1", "pak_a")]: pack("1.3.0", ["ast_a", "ast_b"]),
    });
    expect(await withdrawRefusedSound(tx, path, 42)).toBe(true);
    expect(packs.get(userPackDocPath("u1", "pak_a"))).toEqual({
      version: "2.0.0",
      assets: [{ id: "ast_a" }],
      modifiedAt: 42,
    });
  });

  it("changes nothing when the pack does not list it, or is gone", async () => {
    const listed = pack("1.3.0", ["ast_a"]);
    const { tx, packs } = fakePacks({ [userPackDocPath("u1", "pak_a")]: listed });
    expect(await withdrawRefusedSound(tx, path, 42)).toBe(false);
    expect(packs.get(userPackDocPath("u1", "pak_a"))).toBe(listed);
    expect(
      await withdrawRefusedSound(tx, packAudioPath("u1", "pak_x", "ast_b"), 42),
    ).toBe(false);
    expect(await withdrawRefusedSound(tx, "users/u1/other/thing", 42)).toBe(false);
  });
});
