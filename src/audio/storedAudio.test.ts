import { afterEach, describe, expect, it } from "vitest";
import {
  provideStoredAudio,
  readStoredAudio,
  StoredAudioUnavailableError,
} from "./storedAudio";

describe("stored audio (#282)", () => {
  let remove: (() => void) | null = null;
  afterEach(() => {
    remove?.();
    remove = null;
  });

  it("reads through the installed source", async () => {
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    const asked: string[] = [];
    remove = provideStoredAudio(async (ref) => {
      asked.push(ref);
      return bytes;
    });
    await expect(readStoredAudio("users/u1/packs/pak_a/ast_a")).resolves.toBe(bytes);
    expect(asked).toEqual(["users/u1/packs/pak_a/ast_a"]);
  });

  it("is unavailable with no source, or when the source refuses", async () => {
    await expect(readStoredAudio("users/u1/packs/pak_a/ast_a")).rejects.toBeInstanceOf(
      StoredAudioUnavailableError,
    );
    remove = provideStoredAudio(async () => {
      throw new Error("permission denied");
    });
    await expect(readStoredAudio("users/u1/packs/pak_a/ast_a")).rejects.toBeInstanceOf(
      StoredAudioUnavailableError,
    );
  });

  it("only removes the source it installed", async () => {
    const first = provideStoredAudio(async () => new ArrayBuffer(1));
    remove = provideStoredAudio(async () => new ArrayBuffer(2));
    first();
    expect((await readStoredAudio("users/u1/packs/p/a")).byteLength).toBe(2);
  });
});
